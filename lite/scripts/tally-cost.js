#!/usr/bin/env node
// What a project has cost so far, for the board: tokens and turns from every recorded run,
// per item and in total, and the 3echo credits from hybrid-brief.json.
//
//   node tally-cost.js <client> <job-id>          queue the tally for the board (then push)
//   node tally-cost.js <client> <job-id> --json   print it, queue nothing
//
// record-run.js calls queue() after every run, so the board stays current without a separate
// step; run this by hand to back-fill a job recorded before the tally existed. The numbers are
// the directors' runs only: the orchestrator's own session is not a run and is not counted, and
// a run recorded without --tokens counts as a run with no tokens (the board says how many).
//
// Exit 0 done · 2 usage
const fs = require('fs');
const path = require('path');

function tally(dir) {
  const byItem = {};
  let tokens = 0, turns = 0, runs = 0, untracked = 0;
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'runs')).filter(f => /-v\d+\.json$/.test(f)); } catch { files = []; }
  for (const f of files) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')); } catch { continue; }
    if (!r || !r.item) continue;
    const t = Number(r.tokens), u = Number(r.turns);
    const row = byItem[r.item] = byItem[r.item] || { tokens: 0, turns: 0, runs: 0, models: [] };
    row.runs++; runs++;
    if (r.tokens != null && Number.isFinite(t)) { row.tokens += t; tokens += t; } else untracked++;
    if (r.turns != null && Number.isFinite(u)) { row.turns += u; turns += u; }
    if (r.model && !row.models.includes(r.model)) row.models.push(r.model);
  }
  // Credits: what landed backgrounds and motion clips cost, against what the spend questions approved.
  let creditsSpent = null, creditsCeiling = null;
  try {
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'hybrid-brief.json'), 'utf8'));
    const ap = b.approvals || {};
    creditsSpent = Object.values(b.backgrounds || {}).reduce((s, x) => s + (Number(x.credits) || 0), 0)
      + (b.panels || []).reduce((s, p) => s + (Number((p.motion || {}).credits) || 0), 0);
    creditsCeiling = (Number((ap.backgrounds || {}).credits) || 0) + (Number((ap.motion || {}).credits) || 0);
  } catch { /* no hybrid brief yet */ }
  return { tokens, turns, runs, untracked, byItem, creditsSpent, creditsCeiling };
}

// Merge the tally into the project document on the board's next push.
function queue(board, cwd, client, jobId, dir) {
  const cost = tally(dir);
  board.appendOutbox(cwd, client, jobId, { collection: 'projects', docId: String(jobId), op: 'update', data: { cost: { ...cost, at: new Date().toISOString() } } });
  return cost;
}

module.exports = { tally, queue };

if (require.main === module) {
  const ws = require('./lib-workspace.js');
  const board = require('./lib-board.js');
  const argv = process.argv.slice(2);
  const { client, jobId, dir } = ws.resolveJobArgs(argv, argv);
  if (!client || !jobId) {
    console.error('Nothing was tallied. usage: tally-cost.js <client> <job-id> [--json]');
    process.exit(2);
  }
  if (argv.includes('--json')) { console.log(JSON.stringify(tally(dir), null, 2)); process.exit(0); }
  const c = queue(board, process.cwd(), client, jobId, dir);
  console.log('Cost queued for the board: ' + c.tokens.toLocaleString('en-US') + ' tokens over ' + c.runs + ' run' + (c.runs === 1 ? '' : 's') +
    (c.untracked ? ' (' + c.untracked + ' without a token count)' : '') +
    (c.creditsSpent != null ? ', ' + c.creditsSpent + ' of ' + c.creditsCeiling + ' credits' : '') + '. Run push next.');
}
