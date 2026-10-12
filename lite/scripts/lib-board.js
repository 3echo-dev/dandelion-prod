// The board library: where the job lives on disk, the file-backed board database, and which
// Prod-Lite board this workspace talks to.
//
// Two modes, decided by whether a board address is set:
//   artifact  PROD_LITE_BOARD_URL, or boardUrl in .prod-lite/config.json
//             (searched upward from cwd). board-sync.js prints write batches for the Artifact
//             tool's database and lands what the tool read back.
//   file      no address. board-sync.js reads and writes .board/db/ under the job folder
//             directly. Tests and offline runs use this; nothing else differs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');

const CONFIG_DIR = '.prod-lite';
const CONFIG_FILE = 'config.json';
const fwd = p => String(p).split(path.sep).join('/');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// The job folder, from the workspace resolver (--root, PROD_LITE_ROOT, the config,
// else the current folder). The cwd argument is kept for callers; the resolver decides.
function jobRoot(cwd, client, jobId) {
  return ws.jobDir(client, jobId, process.argv);
}

function dbRoot(cwd, client, jobId) {
  return path.join(jobRoot(cwd, client, jobId), '.board', 'db');
}

function outboxPath(cwd, client, jobId) {
  return path.join(jobRoot(cwd, client, jobId), '.board', 'outbox.jsonl');
}

function inboxPath(cwd, client, jobId) {
  return path.join(jobRoot(cwd, client, jobId), '.board', 'inbox.jsonl');
}

function landedDir(cwd, client, jobId) {
  return path.join(jobRoot(cwd, client, jobId), '.board', 'landed');
}

function readOutbox(cwd, client, jobId) {
  const p = outboxPath(cwd, client, jobId);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function appendOutbox(cwd, client, jobId, record) {
  const p = outboxPath(cwd, client, jobId);
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, JSON.stringify(record) + '\n');
}

function clearOutbox(cwd, client, jobId) {
  const p = outboxPath(cwd, client, jobId);
  if (fs.existsSync(p)) fs.writeFileSync(p, '');
}

function writeDbDoc(cwd, client, jobId, collection, docId, data, ifVersion) {
  const dir = path.join(dbRoot(cwd, client, jobId), collection);
  ensureDir(dir);
  const p = path.join(dir, docId + '.json');
  if (fs.existsSync(p) && ifVersion !== undefined) {
    const existing = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (existing._version !== ifVersion) {
      const err = new Error(`version mismatch: doc ${collection}/${docId} is at ${existing._version}, tried ${ifVersion}`);
      err.currentVersion = existing._version;
      err.code = 'VERSION_MISMATCH';
      throw err;
    }
  }
  const version = (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8'))._version || 0 : 0) + 1;
  const payload = Object.assign({}, data, { _version: version, _updatedAt: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  return version;
}

function readDbDoc(cwd, client, jobId, collection, docId) {
  const p = path.join(dbRoot(cwd, client, jobId), collection, docId + '.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// The versions of the documents only the pipeline writes, as the board numbered them: 1 after the
// first acknowledged push, one more after each. A rejected batch is never acknowledged.
function ownVersionsPath(cwd, client, jobId) {
  return path.join(jobRoot(cwd, client, jobId), '.board', 'own-versions.json');
}
function readOwnVersions(cwd, client, jobId) {
  try { return JSON.parse(fs.readFileSync(ownVersionsPath(cwd, client, jobId), 'utf8')); } catch { return {}; }
}
function writeOwnVersions(cwd, client, jobId, v) {
  const p = ownVersionsPath(cwd, client, jobId);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

// ---- which board ----
function readConfigFrom(dir) {
  try {
    const p = path.join(dir, CONFIG_DIR, CONFIG_FILE);
    if (fs.existsSync(p)) return { config: JSON.parse(fs.readFileSync(p, 'utf8')), at: p };
  } catch { /* a malformed config must not stop a run */ }
  return null;
}

function findConfig(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const hit = readConfigFrom(dir);
    if (hit) return hit;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function boardWithSource() {
  if (process.env.PROD_LITE_BOARD_URL) return { url: process.env.PROD_LITE_BOARD_URL, source: 'PROD_LITE_BOARD_URL' };
  const found = findConfig();
  if (found && found.config && found.config.boardUrl) return { url: found.config.boardUrl, source: fwd(found.at) };
  return null;
}

const boardUrl = () => { const b = boardWithSource(); return b ? b.url : null; };
const mode = () => (boardUrl() ? 'artifact' : 'file');

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  fwd,
  sha256File,
  ensureDir,
  jobRoot,
  dbRoot,
  outboxPath,
  inboxPath,
  landedDir,
  readOutbox,
  appendOutbox,
  clearOutbox,
  writeDbDoc,
  readDbDoc,
  readOwnVersions,
  writeOwnVersions,
  findConfig,
  boardWithSource,
  boardUrl,
  mode,
};