#!/usr/bin/env node
// Token and credit accounting: one run record per spawn, the orchestrator's session read from its
// transcript, the tally that adds them up, and the Stop hook that records it and keeps the board
// from lagging. Runs in a temp folder against the file board.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const R = require(path.join(SCRIPTS, 'lib-runs.js'));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-cost-'));
const C = 'acme', JOB = 'job-cost-test';
const JD = path.join(ROOT, 'workspaces', C, 'jobs', JOB);
const env = { ...process.env, PROD_LITE_ROOT: ROOT };
delete env.PROD_LITE_BOARD_URL;
const step = (name, fn) => { fn(); console.log('  ok  ' + name); };

try {
  fs.mkdirSync(JD, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'workspaces', C, 'workspace.json'), '{}');
  fs.writeFileSync(path.join(JD, 'job.json'), JSON.stringify({ jobId: JOB }));
  fs.writeFileSync(path.join(JD, 'prompt.txt'), 'Do the thing.');
  fs.writeFileSync(path.join(JD, 'out.md'), '# out');
  const rec = (extra = []) => spawnSync(process.execPath, [path.join(SCRIPTS, 'record-run.js'), C, JOB, '--item', 'look', '--n', '1', '--seat', 'researcher', '--prompt-file', 'prompt.txt', '--output-file', 'out.md', ...extra], { cwd: ROOT, env, encoding: 'utf8' });

  step('a retry on the same version keeps its own record', () => {
    assert.strictEqual(rec(['--tokens', '1000', '--turns', '4']).status, 0);
    assert.strictEqual(rec(['--tokens', '500', '--turns', '2']).status, 0);
    assert.ok(fs.existsSync(path.join(JD, 'runs', 'look-v1.json')));
    assert.ok(fs.existsSync(path.join(JD, 'runs', 'look-v1-r2.json')));
    const t = require(path.join(SCRIPTS, 'tally-cost.js')).tally(JD);
    assert.strictEqual(t.byItem.look.tokens, 1500);
    assert.strictEqual(t.byItem.look.runs, 2);
  });

  step('a running record is the same spawn finishing, not a new one', () => {
    assert.strictEqual(rec(['--status', 'running']).status, 0);
    assert.strictEqual(rec(['--tokens', '300']).status, 0);
    assert.ok(!fs.existsSync(path.join(JD, 'runs', 'look-v1-r4.json')));
    assert.strictEqual(require(path.join(SCRIPTS, 'tally-cost.js')).tally(JD).byItem.look.tokens, 1800);
  });

  step('the orchestrator is counted from its transcript, once per message', () => {
    const tr = path.join(ROOT, 'session.jsonl');
    const msg = (id, u, side) => JSON.stringify({ type: 'assistant', isSidechain: !!side, message: { id, model: 'claude-opus-5-5', usage: u } });
    fs.writeFileSync(tr, [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      msg('m1', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
      msg('m1', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }), // streamed twice
      msg('m2', { input_tokens: 20, output_tokens: 40 }),
      msg('s1', { input_tokens: 9999, output_tokens: 9999 }, true), // a subagent's own turn
    ].join('\n'));
    // In a real session the transcript is older than any job file the session touches.
    const later = new Date(Date.now() + 2000); fs.utimesSync(path.join(JD, '.board', 'outbox.jsonl'), later, later);
    const u = R.sessionUsage(tr);
    assert.deepStrictEqual([u.turns, u.tokens, u.output], [2, 1175, 45]);
    // The hook writes it against the job this session touched, and pushes the queue in file mode.
    const hook = spawnSync(process.execPath, [path.join(SCRIPTS, 'hooks', 'board-turn.js')], { cwd: ROOT, env, encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-1', transcript_path: tr, cwd: ROOT }) });
    assert.strictEqual(hook.status, 0, hook.stderr);
    assert.strictEqual(hook.stdout, '', 'file mode pushes by itself and never refuses the turn');
    const o = JSON.parse(fs.readFileSync(path.join(JD, 'runs', 'orchestrator-sess-1.json'), 'utf8'));
    assert.strictEqual(o.tokens, 1175);
    const t = require(path.join(SCRIPTS, 'tally-cost.js')).tally(JD);
    assert.strictEqual(t.orchestrator.tokens, 1175);
    assert.strictEqual(t.total, 1800 + 1175);
    assert.strictEqual(t.tokens, 1800, 'the agents\' figure stays the agents\'');
    assert.strictEqual(fs.readFileSync(path.join(JD, '.board', 'outbox.jsonl'), 'utf8'), '', 'the queue was pushed');
  });

  step('artifact mode: a queued board write refuses the stop once, with the push command', () => {
    fs.appendFileSync(path.join(JD, '.board', 'outbox.jsonl'), JSON.stringify({ collection: 'items', docId: 'look', op: 'update', data: { status: 'draft' } }) + '\n');
    const aenv = { ...env, PROD_LITE_BOARD_URL: 'https://claude.ai/artifact/test' };
    const run = active => spawnSync(process.execPath, [path.join(SCRIPTS, 'hooks', 'board-turn.js')], { cwd: ROOT, env: aenv, encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-2', cwd: ROOT, stop_hook_active: active }) });
    const first = run(false);
    const d = JSON.parse(first.stdout);
    assert.strictEqual(d.decision, 'block');
    assert.match(d.reason, /board-sync\.js" push acme job-cost-test --files/);
    assert.strictEqual(run(false).stdout, '', 'the same queue is not refused twice');
    assert.strictEqual(run(true).stdout, '', 'never on re-entry');
  });

  console.log('cost: all passed');
} finally {
  if (!process.env.KEEP) fs.rmSync(ROOT, { recursive: true, force: true });
}
