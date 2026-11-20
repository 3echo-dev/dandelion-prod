#!/usr/bin/env node
// A shot task: one clip or one still, one ask ("relight it", "a matte of the pack", "the same
// shot in a new place", "take the people out"), with no first cut, no steps and no gates. The
// task folder is its record: every input, every take as its own numbered file, every quote, every
// yes and every credit.
//
//   node task.js <client> <task-id> new --title "Harbour changes" [--workspace-id W]
//   node task.js <client> <task-id> add --file <path> [--as plate]
//   node task.js <client> <task-id> quote --take harbour --label ref --kind image|video --credits N
//                                         [--seconds 4 --resolution 480p] [--video-ref] [--keeps "the pack and the camera move"]
//                                         [--count 4] [--prompt-file p.txt]
//   node task.js <client> <task-id> approve --take harbour --label ref --by "<person>" [--at <when>]
//   node task.js <client> <task-id> land --take harbour (--url <media url> | --file <path>) --credits N [--job-ref <id>]
//   node task.js <client> <task-id> do paste-back|matte|clip|frame --take <name> [the tool's own flags]
//   node task.js <client> <task-id> check --a <file> --b <file> [--alpha <matte>] [--take <name>]
//   node task.js <client> <task-id> status [--json]
//
// A task lives at <root>/workspaces/<client>/tasks/<task-id>/:
//   task.json      the record            inputs/    what the person gave (copies; the originals are never touched)
//   takes/         <take>-v01.png, -v02 ... one file per take, never overwritten
//   previews/      before/after stills, edge close-ups, matte stills
//   credits.jsonl  one line per paid landing
//
// A paid landing (land with credits) needs a yes for that take: quote first, show the person every
// quote for the take, record their answer with approve, then generate and land in the same turn.
// A landing that would take the take's spend over what was approved is refused. The tools under
// "do" cost nothing and need no yes. File flags under do and check read inputs/, takes/ and
// previews/ by bare name ("plate.png", "harbour-v02.png"), or any path.
// Exit 0 ok · 1 fault · 2 usage · 3 refused or not ready
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');
const R = require('./lib-runs.js');

const argv = process.argv.slice(2);
const [client, taskId, cmd] = argv;
const rest = argv.slice(3);
const die = (m, c = 1) => { console.error(m); process.exit(c); };
const USAGE = 'usage: task.js <client> <task-id> new|add|quote|approve|land|do|check|status ...';
if (!client || !taskId || !cmd) die(USAGE, 2);
if (!/^task-[a-z0-9][a-z0-9-]*$/.test(taskId)) die('the task id is task-<slug>, lower case, digits and dashes: ' + taskId, 2);

const refuse = L.ws.refuseShootRoot(process.argv);
if (refuse) die(refuse, 3);
const wsDir = L.ws.wsDir(client, process.argv);
const dir = path.join(wsDir, 'tasks', taskId);
const file = (...p) => path.join(dir, ...p);
const opt = (name, d = null) => L.opt(rest, name, d);
const has = name => rest.includes(name);
const load = () => L.readJson(file('task.json'), null);
const save = t => L.writeJson(file('task.json'), t);
const IMAGE = /\.(png|jpe?g|tiff?|webp|bmp)$/i;
const VIDEO = /\.(mov|mp4|m4v|mxf|avi|mkv|webm)$/i;
const PY = spawnSync('python', ['--version']).status === 0 ? 'python' : 'python3';
const SHOT = path.join(__dirname, 'shot.py');
const takeName = () => {
  const n = opt('--take');
  if (!n || !/^[a-z0-9][a-z0-9_-]*$/.test(n)) die('--take <name>: lower case, digits, dashes and underscores (harbour, orbit_dusk)', 2);
  return n;
};
const pad = v => String(v).padStart(2, '0');

function need() {
  const t = load();
  if (!t) die('no task ' + taskId + ' for ' + client + '; start it with: task.js ' + client + ' ' + taskId + ' new --title "..."', 3);
  return t;
}

// The next free numbered file for a take. Side files in previews/ carry the same number.
function nextTake(t, name, ext) {
  L.ensureDir(file('takes'));
  let v = (t.takes || []).filter(x => x.take === name).reduce((m, x) => Math.max(m, x.v), 0) + 1;
  while (fs.existsSync(file('takes', name + '-v' + pad(v) + ext))) v++;
  return { v, file: file('takes', name + '-v' + pad(v) + ext) };
}

// A file named on the command line: a path, or a bare name looked up in the task's own folders.
function resolveFile(name) {
  if (!name) return null;
  if (fs.existsSync(name)) return path.resolve(name);
  for (const d of ['inputs', 'takes', 'previews', '.']) { const p = file(d, name); if (fs.existsSync(p)) return p; }
  die('file not found: ' + name + ' (looked in the task\'s inputs/, takes/ and previews/ too)', 3);
}

