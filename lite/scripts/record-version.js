#!/usr/bin/env node
// Record a delivery: one line in versions.jsonl and the item on the board, with the file's
// hash, which is what a gate lock later binds to.
//
//   node record-version.js <client> <job-id> --item sequence --n 1 --file rough-edl.json
//        [--note "..."] [--seat sequence-director] [--status draft|needs_input|needs_review]
//        [--preview timeline.png] [--caption "..."]
//
// A version is never overwritten: a second call with the same item and number is refused.
// --preview queues a small image (under 200 KB) to the item's Output tab on the board.
// Exit 0 recorded · 1 refused (duplicate) · 2 usage · 3 the file is not there
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const board = require('./lib-board.js');
const { hashFile } = require('./hash-artifact.js');

const ITEMS = require('./lib-job.js').STAGE_KEYS;
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const { client, jobId, dir } = ws.resolveJobArgs(argv, argv);
const item = opt('--item'), n = Number(opt('--n')), note = opt('--note') || '', file = opt('--file'), seat = opt('--seat') || null;
const status = opt('--status') || 'draft';
const missing = [];
if (!client) missing.push('the client');
if (!jobId) missing.push('the job id');
if (!ITEMS.includes(item)) missing.push('--item <' + ITEMS.join('|') + '>' + (item ? ', not "' + item + '"' : ''));
if (!Number.isInteger(n) || n < 1) missing.push('--n <whole number from 1>');
if (!file) missing.push('--file <path relative to the job>');
if (!['draft', 'needs_input', 'running', 'needs_review'].includes(status)) missing.push('--status draft, needs_input, running or needs_review');
if (missing.length) {
  console.error('Nothing was recorded. This call needs ' + missing.join('; ') + '.');
  console.error('usage: record-version.js <client> <job-id> --item <' + ITEMS.join('|') + '> --n <1..> --file <path> [--note "..."] [--seat <agent>] [--status draft|needs_input] [--preview <png>] [--caption "..."]');
  process.exit(2);
}
const abs = path.join(dir, file);
if (!fs.existsSync(abs)) { console.error('Nothing was recorded. The file is not there: ' + ws.fwd(abs)); process.exit(3); }
// A folder version (bundle/broll) hashes its manifest or README; a file hashes itself.
let target = abs;
if (fs.statSync(abs).isDirectory()) {
  const inside = ['manifest.json', 'README.md', 'index.json'].map(f => path.join(abs, f)).find(p => fs.existsSync(p));
  if (!inside) { console.error('Nothing was recorded. A folder version needs a manifest.json or README.md inside it: ' + ws.fwd(abs)); process.exit(3); }
  target = inside;
}
const log = path.join(dir, 'versions.jsonl');
let lines = [];
try { lines = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); } catch { lines = []; }
if (lines.some(v => v.item === item && Number(v.n) === n)) { console.error('REFUSED: ' + item + ' v' + n + ' is already recorded. A new delivery is a new number.'); process.exit(1); }
const h = hashFile(target);
const rel = path.relative(dir, target).split(path.sep).join('/');
const at = ws.now(client, argv);
// Every file this delivery produced, for the board's Files tab: the file itself, or every file
// inside a folder version, plus anything named with --also (a file or a folder, relative to the
// job, repeatable). jobDir is the job folder's full path, so the board can show where each file
// sits on this computer. Capped so a large bundle does not bloat the board document.
const FILES_CAP = 400;
const found = [];
const walk = p => {
  let st; try { st = fs.statSync(p); } catch { return; }
  if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) if (!e.startsWith('.')) walk(path.join(p, e)); }
  else found.push({ name: path.basename(p), path: path.relative(dir, p).split(path.sep).join('/'), bytes: st.size });
};
walk(abs);
argv.forEach((a, i) => { if (a === '--also' && argv[i + 1]) walk(path.join(dir, argv[i + 1])); });
const seen = new Set();
const allFiles = found.filter(f => !seen.has(f.path) && seen.add(f.path));
const files = allFiles.slice(0, FILES_CAP);
const filesMore = allFiles.length - files.length;
const jobDir = ws.fwd(path.resolve(dir));
const rec = { item, n, note, path: rel, hash: h.sha256, bytes: h.bytes, seat, at, files, ...(filesMore ? { filesMore } : {}) };
fs.appendFileSync(log, JSON.stringify(rec) + '\n');

const cwd = process.cwd();
const iso = new Date().toISOString();
board.appendOutbox(cwd, client, jobId, { collection: 'versions', docId: item + '-v' + n, data: { item, n, note, file: rel, sha256: h.sha256, bytes: h.bytes, seat, at: iso, stamp: at, files, filesMore, jobDir } });
board.appendOutbox(cwd, client, jobId, { collection: 'items', docId: item, op: 'update', data: { status, version: n, summary: note, file: rel, sha256: h.sha256, bytes: h.bytes, files, jobDir, updatedBy: seat || 'pipeline', updatedAt: iso } });
let previewNote = '';
const preview = opt('--preview');
if (preview) {
  const pabs = path.isAbsolute(preview) ? preview : path.join(dir, preview);
  const ext = path.extname(pabs).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
  if (!fs.existsSync(pabs) || !mime) previewNote = ' Preview skipped: ' + preview + ' is not a png, jpg or webp on disk.';
  else if (fs.statSync(pabs).size > 200000) previewNote = ' Preview skipped: ' + preview + ' is over 200 KB; downscale it first.';
  else {
    const thumb = 'data:' + mime + ';base64,' + fs.readFileSync(pabs).toString('base64');
    board.appendOutbox(cwd, client, jobId, { collection: 'previews', docId: item, data: { thumb, caption: opt('--caption') || note || rel, updatedAt: iso } });
    previewNote = ' Preview queued.';
  }
}
if (argv.includes('--json')) console.log(JSON.stringify(rec, null, 2));
else console.log(item + ' v' + n + ' recorded: ' + rel + ' (' + h.sha256.slice(0, 12) + '). Queued for the board.' + previewNote);