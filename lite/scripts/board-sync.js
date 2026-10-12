#!/usr/bin/env node
// board-sync: keeps the Prod-Lite board and the job folder agreeing.
//
// Commands (positionals or --client/--job flags, both accepted):
//   open  {client} {job-id}                          project + ten item rows on the board
//   push  {client} {job-id} [--json|--files] [--ack] drain .board/outbox.jsonl to the board
//   ask   {client} {job-id} --item X --text "..." [--options "a|b|c"] [--blocks <request id>]
//   land  {client} {job-id} [<landed.json>]          what the person decided, back on disk
//   pull  {client} {job-id} --gate A|B               bind a locked gate to the file hashes
//   adopt {client} {job-id} --from <slate id>        the card a person opened on the slate now points at this job
//
// Two modes, from lib-board.js: with a board address set (PROD_LITE_BOARD_URL or
// .prod-lite/config.json) `push` PRINTS write batches for the Artifact tool's
// database and `push --ack` drains the outbox after the tool accepted them; `land` takes the
// JSON the tool read back and materialises it under .board/db/ so `pull` works the same in both
// modes. With no address (tests, offline) `push` writes .board/db/ directly.
//
// Exit codes: 0 ok · 1 version or hash mismatch · 2 usage · 3 nothing to land or no decision

const fs = require('fs');
const path = require('path');
const lib = require('./lib-board.js');

const argv = process.argv.slice(2);
const cmd = argv[0];
const CWD = process.cwd();
const BATCH = 50;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: board-sync.js open|push|ask|land|pull|adopt <client> <job-id> [--json] [--ack] [--gate A|B] [--from <slate id>] [--item X --text "..." --options "a|b" --blocks <id>]');
  process.exit(2);
}

