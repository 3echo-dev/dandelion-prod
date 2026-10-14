// Where a run record goes, and what the orchestrator's own session cost.
//
// A run is one spawn of one agent. The first spawn for an item and version is runs/{item}-v{n}.json
// (the name every older job already has); a second spawn for the same version, a retry or a redo
// after a change note, is runs/{item}-v{n}-r2.json, then -r3, so its tokens add to the first
// instead of replacing them. A record left "running" is the same spawn finishing, and reuses its
// own file.
//
// The orchestrator is not spawned, so it never calls record-run.js. The Stop hook reads the
// session transcript Claude Code hands it and writes runs/orchestrator-{session}.json against the
// job the session last worked on: one file per session, rewritten with the session's running
// total each time the turn ends.
const fs = require('fs');
const path = require('path');

const RUN_FILE = /^(.+)-v(\d+)(?:-r(\d+))?\.json$/;
const ORCH_FILE = /^orchestrator-[\w.-]+\.json$/;

function runSlot(dir, item, n) {
  const runsDir = path.join(dir, 'runs');
  const base = item + '-v' + n;
  for (let attempt = 1; ; attempt++) {
    const id = attempt === 1 ? base : base + '-r' + attempt;
    const p = path.join(runsDir, id + '.json');
    if (!fs.existsSync(p)) return { id, attempt, file: p };
    let r = null; try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* unreadable: take the next slot */ }
    if (r && r.status === 'running') return { id, attempt, file: p };
  }
}

// Every run record of a job, the orchestrator's sessions included.
function readRuns(dir) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'runs')).filter(f => RUN_FILE.test(f) || ORCH_FILE.test(f)); } catch { files = []; }
  const out = [];
  for (const f of files) {
    try { const r = JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')); if (r && r.item) out.push(r); } catch { /* skip */ }
  }
  return out;
}

// The main session's token use, from a Claude Code transcript (JSON lines). One assistant message
// can be written over several lines while it streams, so usage is counted once per message id.
// Subagent turns (isSidechain) are the directors' own and are recorded by record-run.js.
function sessionUsage(transcriptPath) {
  const u = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, turns: 0, models: [] };
  let text = '';
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"usage"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.isSidechain || e.type !== 'assistant' || !e.message || !e.message.usage) continue;
    const id = e.message.id || e.uuid;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const m = e.message.usage;
    u.input += Number(m.input_tokens) || 0;
    u.output += Number(m.output_tokens) || 0;
    u.cacheWrite += Number(m.cache_creation_input_tokens) || 0;
    u.cacheRead += Number(m.cache_read_input_tokens) || 0;
    u.turns++;
    if (e.message.model && !u.models.includes(e.message.model)) u.models.push(e.message.model);
  }
  u.tokens = u.input + u.output + u.cacheWrite + u.cacheRead;
  return u;
}

function recordOrchestrator(dir, sessionId, usage) {
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const id = 'orchestrator-' + String(sessionId || 'session').replace(/[^\w.-]/g, '').slice(0, 64);
  const p = path.join(runsDir, id + '.json');
  let startedAt = new Date().toISOString();
  try { startedAt = JSON.parse(fs.readFileSync(p, 'utf8')).startedAt || startedAt; } catch { /* first turn */ }
  const rec = {
    item: 'orchestrator', seat: 'orchestrator', version: null, status: 'running', session: sessionId || null,
    model: usage.models.join(', ') || null, turns: usage.turns, tokens: usage.tokens,
    usage: { input: usage.input, output: usage.output, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead },
    startedAt, finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(rec, null, 2) + '\n');
  return { id, rec };
}

// The credit ledger: credits.jsonl, one line per thing that landed and what it cost. Lines are
// only ever added, so a redo adds its spend to the first one instead of replacing it.
function appendCredit(dir, entry) {
  const line = { at: new Date().toISOString(), ...entry, credits: Number(entry.credits) || 0 };
  fs.appendFileSync(path.join(dir, 'credits.jsonl'), JSON.stringify(line) + '\n');
  return line;
}
function readCredits(dir) {
  try { return fs.readFileSync(path.join(dir, 'credits.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); }
  catch { return null; }
}
const spentOn = (lines, kind) => (lines || []).filter(l => !kind || l.kind === kind).reduce((s, l) => s + (Number(l.credits) || 0), 0);

// The next free version number for a generated file: <stem>-v1<ext>, <stem>-v2<ext>, ...
function nextVersionFile(folder, stem, ext) {
  for (let v = 1; ; v++) {
    const p = path.join(folder, stem + '-v' + v + ext);
    if (!fs.existsSync(p)) return { file: p, v };
  }
}

module.exports = { RUN_FILE, ORCH_FILE, runSlot, readRuns, sessionUsage, recordOrchestrator, appendCredit, readCredits, spentOn, nextVersionFile };