function runShot(args) {
  const r = spawnSync(PY, [SHOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '').trim().split(/\r?\n/);
  if (r.status !== 0) die((r.stderr || r.stdout || 'shot.py failed').trim(), r.status || 1);
  let result = null; try { result = JSON.parse(out[out.length - 1]); } catch { die('shot.py gave no result:\n' + r.stdout, 1); }
  return result;
}

const spentOnTake = (t, name) => (t.takes || []).filter(x => x.take === name).reduce((s, x) => s + (Number(x.credits) || 0), 0);
const approvedFor = (t, name) => (t.approvals || []).filter(a => a.take === name).reduce((s, a) => s + (Number(a.credits) || 0), 0);

if (cmd === 'new') {
  if (load()) die('task ' + taskId + ' already exists for ' + client + ' (task.js ' + client + ' ' + taskId + ' status)', 3);
  if (!fs.existsSync(path.join(wsDir, 'workspace.json'))) L.writeJson(path.join(wsDir, 'workspace.json'), { client, createdAt: L.nowIso() });
  for (const d of ['inputs', 'takes', 'previews']) L.ensureDir(file(d));
  save({ taskId, client, title: opt('--title', taskId.replace(/^task-/, '').replace(/-/g, ' ')), workspaceId: opt('--workspace-id'), createdAt: L.nowIso(), inputs: [], quotes: [], approvals: [], takes: [], checks: [] });
  console.log('Task ' + taskId + ' opened at ' + L.fwd(dir) + '. Add what the person gave: task.js ' + client + ' ' + taskId + ' add --file <path>');
} else if (cmd === 'add') {
  const t = need();
  const src = opt('--file'); if (!src || !fs.existsSync(src)) die('add needs --file <path to a picture or a clip>', 2);
  const ext = path.extname(src).toLowerCase();
  if (!IMAGE.test(src) && !VIDEO.test(src)) die('not a picture or a clip: ' + src, 2);
  const stem = (opt('--as') || path.basename(src, path.extname(src))).replace(/[^\w.-]+/g, '_');
  const dest = file('inputs', stem + ext);
  const sha = L.sha256File(src);
  const same = t.inputs.find(i => i.name === stem + ext);
  if (same && same.sha256 !== sha) die('inputs/' + stem + ext + ' already holds a different file. An input is never overwritten: add this one under another name with --as', 3);
  if (!same) {
    L.ensureDir(file('inputs')); fs.copyFileSync(src, dest);
    const probe = runShot(['frame', '--source', dest, '--at', 'first', '--out', file('previews', 'input-' + stem + '.png')]);
    t.inputs.push({ name: stem + ext, file: L.fwd(dest), sha256: sha, kind: IMAGE.test(src) ? 'image' : 'video', width: probe.width, height: probe.height, from: L.fwd(path.resolve(src)), addedAt: L.nowIso() });
    save(t);
  }
  console.log('inputs/' + stem + ext + (same ? ' was already there' : ' added') + '.');
} else if (cmd === 'quote') {
  const t = need(); const take = takeName();
  const label = opt('--label', 'default'); const kind = opt('--kind');
  if (!['image', 'video'].includes(kind)) die('quote needs --kind image|video', 2);
  const credits = Number(opt('--credits')); if (!(credits > 0)) die('quote needs --credits <what AgentC quoted> (an image is 1 credit; a clip is what estimate_video_job said)', 2);
  const q = { id: 'q' + (t.quotes.length + 1), take, label, kind, credits, count: Number(opt('--count', 1)) || 1, keeps: opt('--keeps'), videoRef: has('--video-ref'), at: L.nowIso() };
  if (kind === 'video') {
    const sec = Number(opt('--seconds')); const res = opt('--resolution');
    if (!Number.isInteger(sec) || sec < 4 || sec > 15) die('the video model makes clips of 4 to 15 whole seconds; --seconds ' + opt('--seconds') + ' cannot be generated. Shorter: generate 4 and cut it back (task.js ... do clip --for-model reports the trim).', 3);
    if (!['480p', '720p', '1080p'].includes(res)) die('--resolution is 480p, 720p or 1080p', 2);
    Object.assign(q, { seconds: sec, resolution: res });
  }
  const pf = opt('--prompt-file'); if (pf) { if (!fs.existsSync(pf)) die('prompt file not found: ' + pf, 3); q.prompt = fs.readFileSync(pf, 'utf8').trim(); }
  t.quotes = t.quotes.filter(x => !(x.take === take && x.label === label)).concat(q);
  save(t);
  const mine = t.quotes.filter(x => x.take === take);
  console.log('Quoted ' + take + ' "' + label + '": ' + credits + ' credit(s)' + (q.seconds ? ', ' + q.seconds + ' s at ' + q.resolution : '') + (q.videoRef ? ', with the clip as a video reference' : '') + '.');
  if (kind === 'video' && mine.length === 1) console.log('NOTE: a video reference costs about three times a clip made without one, and is what holds the subject and the camera move. Quote the other way too (another --label) and show the person both prices with what each keeps.');
  console.log('Show the person: ' + mine.map(x => '"' + x.label + '" ' + x.credits + ' credit(s)' + (x.keeps ? ' (keeps ' + x.keeps + ')' : '')).join(' | ') + '. Nothing is spent until approve.');
} else if (cmd === 'approve') {
  const t = need(); const take = takeName(); const label = opt('--label', 'default');
  const q = t.quotes.find(x => x.take === take && x.label === label);
  if (!q) die('no quote "' + label + '" for ' + take + '; quote it first (' + (t.quotes.filter(x => x.take === take).map(x => x.label).join(', ') || 'none quoted') + ')', 3);
  const by = opt('--by'); if (!by) die('approve needs --by <the person who said yes>; the run never approves its own spend', 2);
  t.approvals.push({ id: 'a' + (t.approvals.length + 1), take, label, quote: q.id, credits: q.credits, by, at: opt('--at') || L.nowIso(), recordedAt: L.nowIso() });
  save(t);
  console.log('Approved by ' + by + ': ' + take + ' "' + label + '", up to ' + approvedFor(t, take) + ' credit(s) for this take in all. Generate now and land it in this turn.');
} else if (cmd === 'land') {
  const t = need(); const take = takeName();
  const credits = Number(opt('--credits', 0)) || 0; const url = opt('--url');
  if (url && !credits) die('a generated picture or clip has a price: land needs --credits <what it cost> with --url', 2);
  if (credits > 0) {
    const ok = approvedFor(t, take); const spent = spentOnTake(t, take);
    if (!ok) die('REFUSED: no yes on record for ' + take + '. Quote it, ask the person, then: task.js ' + client + ' ' + taskId + ' approve --take ' + take + ' --label <label> --by <person>', 3);
    if (spent + credits > ok) die('REFUSED: this would take ' + take + ' to ' + (spent + credits) + ' credit(s), over the ' + ok + ' approved. Ask again.', 3);
  }
  let src = opt('--file'); let ext = src ? path.extname(src).toLowerCase() : null; let tmp = null;
  if (url) {
    L.ensureDir(file('takes')); tmp = file('takes', '.dl-' + Date.now());
    const r = spawnSync('curl', ['-sSL', '--fail', '-o', tmp, url], { encoding: 'utf8' });
    if (r.status !== 0) die('download failed: ' + (r.stderr || r.error), 1);
    src = tmp; ext = opt('--ext') || (/\.mp4|video/i.test(url) ? '.mp4' : /\.jpe?g/i.test(url) ? '.jpg' : '.png');
  }
  if (!src || !fs.existsSync(src)) die('land needs --file <path> or --url <media url>', 2);
  const slot = nextTake(t, take, ext);
  fs.copyFileSync(src, slot.file); if (tmp) fs.unlinkSync(tmp);
  const ap = credits > 0 ? t.approvals.filter(a => a.take === take).slice(-1)[0] : null;
  const rec = { take, v: slot.v, file: L.fwd(slot.file), sha256: L.sha256File(slot.file), source: credits > 0 ? 'agentc' : 'file', jobRef: opt('--job-ref'), credits, approval: ap ? ap.id : null, label: ap ? ap.label : null, at: L.nowIso() };
  t.takes.push(rec); save(t);
  if (credits > 0) R.appendCredit(dir, { kind: 'task', key: take, v: slot.v, credits, jobRef: rec.jobRef, approval: rec.approval });
  console.log(take + ' v' + pad(slot.v) + ' landed: takes/' + path.basename(slot.file) + (credits ? ' (' + credits + ' credit(s); ' + (spentOnTake(t, take)) + ' of ' + approvedFor(t, take) + ' approved spent on this take)' : '') + '.');
} else if (cmd === 'do') {
  const t = need(); const tool = rest[0];
  const EXT = { 'paste-back': null, matte: null, clip: '.mp4', frame: '.png' };
  if (!(tool in EXT)) die('do takes paste-back, matte, clip or frame (compare is: task.js ... check)', 2);
  const take = takeName();
  // File flags are resolved against the task's folders; --out and --previews are ours.
  const FILES = ['--original', '--generated', '--alpha', '--source'];
  const args = []; const made = [];
  for (let i = 1; i < rest.length; i++) {
    const k = rest[i];
    if (k === '--take' || k === '--out' || k === '--previews' || k === '--mov') { if (k !== '--mov') i++; continue; }
    if (FILES.includes(k)) { const p = resolveFile(rest[++i]); args.push(k, p); made.push({ flag: k.slice(2), file: L.fwd(p), sha256: L.sha256File(p) }); continue; }
    args.push(k);
  }
  const main = (made.find(m => m.flag === 'original') || made.find(m => m.flag === 'source') || {}).file;
  if (!main) die(tool + ' needs ' + (tool === 'paste-back' ? '--original, --generated and --alpha' : '--source'), 2);
  const ext = EXT[tool] || (IMAGE.test(main) ? '.png' : has('--mov') ? '.mov' : '.mp4');
  const slot = nextTake(t, take, ext);
  const result = runShot([tool, ...args, '--out', slot.file, '--previews', file('previews')]);
  const rec = { take, v: slot.v, file: L.fwd(slot.file), sha256: L.sha256File(slot.file), source: tool, credits: 0, madeFrom: made, metrics: result, flagged: (result.flags || []).length > 0, at: L.nowIso() };
  t.takes.push(rec); save(t);
  for (const f of result.flags || []) console.log('FLAG: ' + f);
  for (const n of result.notes || []) console.log('NOTE: ' + n);
  const m = result;
  const line = tool === 'paste-back' ? 'kept area ' + m.keptAreaPct + '% of the frame' + (m.keptPct == null ? '' : ', ' + m.keptPct + '% of it the original\'s own pixels; the model had redrawn ' + m.modelRedrewKeptPct + '% of it') + '. Look at previews/' + path.basename(m.edges || m.beforeAfter || '') + '.'
    : tool === 'matte' ? 'by ' + m.method + (m.model ? ' ' + m.model : '') + ', subject covers ' + m.subjectCoveragePct + '% of the middle frame. Look at previews/' + path.basename(m.midFrame) + '.'
      : tool === 'clip' ? m.seconds + ' s from ' + m.from + ' s' + (m.fitsVideoModel ? '' : ' (outside the video model\'s 4 to 15 s)') + '.' : 'at ' + m.at + ' s.';
  console.log(take + ' v' + pad(slot.v) + ' (' + tool + '): takes/' + path.basename(slot.file) + ', ' + line);
} else if (cmd === 'check') {
  const t = need();
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (k === '--take') { i++; continue; }
    if (['--a', '--b', '--alpha'].includes(k)) { args.push(k, resolveFile(rest[++i])); continue; }
    args.push(k);
  }
  const result = runShot(['compare', ...args]);
  const take = opt('--take');
  t.checks = (t.checks || []).concat({ take: take || null, at: L.nowIso(), ...result });
  if (take) { const last = t.takes.filter(x => x.take === take).slice(-1)[0]; if (last) { last.check = { structurePct: result.structurePct, shiftPctOfWidth: result.shiftPctOfWidth, flags: result.flags }; if (result.flags.length) last.flagged = true; } }
  save(t);
  for (const f of result.flags) console.log('FLAG: ' + f);
  for (const n of result.notes) console.log('NOTE: ' + n);
  console.log('Structure kept ' + result.structurePct + '% on the worst of ' + result.frames.length + ' frame(s); the picture slid ' + result.shiftPctOfWidth + '% of its width.' + (result.flags.length ? '' : ' Nothing flagged.'));
} else if (cmd === 'status') {
  const t = need();
  const ledger = R.readCredits(dir) || [];
  const spent = R.spentOn(ledger, 'task');
  if (has('--json')) { console.log(JSON.stringify({ ...t, spent }, null, 2)); process.exit(0); }
  console.log(t.title + ' (' + t.taskId + ', ' + t.client + ')');
  console.log('Inputs: ' + (t.inputs.map(i => i.name + ' ' + i.width + 'x' + i.height).join(', ') || 'none'));
  const names = [...new Set(t.takes.map(x => x.take).concat(t.quotes.map(q => q.take)))];
  for (const n of names) {
    const takes = t.takes.filter(x => x.take === n);
    const open = t.quotes.filter(q => q.take === n && !t.approvals.some(a => a.quote === q.id));
    console.log(n + ': ' + (takes.map(x => 'v' + pad(x.v) + ' ' + x.source + (x.credits ? ' ' + x.credits + 'cr' : '') + (x.flagged ? ' FLAGGED' : '')).join(', ') || 'no take yet')
      + (approvedFor(t, n) ? ' · ' + spentOnTake(t, n) + ' of ' + approvedFor(t, n) + ' approved credit(s) spent' : '')
      + (open.length && !approvedFor(t, n) ? ' · waiting for a yes: ' + open.map(q => '"' + q.label + '" ' + q.credits).join(' | ') : ''));
  }
  console.log('Spent on this task: ' + spent + ' credit(s).');
} else {
  die(USAGE, 2);
}