function parseFlags(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = list[i + 1] !== undefined && !String(list[i + 1]).startsWith('--') ? list[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const flags = parseFlags(argv.slice(1));
const client = flags.client || flags._[0];
const jobId = flags.job || flags._[1];
if (!['open', 'push', 'ask', 'land', 'pull', 'adopt'].includes(cmd)) usage('unknown command: ' + cmd);
if (!client || !jobId) usage(cmd + ' needs {client} {job-id}');
const jobDir = lib.jobRoot(CWD, client, jobId);
const MODE = lib.mode();
const now = () => new Date().toISOString();

// The ten items the board shows; the two gates are rows of their own on the page.
const ITEMS = require('./lib-job.js').STAGE_KEYS;

// Where a queued record lands on the artifact's database. The outbox stays in the short form
// (collection 'items', docId 'sequence'); the page reads projects/{job}/items/sequence.
function fullCollection(collection) {
  if (collection === 'projects') return 'projects';
  return 'projects/' + jobId + '/' + collection;
}

// ---- file-mode write (also used by land to materialise what the tool read) ----
// Collections only the pipeline writes; their versions are kept on disk (see push).
const OWN = /\/(panels|previews|references|runs|versions)$/;

function fileWrite(record) {
  if (record.op === 'delete') { fs.rmSync(path.join(lib.dbRoot(CWD, client, jobId), record.collection, record.docId + '.json'), { force: true }); return 0; }
  // An update merges into what is there, as the database does; a set replaces it.
  const prev = record.op === 'update' ? lib.readDbDoc(CWD, client, jobId, record.collection, record.docId) : null;
  return lib.writeDbDoc(CWD, client, jobId, record.collection, record.docId, prev ? Object.assign({}, prev, record.data) : record.data, record.ifVersion);
}

if (cmd === 'open') {
  const jobJsonPath = path.join(jobDir, 'job.json');
  if (!fs.existsSync(jobJsonPath)) { console.error('job.json missing at ' + lib.fwd(jobJsonPath)); process.exit(2); }
  const job = JSON.parse(fs.readFileSync(jobJsonPath, 'utf8'));
  const ctx = f => { try { return fs.readFileSync(path.join(jobDir, f), 'utf8').trim().slice(0, 2000); } catch { return ''; } };
  const project = {
    title: job.title, client: job.client, status: 'intake', createdAt: now(), createdBy: 'pipeline',
    aspectRatio: job.aspectRatio || '', durationSec: (job.source || {}).duration || null, firstCut: (job.source || {}).name || '',
    brief: ctx('brief.md'), context: ctx('context.md'),
  };
  lib.appendOutbox(CWD, client, jobId, { collection: 'projects', docId: jobId, data: { kind: 'lite', ...project } }); // kind: the board draws the Prod-Lite pipeline
  for (const it of ITEMS) lib.appendOutbox(CWD, client, jobId, { collection: 'items', docId: it, data: { status: 'pending', version: 0, summary: '', updatedAt: now(), updatedBy: 'pipeline' } });
  lib.appendOutbox(CWD, client, jobId, { collection: 'messages', docId: 'm-' + Date.now().toString(36), data: { by: 'pipeline', text: 'Project opened from the first cut. The cataloguer splits it into shots next.', at: now() } });
  if (MODE === 'file') {
    for (const r of lib.readOutbox(CWD, client, jobId)) fileWrite(r);
    lib.clearOutbox(CWD, client, jobId);
    console.log('opened project ' + jobId + ' on the file board with ' + ITEMS.length + ' items');
  } else {
    console.log('Queued the project and ' + ITEMS.length + ' items for the board. Run push next.');
  }
  process.exit(0);
}

if (cmd === 'push') {
  const outbox = lib.readOutbox(CWD, client, jobId);
  if (flags.ack) {
    // Every pipeline-owned document the push carried is now one version on.
    const own = lib.readOwnVersions(CWD, client, jobId);
    const seen = new Set();
    for (const r of outbox) {
      const key = fullCollection(r.collection) + '/' + r.docId;
      if (!OWN.test(fullCollection(r.collection)) || seen.has(key)) continue;
      seen.add(key);
      if (r.op === 'delete') delete own[key]; else own[key] = (own[key] || 0) + 1;
    }
    lib.writeOwnVersions(CWD, client, jobId, own);
    lib.clearOutbox(CWD, client, jobId);
    const log = path.join(jobDir, '.board', 'pushed.log');
    lib.ensureDir(path.dirname(log));
    fs.appendFileSync(log, now() + ' acked ' + outbox.length + ' write(s)\n');
    console.log('acknowledged: outbox drained (' + outbox.length + ' write(s))');
    process.exit(0);
  }
  if (outbox.length === 0) { console.log('push: empty outbox, nothing to send'); process.exit(0); }
  if (MODE === 'file') {
    const results = [];
    for (const record of outbox) {
      try { results.push({ collection: record.collection, docId: record.docId, version: fileWrite(record) }); }
      catch (e) {
        if (e.code === 'VERSION_MISMATCH') { console.error('push failed: ' + e.message); process.exit(1); }
        throw e;
      }
    }
    lib.clearOutbox(CWD, client, jobId);
    console.log(`pushed ${results.length} write(s) to board`);
    for (const r of results) console.log(`  ${r.collection}/${r.docId} v${r.version}`);
    process.exit(0);
  }
  // Artifact mode: one write per document (a later record for the same doc wins), batches of 50.
  const byDoc = new Map();
  for (const r of outbox) {
    const key = fullCollection(r.collection) + '/' + r.docId;
    const prev = byDoc.get(key);
    // One document, several records: a set replaces what came before; an update after a set
    // folds into that set (so a status change queued after `open` does not drop the fields
    // `open` wrote); an update after an update merges.
    let op = r.op || 'set', data = r.data;
    if (prev && op === 'update') { op = prev.op; data = Object.assign({}, prev.data, r.data); }
    const ifVersion = r.ifVersion !== undefined ? r.ifVersion : (prev && prev.if_version);
    byDoc.set(key, { op, collection: fullCollection(r.collection), doc_id: r.docId, data, ...(ifVersion !== undefined ? { if_version: ifVersion } : {}) });
  }
  // Documents only the pipeline writes (shot cards, previews, references, runs, versions) carry the
  // version this job last gave them, from .board/own-versions.json, so they need no read first.
  const own = lib.readOwnVersions(CWD, client, jobId);
  for (const w of byDoc.values()) {
    if (!OWN.test(w.collection) || w.if_version !== undefined) continue;
    const v = own[w.collection + '/' + w.doc_id];
    if (v) w.if_version = v;
    else if (w.op === 'update') w.op = 'set'; // never written yet: an update has nothing to merge into
  }
  // A delete of a pipeline document that never reached the board has nothing to delete.
  const all = [...byDoc.values()].filter(w => !(w.op === 'delete' && OWN.test(w.collection) && !w.if_version));
  const batches = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  // An update needs the document's current version pinned; a set on a document the person
  // may have touched (items, gates) is listed as a pin the orchestrator reads first.
  const pins = all.filter(w => !OWN.test(w.collection) && (w.op === 'update' || w.op === 'delete' || /\/(items|gates)$/.test(w.collection))).map(w => ({ collection: w.collection, doc_id: w.doc_id, ...(w.op === 'set' ? { mayExist: true } : {}) }));
  const out = { url: lib.boardUrl(), project: jobId, count: all.length, pins, batches };
  // --files: each document body goes to .board/push/<n>.json and the batch names the file, so a
  // preview thumbnail or a run output never has to be retyped into the tool call.
  if (flags.files) {
    const pushDir = path.join(jobDir, '.board', 'push');
    fs.rmSync(pushDir, { recursive: true, force: true }); lib.ensureDir(pushDir);
    let n = 0;
    const fileBatches = batches.map(batch => batch.map(w => {
      if (w.op === 'delete') { const { data, ...rest } = w; return rest; }
      const f = path.join(pushDir, String(n++) + '.json');
      fs.writeFileSync(f, JSON.stringify(w.data));
      const { data, ...rest } = w; return { ...rest, file_path: lib.fwd(f) };
    }));
    console.log(JSON.stringify({ ...out, batches: fileBatches }, null, 2));
    process.exit(0);
  }
  if (flags.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(all.length + ' write(s) in ' + batches.length + ' batch(es) for project ' + jobId + ' (' + pins.length + ' pin(s)).');
    for (const w of all) console.log('  ' + w.op + ' ' + w.collection + '/' + w.doc_id);
    console.log('Hand each batch to the ArtifactData tool (action batch, writes) on the board, then run push --ack. Use --json to print them.');
  }
  process.exit(0);
}

// The slate form opened a project on the board with a board id and no folder. Once the job
// exists, its card points at the job and hides; the job's own page carries on.
if (cmd === 'adopt') {
  const from = flags.from;
  if (!from || from === true || String(from) === jobId) usage('adopt needs --from <the slate project id the person opened>');
  lib.appendOutbox(CWD, client, jobId, { collection: 'projects', docId: String(from), op: 'update', data: { status: 'moved', movedTo: jobId, movedAt: now() } });
  console.log('Queued: slate project ' + from + ' now points at ' + jobId + '. Push next.');
  process.exit(0);
}

if (cmd === 'ask') {
  const { item, text, options, blocks } = flags;
  if (!item || !text) usage('ask needs --item and --text');
  const id = 'q-' + Date.now().toString(36);
  const data = { type: 'question', item, text, from: 'pipeline', status: 'open', createdAt: now() };
  if (options) data.options = String(options).split('|').map(s => s.trim()).filter(Boolean);
  if (blocks) data.blocks = String(blocks);
  lib.appendOutbox(CWD, client, jobId, { collection: 'inbox', docId: id, data });
  if (blocks) lib.appendOutbox(CWD, client, jobId, { collection: 'inbox', docId: String(blocks), op: 'update', data: { status: 'waiting', waitingOn: id, waitingText: text } });
  console.log('Question for the board (' + item + '): ' + text + (data.options ? '  Options: ' + data.options.join(' / ') : ''));
  console.log('Say the same in chat, then push.');
  process.exit(0);
}

// ---- land: what the person decided, back on disk ----
function normaliseLanded(raw) {
  // Accepts: [{collection, documents:[...]}], [{collection, docs:[...]}], [{collection, id, ...}],
  // or a single object of any of those shapes. Each document keeps its id and version.
  const groups = Array.isArray(raw) ? raw : [raw];
  const docs = [];
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const inner = g.documents || g.docs;
    if (Array.isArray(inner)) for (const d of inner) docs.push(flattenDoc(d, g.collection));
    else docs.push(flattenDoc(g, g.collection));
  }
  return docs.filter(d => d.collection && d.id);
}
function flattenDoc(d, collection) {
  const data = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d;
  const id = d.id || d.doc_id || d.docId || (d.path ? String(d.path).split('/').pop() : null);
  const col = collection || d.collection || (d.path ? String(d.path).split('/').slice(0, -1).join('/') : null);
  const out = Object.assign({}, data);
  delete out.data; delete out.collection; delete out.doc_id; delete out.docId; delete out.path;
  return { collection: col, id, version: d.version || data.version || data._version, data: out };
}
// A folder the ArtifactData tool filled with out_dir: <dir>/<collection path>/<doc id>.json, each file
// {id, data:{...}, version, updatedAt}. The collection is the file's folder path relative to the root.
function readLandedDir(root) {
  const docs = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
      if (!name.endsWith('.json')) continue;
      let raw; try { raw = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
      const collection = lib.fwd(path.relative(root, dir));
      const id = raw.id || name.replace(/\.json$/, '');
      docs.push(flattenDoc(Object.assign({}, raw, { id }), collection));
    }
  };
  walk(root);
  return docs.filter(d => d.collection && d.id);
}
function shortCollection(col) {
  const prefix = 'projects/' + jobId + '/';
  if (col === 'projects') return 'projects';
  return col.startsWith(prefix) ? col.slice(prefix.length) : col;
}

