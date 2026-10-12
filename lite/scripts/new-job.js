#!/usr/bin/env node
// Intake: a first cut, a brief and some context become a job folder.
//
//   node new-job.js <client> <job-id> --cut <video> --brief <file.md|"text"> [--context <file|"text">]
//   node new-job.js <client> <job-id> --folder <folder|Drive link> [--cut <name in it>] [--brief ...] [--context ...]
//                   [--title "..."] [--ratio 16:9] [--background-per location|shot] [--force]
//                   [--folder-source <Drive link the folder was downloaded from>]
//
// Copies the first cut into the job (media/source/), keeps the brief and context as written
// (brief.md, context.md), probes the cut and writes job.json. The context is where the person
// says what the new world is: "the street becomes a 1920s Singapore shophouse row", "a pine
// forest at dawn". Nothing is generated or spent here.
//
// With --folder the project folder is the input: the first cut is its one video (or the one
// named first cut / rough cut / edit when there are several), the brief and context are its files
// named brief / context when not given, and every other non-video file (scripts, logos, client
// reference pictures) is copied to inputs/ in the job. Other videos are listed, not copied.
// A Google Drive link cannot be read from here: the script names a local folder under
// incoming/ and exits 4; the session downloads the Drive folder into it with the Google Drive
// connector and runs again with --folder <that folder> --folder-source <link>.
// Exit 0 ok · 1 fault · 2 usage · 3 not ready (ffprobe missing, cut unreadable, job exists,
// folder unusable) · 4 a Drive link: download it first
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
const folderArg = L.opt(argv, '--folder');
if (!J || (!folderArg && (!L.opt(argv, '--cut') || !L.opt(argv, '--brief')))) {
  console.error('usage: new-job.js <client> <job-id> --cut <video> --brief <file|"text"> [--context <file|"text">] [--title "..."] [--ratio 16:9]\n' +
    '       new-job.js <client> <job-id> --folder <folder|Drive link> [--cut <name>] [--brief ...] [--context ...]');
  process.exit(2);
}
if (!/^job-[a-z0-9][a-z0-9-]*$/.test(J.jobId)) { console.error('job id must look like job-<slug> (lowercase, digits, dashes), e.g. job-shophouse-v1'); process.exit(2); }
const refuse = L.ws.refuseShootRoot(argv);
if (refuse) { console.error(refuse); process.exit(3); }
if (fs.existsSync(J.file('job.json')) && !L.has(argv, '--force')) { console.error('job ' + J.jobId + ' already exists; resume it, or pass --force to start it again'); process.exit(3); }

