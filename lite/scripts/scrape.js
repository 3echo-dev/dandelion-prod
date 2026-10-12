#!/usr/bin/env node
// The scraper's tool: reference pictures into the job, each with where it came from.
//
//   node scrape.js <client> <job-id> fetch --url <image url> --tag <location key> --page <page url> [--license "..."] [--note "..."]
//   node scrape.js <client> <job-id> add --file <image> --tag <location key> [--license client] [--background]
//   node scrape.js <client> <job-id> drop <R03>
//   node scrape.js <client> <job-id> list
//
// fetch downloads one picture (JPEG, PNG or WebP, at most 20 MB; anything else is refused by its
// bytes, not its name), skips one already held (same hash), and records the page it was found on
// and its licence as stated there. add takes a picture the client supplied.
//
// A scraped picture is a REFERENCE: it guides the generated background and the grade. It is put
// in the final picture only when --background is given, which is for a picture the client owns or
// that is licensed for it (client-supplied, CC0, bought stock); hybrid.js then uses it as the
// location's background instead of generating one. Files land in references/; the index is
// references.json; a 320 px thumb for the board goes to previews/refs/.
// Exit 0 ok · 1 fault · 2 usage · 3 refused (not an image, too big, duplicate)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');
const B = require('./lib-board.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
const cmd = J && J.rest[0];
if (!J || !['fetch', 'add', 'drop', 'list'].includes(cmd)) { console.error('usage: scrape.js <client> <job-id> fetch|add|drop|list ...'); process.exit(2); }
const MAX = 20 * 1024 * 1024;
const keyOf = s => String(s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const idx = J.read('references.json', null) || { schemaVersion: '1.0', items: [] };
const save = () => J.write('references.json', idx);

function kindOf(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

function keep(buf, meta) {
  const ext = kindOf(buf);
  if (!ext) { console.error('refused: not a JPEG, PNG or WebP picture' + (meta.url ? ' (' + meta.url + ')' : '')); process.exit(3); }
  if (buf.length > MAX) { console.error('refused: larger than 20 MB'); process.exit(3); }
  const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
  const dup = idx.items.find(i => i.sha256 === sha);
  if (dup) { console.log('already held as ' + dup.id + ' (' + dup.tag + ')'); process.exit(0); }
  const n = idx.items.reduce((m, i) => Math.max(m, Number(String(i.id).slice(1)) || 0), 0) + 1;
  const id = 'R' + String(n).padStart(2, '0');
  const dir = J.file('references'); L.ensureDir(dir);
  const file = path.join(dir, id + '-' + meta.tag.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) + ext);
  fs.writeFileSync(file, buf);
  const thumb = J.file('previews', 'refs', id + '.jpg'); L.ensureDir(path.dirname(thumb));
  const t = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', 'scale=320:-2', '-frames:v', '1', thumb], { encoding: 'utf8' });
  const item = { id, tag: meta.tag, file: L.fwd(file), sha256: sha, bytes: buf.length, thumb: t.status === 0 ? L.fwd(thumb) : null,
    url: meta.url || null, page: meta.page || null, license: meta.license || null, background: !!meta.background, note: meta.note || null, addedAt: L.nowIso() };
  idx.items.push(item); save();
  // The board's References step: one row per picture, ticked by a person to build from.
  let site = 'Supplied by the client';
  try { if (item.page) site = new URL(item.page).hostname.replace(/^www\./, ''); } catch { /* keep the default */ }
  B.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'references', docId: id, data: {
    n, title: item.note || (meta.tag + ', ' + id), site, url: item.page || item.url || null, retrieved: item.addedAt.slice(0, 10),
    why: 'For ' + meta.tag + (item.background ? '; usable as the background itself' : '; a reference only') + (item.license ? '. Licence: ' + item.license : ''),
  } });
  console.log(id + ' kept for "' + meta.tag + '"' + (item.background ? ', usable as the background' : ', as a reference') + ': ' + path.basename(file));
}

(async () => {
  if (cmd === 'list') {
    if (!idx.items.length) { console.log('no references yet'); return; }
    for (const i of idx.items) console.log(i.id + '  ' + i.tag + (i.background ? '  [background]' : '') + '  ' + (i.page || i.url || 'client-supplied') + (i.license ? '  licence: ' + i.license : ''));
    return;
  }
  if (cmd === 'drop') {
    const id = String(J.rest[1] || '').toUpperCase(); const i = idx.items.findIndex(x => x.id === id);
    if (i < 0) { console.error('no reference ' + id); process.exit(2); }
    const [gone] = idx.items.splice(i, 1);
    for (const f of [gone.file, gone.thumb]) if (f && fs.existsSync(f)) fs.unlinkSync(f);
    save(); B.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'references', docId: id, op: 'delete' });
    console.log(id + ' dropped'); return;
  }
  const tag = keyOf(L.opt(argv, '--tag'));
  if (!tag) { console.error('--tag <location key> is required (the look\'s location the picture is for, or "grade" for a colour reference)'); process.exit(2); }
  if (cmd === 'add') {
    const f = L.opt(argv, '--file'); if (!f || !fs.existsSync(f)) { console.error('add needs --file <image>'); process.exit(2); }
    keep(fs.readFileSync(f), { tag, license: L.opt(argv, '--license', 'client'), background: L.has(argv, '--background'), note: L.opt(argv, '--note') });
    return;
  }
  const url = L.opt(argv, '--url'); const page = L.opt(argv, '--page');
  if (!url || !/^https?:\/\//i.test(url)) { console.error('fetch needs --url <http(s) image url>'); process.exit(2); }
  if (!page) { console.error('fetch needs --page <the page the picture was found on>, so its source and licence can be checked later'); process.exit(2); }
  let res;
  try { res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (dandelion-prod reference fetch)' }, signal: AbortSignal.timeout(30000) }); }
  catch (e) { console.error('download failed: ' + e.message); process.exit(1); }
  if (!res.ok) { console.error('download failed: HTTP ' + res.status); process.exit(1); }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX) { console.error('refused: larger than 20 MB'); process.exit(3); }
  const buf = Buffer.from(await res.arrayBuffer());
  keep(buf, { tag, url, page, license: L.opt(argv, '--license'), background: L.has(argv, '--background'), note: L.opt(argv, '--note') });
})();