if (cmd === 'land') {
  const changed = [];
  const file = flags._[2] || flags.file;
  if (MODE === 'artifact' || file) {
    if (!file) { console.error('land needs what the ArtifactData tool read back: board-sync.js land ' + client + ' ' + jobId + ' .board/landed/{stamp} (the out_dir folder) or a JSON file'); process.exit(3); }
    const abs = path.isAbsolute(file) ? file : path.join(CWD, file);
    if (!fs.existsSync(abs)) { console.error('no such file: ' + lib.fwd(abs)); process.exit(3); }
    const docs = fs.statSync(abs).isDirectory() ? readLandedDir(abs) : normaliseLanded(JSON.parse(fs.readFileSync(abs, 'utf8')));
    if (!docs.length) { console.error('nothing to land in ' + lib.fwd(abs) + ' (no documents with a collection and an id)'); process.exit(3); }
    lib.ensureDir(lib.landedDir(CWD, client, jobId));
    const keep = path.join(lib.landedDir(CWD, client, jobId), Date.now().toString(36) + '.json');
    if (!fs.statSync(abs).isDirectory() && path.resolve(abs) !== path.resolve(keep)) fs.copyFileSync(abs, keep);
    for (const d of docs) {
      const short = shortCollection(d.collection);
      const data = Object.assign({}, d.data, d.version ? { boardVersion: d.version } : {});
      if (short === 'gates') {
        // The page stamps {status:'passed', decidedBy, decidedAt, items:{id:{status,version,file,sha256,bytes}}}.
        // pull wants {decision:'approved', artifacts:[{path,sha256,bytes}]}; keep both.
        const g = String(d.id).replace(/^gate-/i, '').toLowerCase();
        const artifacts = Object.values(data.items || {}).filter(v => v && v.file && v.sha256).map(v => ({ path: v.file, sha256: v.sha256, bytes: v.bytes }));
        const rec = Object.assign({}, data, {
          gate: g.toUpperCase(),
          decision: data.status === 'passed' ? 'approved' : data.status === 'reopened' ? 'reopened' : (data.decision || 'pending'),
          artifacts: data.artifacts && data.artifacts.length ? data.artifacts : artifacts,
          round: data.round || 1,
        });
        lib.writeDbDoc(CWD, client, jobId, 'gates', 'gate-' + g, rec);
        changed.push('gate ' + g.toUpperCase() + ' ' + rec.decision + (rec.decidedBy ? ' by ' + rec.decidedBy : ''));
      } else {
        lib.writeDbDoc(CWD, client, jobId, short, d.id, data);
        if (short === 'inbox') changed.push((data.type || 'inbox') + ' ' + d.id + ' ' + (data.status || '') + (data.answer ? ' -> ' + data.answer : ''));
        else if (short === 'items' && data.status === 'approved') changed.push('item ' + d.id + ' v' + (data.version || 0) + ' approved by ' + (data.approvedBy || '?'));
        else if (short === 'items' && data.status === 'na') changed.push('item ' + d.id + ' not applicable (' + (data.naBy || '?') + ')');
        else if (short === 'items' && data.status === 'needs_review') changed.push('item ' + d.id + ' change: ' + (data.changeNote || ''));
        else if (short === 'bgm' && data.chosen) changed.push('bgm ' + d.id + ' chosen by ' + (data.chosenBy || '?'));
        else if (short === 'mograph' && data.approvedBy) changed.push('mograph ' + d.id + ' approved by ' + data.approvedBy);
      }
    }
  }
  // Both modes: project the inbox collection into .board/inbox.jsonl for the scripts.
  const inboxDir = path.join(lib.dbRoot(CWD, client, jobId), 'inbox');
  const records = fs.existsSync(inboxDir) ? fs.readdirSync(inboxDir).map(f => Object.assign({ id: f.replace(/\.json$/, '') }, JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8')))) : [];
  const ip = lib.inboxPath(CWD, client, jobId);
  lib.ensureDir(path.dirname(ip));
  fs.writeFileSync(ip, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  // A quoted request the person approved can proceed.
  for (const r of records) if (r.type === 'generate' && r.status === 'open' && r.approvedBy) changed.push('request ' + r.id + ' approved: ' + (r.text || '') + (r.credits ? ' (' + r.credits + ' credits)' : ''));
  for (const r of records) if (r.status === 'waiting' && r.waitingOn) {
    const on = records.find(x => x.id === r.waitingOn);
    if (on && on.status === 'answered') changed.push('request ' + r.id + ' can proceed: its question was answered (' + (on.answer || '') + ')');
  }
  console.log('landed ' + records.length + ' inbox record(s)' + (changed.length ? ':' : ''));
  for (const c of changed) console.log('  ' + c);
  process.exit(0);
}

if (cmd === 'pull') {
  const { gate } = flags;
  if (!gate) usage('pull needs --gate A|B');
  const gateLower = String(gate).toLowerCase();
  if (!['a', 'b'].includes(gateLower)) usage('pull --gate must be A or B');

  const rec = lib.readDbDoc(CWD, client, jobId, 'gates', `gate-${gateLower}`);
  if (!rec) { console.log(`pull: no decision recorded for gate ${gate}` + (MODE === 'artifact' ? ' (land the board first)' : '')); process.exit(3); }
  if (rec.decision !== 'approved') { console.log(`pull: gate ${gate} decision is ${rec.decision}`); process.exit(3); }
  if (!Array.isArray(rec.artifacts) || rec.artifacts.length === 0) { console.error('pull: no artifacts bound to decision; every item locked at the gate must carry file and sha256 from record-version'); process.exit(1); }

  const mismatches = [];
  for (const a of rec.artifacts) {
    const abs = path.isAbsolute(a.path) ? a.path : path.join(jobDir, a.path);
    if (!fs.existsSync(abs)) { mismatches.push(`${a.path} missing on disk`); continue; }
    const cur = lib.sha256File(abs);
    if (cur !== a.sha256) mismatches.push(`${a.path} sha256 changed since decision`);
  }
  if (mismatches.length) {
    console.error(`pull refused: ${mismatches.length} artifact(s) changed since gate ${gate} decision:`);
    for (const m of mismatches) console.error('  - ' + m);
    process.exit(1);
  }

  const approval = {
    schemaVersion: '1.0',
    approvalId: 'app-' + Date.now().toString(36),
    jobId,
    client,
    gate: String(gate).toUpperCase(),
    round: rec.round || 1,
    decision: 'approved',
    edited: false,
    artifacts: rec.artifacts,
    decidedBy: rec.decidedBy || 'creative-director',
    decidedAt: rec.decidedAt || now(),
    channel: 'board',
    comment: rec.comment || '',
  };
  const approvalDir = path.join(jobDir, 'approvals');
  lib.ensureDir(approvalDir);
  const approvalPath = path.join(approvalDir, `gate-${gateLower}.json`);
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2));
  console.log(`gate ${gate} approved: wrote ${lib.fwd(path.relative(CWD, approvalPath))}`);
  process.exit(0);
}