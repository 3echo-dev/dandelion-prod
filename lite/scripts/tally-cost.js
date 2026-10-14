#!/usr/bin/env node
// What a project has cost so far, for the board: tokens and turns from every recorded run,
// per item and in total, and the 3echo credits from hybrid-brief.json.
//
//   node tally-cost.js <client> <job-id>          queue the tally for the board (then push)
//   node tally-cost.js <client> <job-id> --json   print it, queue nothing
//
// record-run.js calls queue() after every run, so the board stays current without a separate
// step; run this by hand to back-fill a job recorded before the tally existed. `tokens` is the
// directors' runs; `orchestrator` is the main session's own use, which the Stop hook records from
// the transcript (runs/orchestrator-*.json); `total` is both. A run recorded without --tokens
// counts as a run with no tokens (the board says how many).
//
// Exit 0 done · 2 usage
const fs = require('fs');
const path = require('path');

function tally(dir) {
  const R = require('./lib-runs.js');
  const byItem = {}, bySeat = {};
  let tokens = 0, turns = 0, runs = 0, untracked = 0;
  const orchestrator = { tokens: 0, turns: 0, sessions: 0, models: [] };
  for (const r of R.readRuns(dir)) {
    const t = Number(r.tokens), u = Number(r.turns);
    if (r.item === 'orchestrator') {
      orchestrator.sessions++;
      if (Number.isFinite(t)) orchestrator.tokens += t;
      if (Number.isFinite(u)) orchestrator.turns += u;
      for (const m of String(r.model || '').split(', ').filter(Boolean)) if (!orchestrator.models.includes(m)) orchestrator.models.push(m);
      continue;
    }
    const row = byItem[r.item] = byItem[r.item] || { tokens: 0, turns: 0, runs: 0, models: [] };
    const seat = bySeat[r.seat || 'unknown'] = bySeat[r.seat || 'unknown'] || { tokens: 0, turns: 0, runs: 0 };
    row.runs++; seat.runs++; runs++;
    if (r.tokens != null && Number.isFinite(t)) { row.tokens += t; seat.tokens += t; tokens += t; } else untracked++;
    if (r.turns != null && Number.isFinite(u)) { row.turns += u; seat.turns += u; turns += u; }
    if (r.model && !row.models.includes(r.model)) row.models.push(r.model);
  }
  // Credits: what landed backgrounds and motion clips cost, against what the spend questions
  // approved. The ledger (credits.jsonl) counts every landing, redos included; a job from before
  // the ledger falls back to the figures on hybrid-brief.json.
  let creditsSpent = null, creditsCeiling = null, credits = null;
  let b = null; try { b = JSON.parse(fs.readFileSync(path.join(dir, 'hybrid-brief.json'), 'utf8')); } catch { /* no hybrid brief yet */ }
  const ledger = R.readCredits(dir);
  if (b || ledger) {
    const ap = (b && b.approvals) || {};
    const approved = { backgrounds: Number((ap.backgrounds || {}).credits) || 0, motion: Number((ap.motion || {}).credits) || 0 };
    const spent = ledger
      ? { backgrounds: R.spentOn(ledger, 'background'), motion: R.spentOn(ledger, 'motion') }
      : { backgrounds: Object.values((b && b.backgrounds) || {}).reduce((s, x) => s + (Number(x.credits) || 0), 0),
          motion: ((b && b.panels) || []).reduce((s, p) => s + (Number((p.motion || {}).credits) || 0), 0) };
    creditsSpent = spent.backgrounds + spent.motion;
    creditsCeiling = approved.backgrounds + approved.motion;
    credits = { approved, spent, landings: ledger ? ledger.length : null };
  }
  return { tokens, turns, runs, untracked, byItem, bySeat, orchestrator, total: tokens + orchestrator.tokens, creditsSpent, creditsCeiling, credits };
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
