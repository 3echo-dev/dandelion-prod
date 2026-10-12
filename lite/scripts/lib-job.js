// The job library: where a Prod-Lite job lives, how its files are read and written, and the
// step list every script and the board agree on. Research and references come first, from the
// brief and the context alone; the cut is read next; the look ties the two together.
//
// A job lives at <root>/workspaces/<client>/jobs/<job-id>/ (root: --root, PROD_LITE_ROOT,
// .prod-lite/config.json, else the current folder; lib-workspace.js decides). Run every
// script from the root: cutout.py and composite.py resolve workspaces/ from it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');

const fwd = p => String(p).split(path.sep).join('/');
const ensureDir = d => fs.mkdirSync(d, { recursive: true });
const sha256File = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sha256Text = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const nowIso = () => new Date().toISOString();

// The pipeline, in order: the board's step ids, its seat ids, and the stage each belongs to
// (the project's status word on the board). Keep in step with FINISH in board/src.
const STAGES = [
  { key: 'intake', label: 'Intake', agent: 'orchestrator', stage: 'intake' },
  { key: 'research', label: 'Research', agent: 'researcher', stage: 'look' },
  { key: 'scraper', label: 'References', agent: 'scraper', stage: 'look' },
  { key: 'catalogue', label: 'Catalogue', agent: 'cataloguer', stage: 'look' },
  { key: 'interrogate', label: 'Interrogate', agent: 'interrogator', stage: 'look' },
  { key: 'look', label: 'Look', agent: 'researcher', stage: 'look' },
  { key: 'hybrid', label: 'Hybrid', agent: 'renderer', stage: 'picture' },
  { key: 'grade', label: 'Colour grade', agent: 'renderer', stage: 'picture' },
  { key: 'mograph', label: 'Motion graphics', agent: 'renderer', stage: 'picture' },
  { key: 'render', label: 'Master', agent: 'renderer', stage: 'master' },
  { key: 'review', label: 'Review', agent: 'interrogator', stage: 'master' },
];
const STAGE_KEYS = STAGES.map(s => s.key);
const SEATS = ['orchestrator', 'cataloguer', 'interrogator', 'researcher', 'scraper', 'renderer'];
const STATUSES = ['pending', 'running', 'done', 'blocked', 'skipped'];

// The two sign-offs, made on the board by a person.
const GATES = { A: 'Look sign-off', B: 'Master sign-off' };

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(p + '.tmp', p);
}

// "<client> <job-id> rest..." or a path to the job folder / job.json.
function open(argv) {
  const r = ws.resolveJobArgs(argv, argv);
  if (!r.client || !r.jobId) return null;
  const dir = r.dir;
  return {
    client: r.client, jobId: r.jobId, dir, rest: r.rest,
    file: (...p) => path.join(dir, ...p),
    job: () => readJson(path.join(dir, 'job.json'), null),
    saveJob: j => writeJson(path.join(dir, 'job.json'), j),
    read: (name, fb) => readJson(path.join(dir, name), fb),
    write: (name, data) => writeJson(path.join(dir, name), data),
  };
}

function opt(argv, name, dflt = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : dflt;
}

const has = (argv, name) => argv.includes(name);

// status.json: one row per step, plus a log of every change.
function readStatus(J) {
  const s = J.read('status.json', null) || { stages: {}, log: [] };
  for (const st of STAGES) if (!s.stages[st.key]) s.stages[st.key] = { status: 'pending', note: '', at: null };
  return s;
}

// A step's state on disk (status.json) and on the board: the step reads Working while it runs,
// the project card says which stage and who. A delivery (record-version.js) moves the step to
// Draft; approving it is a person's, on the board.
function setStage(J, key, status, note, by) {
  if (!STAGE_KEYS.includes(key)) throw new Error('unknown step ' + key + ' (one of ' + STAGE_KEYS.join(', ') + ')');
  if (!STATUSES.includes(status)) throw new Error('unknown status ' + status + ' (one of ' + STATUSES.join(', ') + ')');
  const st = STAGES.find(x => x.key === key);
  const who = by || st.agent;
  const s = readStatus(J);
  s.stages[key] = { status, note: note || '', at: nowIso(), by: who };
  s.log.push({ stage: key, status, note: note || '', at: nowIso(), by: who });
  // The project's stage word only moves forward: finishing an earlier step late does not send
  // the card back to an earlier stage.
  const rank = ['intake', 'look', 'picture', 'master'];
  const stageNow = rank.indexOf(s.projectStage) >= rank.indexOf(st.stage) ? s.projectStage : st.stage;
  s.projectStage = stageNow;
  J.write('status.json', s);
  const board = require('./lib-board.js');
  const at = nowIso();
  const word = st.stage[0].toUpperCase() + st.stage.slice(1);
  const activity = [word, st.label, status === 'running' ? 'working' : status === 'blocked' ? 'waiting' : status, who, note].filter(Boolean).join(' · ');
  if (status === 'running') board.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'items', docId: key, op: 'update', data: { status: 'running', updatedAt: at, updatedBy: who } });
  board.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'projects', docId: J.jobId, op: 'update', data: { status: stageNow, activity: activity.slice(0, 200), heartbeatAt: at } });
  return s;
}

// A line in an agent's chat on the board, and in messages.jsonl, the job's own log.
function say(J, agent, text, item) {
  const at = nowIso();
  const rec = { by: agent, text: String(text).slice(0, 2000), item: item || null, at };
  const p = J.file('messages.jsonl');
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, JSON.stringify(rec) + '\n');
  const id = 'm-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  require('./lib-board.js').appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'messages', docId: id, data: rec });
}

function messages(J) {
  try { return fs.readFileSync(J.file('messages.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
}

module.exports = {
  fwd, ensureDir, sha256File, sha256Text, nowIso, STAGES, STAGE_KEYS, SEATS, STATUSES, GATES,
  readJson, writeJson, open, opt, has, readStatus, setStage, say, messages, ws,
};