const VIDEO = /\.(mov|mp4|m4v|mxf|avi|mkv|webm)$/i;
const SKIP = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
// Google Drive folder links come in several shapes; the id is what the connector wants.
function driveFolderId(s) {
  const t = String(s || '').trim();
  let m = t.match(/drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = t.match(/drive\.google\.com\/.*[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}
// Every file under a folder, relative with forward slashes; hidden folders (.git, .board) skipped.
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

let folder = null;
if (folderArg) {
  const id = !fs.existsSync(folderArg) && driveFolderId(folderArg);
  if (id) {
    const incoming = path.join(L.ws.root(argv), 'incoming', J.jobId);
    L.ensureDir(incoming);
    console.log('DRIVE ' + id);
    console.log('A Google Drive folder. Download it with the Google Drive connector into ' + L.fwd(incoming) +
      ' (keep its sub-folders), then run again with --folder "' + L.fwd(incoming) + '" --folder-source "' + folderArg + '".');
    process.exit(4);
  }
  const dir = path.resolve(folderArg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('no such folder: ' + dir + ' (a folder on this computer, or a Google Drive folder link)'); process.exit(3); }
  const root = path.resolve(L.ws.root(argv));
  const inside = (a, b) => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (inside(root, dir)) { console.error('REFUSED: ' + L.fwd(dir) + ' is or holds the workspace root; copying it would copy the jobs into themselves. Point at the project folder itself.'); process.exit(3); }
  if (inside(dir, L.ws.clientsDir(argv))) { console.error('REFUSED: ' + L.fwd(dir) + ' is inside workspaces/, the pipeline\'s own files. Point at the client\'s project folder.'); process.exit(3); }
  const files = walk(dir);
  if (!files.length) { console.error('the folder ' + L.fwd(dir) + ' is empty'); process.exit(3); }
  folder = { dir, files, videos: files.filter(f => VIDEO.test(f)) };
}

// The first cut: --cut as given (a name inside the folder is fine), else the folder's video.
function pickCut() {
  const given = L.opt(argv, '--cut');
  if (given) {
    if (folder && !fs.existsSync(given) && fs.existsSync(path.join(folder.dir, given))) return path.join(folder.dir, given);
    return path.resolve(given);
  }
  const v = folder.videos;
  if (!v.length) { console.error('no video in ' + L.fwd(folder.dir) + '; put the first cut in it, or pass --cut <file>'); process.exit(3); }
  if (v.length === 1) return path.join(folder.dir, v[0]);
  const named = v.filter(f => /first[\s_-]?cut|rough[\s_-]?cut|offline|edit/i.test(path.basename(f)));
  if (named.length === 1) return path.join(folder.dir, named[0]);
  console.error('the folder holds ' + v.length + ' videos; say which is the first cut with --cut:\n  ' + v.join('\n  '));
  process.exit(3);
}
// A brief or context file in the folder: Markdown or text is read in, anything else (PDF, Word)
// is pointed at from brief.md so the researcher opens it in inputs/.
function fromFolder(word) {
  if (!folder) return null;
  const hits = folder.files.filter(f => !VIDEO.test(f) && new RegExp(word, 'i').test(path.basename(f)) && /\.(md|txt|pdf|docx?|rtf)$/i.test(f));
  if (!hits.length) return null;
  const f = hits.find(h => /\.(md|txt)$/i.test(h)) || hits[0];
  return /\.(md|txt)$/i.test(f) ? path.join(folder.dir, f) : 'The ' + word + ' is in the project folder: inputs/' + f + '. Read it there.';
}

const cut = pickCut();
if (!fs.existsSync(cut)) { console.error('no such file: ' + cut); process.exit(3); }
const briefIn = L.opt(argv, '--brief') || fromFolder('brief');
if (!briefIn) { console.error('no brief: pass --brief, or put a file named brief (.md, .txt, .pdf, .docx) in the folder'); process.exit(2); }
const contextIn = L.opt(argv, '--context') || fromFolder('context');

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.error) { console.error('ffprobe is not installed; run check-deps.js --setup'); process.exit(3); }
  if (r.status !== 0) { console.error('ffprobe cannot read ' + file + ': ' + (r.stderr || '').trim()); process.exit(3); }
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  if (!v) { console.error(file + ' has no video stream'); process.exit(3); }
  const [n, d] = String(v.r_frame_rate || '25/1').split('/').map(Number);
  return { width: v.width, height: v.height, fps: Math.round((n / (d || 1)) * 1000) / 1000, duration: Number((j.format || {}).duration || 0), audio: (j.streams || []).some(s => s.codec_type === 'audio') };
}

const textOf = v => (v && fs.existsSync(v) && fs.statSync(v).isFile() ? fs.readFileSync(v, 'utf8') : String(v || ''));
const info = probe(cut);
const ratio = L.opt(argv, '--ratio') || (() => {
  const r = info.width / info.height;
  return [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5], ['21:9', 21 / 9]].sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
})();
const per = L.opt(argv, '--background-per', 'location');
if (!['location', 'shot'].includes(per)) { console.error('--background-per is location or shot'); process.exit(2); }

const ws = L.ws.wsDir(J.client, argv);
if (!fs.existsSync(path.join(ws, 'workspace.json'))) L.writeJson(path.join(ws, 'workspace.json'), { client: J.client, createdAt: L.nowIso() });

