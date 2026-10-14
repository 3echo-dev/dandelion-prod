#!/usr/bin/env node
// Stop hook for the outbox pipelines (Prod-Lite and post; pre for the token count only, since its
// own turn.js keeps its board). Two jobs, both at the end of a turn:
//
//   1. The board never lags the job folder. Any job with writes still queued in
//      .board/outbox.jsonl is pushed: in file mode (no board address) this hook pushes it itself;
//      in artifact mode only the model can hand the batches to the ArtifactData tool, so the turn
//      is refused once with the command to run. Once per queue state per session: a run that was
//      told and still stops has a reason, and a second refusal would be a loop.
//   2. The orchestrator's own tokens. It is never spawned, so record-run.js never sees it. The
//      transcript Claude Code hands this hook holds every turn's usage; the session's total is
//      written to runs/orchestrator-{session}.json of the job this session last worked on, and
//      tally-cost.js counts it on the next push.
//
// Rules, as for every hook here: no network, no output unless refusing, exit 0 on any fault.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LITE = path.resolve(__dirname, '..');
const POST = path.resolve(__dirname, '..', '..', '..', 'post', 'scripts');
const PRE = path.resolve(__dirname, '..', '..', '..', 'pre', 'scripts');

function readStdin() {
  return new Promise(resolve => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { raw += d; });
    process.stdin.on('error', () => resolve(''));
    process.stdin.on('end', () => resolve(raw));
  });
}

// Every job folder under the roots the two pipelines would resolve from this cwd.
function jobsHere() {
  const out = new Map();
  for (const [pipeline, scripts] of [['lite', LITE], ['post', POST], ['pre', PRE]]) {
    let ws; try { ws = require(path.join(scripts, 'lib-workspace.js')); } catch { continue; }
    let clients = []; try { clients = ws.listClients([]); } catch { clients = []; }
    for (const client of clients) {
      let jobs = []; try { jobs = ws.listJobs(client, []); } catch { jobs = []; }
      for (const jobId of jobs) {
        const dir = path.resolve(ws.jobDir(client, jobId, []));
        if (!out.has(dir) && fs.existsSync(path.join(dir, 'job.json'))) out.set(dir, { pipeline, scripts, client, jobId, dir });
      }
    }
  }
  return [...out.values()];
}

const lines = p => { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const mtime = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const lastTouched = j => Math.max(...['.board/outbox.jsonl', '.board/pushed.log', 'versions.jsonl', 'status.md', 'hybrid-brief.json', 'credits.jsonl'].map(f => mtime(path.join(j.dir, f))));

async function main() {
  if (process.stdin.isTTY) return;
  let hook = {};
  try { hook = JSON.parse(await readStdin()) || {}; } catch { return; }
  if (!hook || typeof hook.hook_event_name !== 'string') return;
  if (hook.hook_event_name === 'SubagentStop') return;
  try { if (hook.cwd && fs.existsSync(hook.cwd)) process.chdir(hook.cwd); } catch { return; }

  const jobs = jobsHere();
  if (!jobs.length) return;

  // 2 first: it must happen whether or not the turn is refused below.
  if (hook.transcript_path && fs.existsSync(hook.transcript_path)) {
    const started = (() => { try { const s = fs.statSync(hook.transcript_path); return s.birthtimeMs || s.ctimeMs; } catch { return 0; } })();
    const touched = jobs.map(j => ({ j, t: lastTouched(j) })).filter(x => x.t >= started).sort((a, b) => b.t - a.t);
    if (touched.length) {
      try {
        const R = require(path.join(LITE, 'lib-runs.js'));
        const usage = R.sessionUsage(hook.transcript_path);
        if (usage && usage.turns) R.recordOrchestrator(touched[0].j.dir, hook.session_id, usage);
      } catch { /* a missed count is not worth a failed turn */ }
    }
  }

  // 1: anything still queued for the board.
  const queued = jobs.filter(j => j.pipeline !== 'pre').map(j => ({ ...j, n: lines(path.join(j.dir, '.board', 'outbox.jsonl')) })).filter(j => j.n);
  if (!queued.length) return;
  const waiting = [];
  for (const j of queued) {
    let board; try { board = require(path.join(j.scripts, 'lib-board.js')); } catch { continue; }
    if (board.mode() === 'file') {
      spawnSync(process.execPath, [path.join(j.scripts, 'board-sync.js'), 'push', j.client, j.jobId], { encoding: 'utf8', timeout: 8000 });
      continue;
    }
    waiting.push(j);
  }
  if (!waiting.length || hook.stop_hook_active) return;
  const stamp = path.join(waiting[0].dir, '.board', 'stop-push.json');
  const key = String(hook.session_id || '') + '|' + waiting.map(j => j.jobId + ':' + j.n).join(',');
  try { if (JSON.parse(fs.readFileSync(stamp, 'utf8')).key === key) return; } catch { /* first time */ }
  try { fs.writeFileSync(stamp, JSON.stringify({ key, at: new Date().toISOString() }) + '\n'); } catch { return; }
  const cmds = waiting.map(j => 'node "' + path.join(j.scripts, 'board-sync.js').split(path.sep).join('/') + '" push ' + j.client + ' ' + j.jobId + ' --files  (' + j.n + ' queued)');
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'The board is behind the job folder: writes are still queued for it, so the person sees an older state than the chat. Push them now: ' + cmds.join('; ') +
      '. Hand each batch to the ArtifactData tool (action batch) on the board, then run the same push with --ack. If the board cannot be reached, say so in the chat and stop.',
  }));
}

main().catch(() => {}).finally(() => process.exitCode = 0);