const srcDir = J.file('media', 'source');
L.ensureDir(srcDir);
const dest = path.join(srcDir, 'first-cut' + path.extname(cut).toLowerCase());
fs.copyFileSync(cut, dest);
fs.writeFileSync(J.file('brief.md'), textOf(briefIn).trim() + '\n');
fs.writeFileSync(J.file('context.md'), textOf(contextIn).trim() + '\n');
// The rest of the project folder, so every agent reads files in the job and nobody reads the
// client's folder (or Drive) again. Videos stay where they are: the cut is already copied.
let folderRecord = null;
if (folder) {
  const copied = [];
  for (const f of folder.files) {
    if (VIDEO.test(f)) continue;
    const to = J.file('inputs', ...f.split('/'));
    L.ensureDir(path.dirname(to));
    fs.copyFileSync(path.join(folder.dir, f), to);
    copied.push({ path: 'inputs/' + f, bytes: fs.statSync(to).size });
  }
  const src = L.opt(argv, '--folder-source');
  folderRecord = {
    source: src || L.fwd(folder.dir), route: src && driveFolderId(src) ? 'drive' : 'local', path: L.fwd(folder.dir),
    cut: L.fwd(path.relative(folder.dir, cut)), files: copied,
    otherVideos: folder.videos.map(v => L.fwd(path.join(folder.dir, v))).filter(v => v !== L.fwd(cut)),
  };
}

const job = {
  schemaVersion: '1.0',
  jobId: J.jobId,
  client: J.client,
  title: L.opt(argv, '--title') || J.jobId.replace(/^job-/, '').replace(/-/g, ' '),
  createdAt: L.nowIso(),
  // composite.py, cutout.py and motion-transfer.js read these two names.
  footageSource: 'hybrid',
  driveFolder: L.fwd(J.file('media')),
  aspectRatio: ratio,
  source: { file: L.fwd(dest), name: path.basename(cut), sha256: L.sha256File(dest), ...info },
  ...(folderRecord ? { projectFolder: folderRecord } : {}),
  hybrid: { backgroundPer: per === 'shot' ? 'panel' : 'location', cutout: 'auto', match: 0.5, motionPanels: [], motion: { resolution: '720p', keepActor: true, maxSec: 15 } },
  grade: { strength: 1.0 },
  render: { codec: 'h264', crf: 16 },
};
J.saveJob(job);
// The project on the board, then intake as a Draft for a person to approve (it is an XX step).
const root = L.opt(argv, '--root') ? ['--root', L.opt(argv, '--root')] : [];
const run = (script, args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args, ...root], { encoding: 'utf8' });
const opened = run('board-sync.js', ['open', J.client, J.jobId]);
if (opened.status !== 0) console.error('the board could not be opened for this job: ' + (opened.stderr || '').trim());
const summary = 'First cut ' + info.duration.toFixed(1) + ' s at ' + info.width + 'x' + info.height + ', ' + info.fps + ' fps, ' + (info.audio ? 'with' : 'no') + ' sound. Brief and context read.' +
  (folderRecord ? ' From the project folder: ' + folderRecord.cut + ' as the first cut, ' + folderRecord.files.length + ' other file(s) in inputs/' + (folderRecord.otherVideos.length ? ', ' + folderRecord.otherVideos.length + ' other video(s) left in place' : '') + '.' : '');
L.setStage(J, 'intake', 'done', null, 'orchestrator');
let prior = 0;
try { prior = fs.readFileSync(J.file('versions.jsonl'), 'utf8').split('\n').filter(l => /"item":"intake"/.test(l)).length; } catch { /* first intake */ }
const rv = run('record-version.js', [J.client, J.jobId, '--item', 'intake', '--n', String(prior + 1), '--file', 'job.json', '--note', summary, '--seat', 'orchestrator']);
if (rv.status !== 0) console.error('intake was not recorded for the board: ' + (rv.stderr || '').trim());
L.say(J, 'orchestrator', 'Job opened: ' + job.title + '. ' + summary + ' Next: the cataloguer splits the cut into shots.', 'intake');
console.log('job ' + J.jobId + ' at ' + L.fwd(J.dir));
console.log('first cut: ' + info.width + 'x' + info.height + ', ' + info.fps + ' fps, ' + info.duration.toFixed(2) + ' s, ' + (info.audio ? 'with' : 'no') + ' sound; ratio ' + ratio);
if (folderRecord) console.log('project folder: ' + folderRecord.source + ' (' + folderRecord.route + '); first cut ' + folderRecord.cut + '; ' + folderRecord.files.length + ' file(s) copied to inputs/');
if (!textOf(contextIn).trim()) console.log('No context given: ask what the new backgrounds should be (era, place, time of day) before research.');
