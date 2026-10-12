#!/usr/bin/env node
// Where the job stands. Every change is queued for the board too; push delivers it.
//
//   node state.js <client> <job-id> <step> running|done|blocked|skipped [--note "..."] [--by <seat>]
//   node state.js <client> <job-id> say --as <seat> [--item <step>] --text "..."
//   node state.js <client> <job-id> show
//
// Steps are the board's: intake, catalogue, interrogate, research, scraper, hybrid, grade,
// mograph, render, review. running makes the step read Working on the board and puts the stage
// and the seat on the project card; a delivery is record-version.js, which makes it a Draft for a
// person to approve. say puts a line in that seat's chat (the same as board-say.js).
// Exit 0 ok · 2 usage · 3 no job
const L = require('./lib-job.js');
const B = require('./lib-board.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
if (!J || !J.rest[0]) { console.error('usage: state.js <client> <job-id> <step> <status> [--note] | say --as <seat> --text "..." | show'); process.exit(2); }
if (!J.job()) { console.error('no job ' + J.jobId); process.exit(3); }
const what = J.rest[0];

if (what === 'say') {
  const seat = L.opt(argv, '--as') || L.opt(argv, '--agent'); const text = L.opt(argv, '--text'); const item = L.opt(argv, '--item');
  if (!seat || !text) { console.error('usage: say --as <seat> [--item <step>] --text "..."'); process.exit(2); }
  if (!L.SEATS.includes(seat)) { console.error('unknown seat ' + seat + ' (one of ' + L.SEATS.join(', ') + ')'); process.exit(2); }
  if (item && !L.STAGE_KEYS.includes(item)) { console.error('unknown step ' + item); process.exit(2); }
  L.say(J, seat, text, item); console.log('queued in the ' + seat + ' chat; push to show it'); process.exit(0);
}
if (what === 'show') {
  const s = L.readStatus(J);
  for (const st of L.STAGES) { const r = s.stages[st.key]; console.log(st.key.padEnd(12) + r.status.padEnd(9) + (r.note || '')); }
  for (const g of Object.keys(L.GATES)) {
    const rec = B.readDbDoc(process.cwd(), J.client, J.jobId, 'gates', 'gate-' + g.toLowerCase());
    console.log('Gate ' + g + ' ' + L.GATES[g] + ': ' + (rec ? rec.decision + (rec.decidedBy ? ' by ' + rec.decidedBy : '') : 'not signed off'));
  }
  const open = B.readOutbox(process.cwd(), J.client, J.jobId).length;
  if (open) console.log(open + ' write(s) waiting for board-sync.js push');
  process.exit(0);
}
try { L.setStage(J, what, J.rest[1], L.opt(argv, '--note'), L.opt(argv, '--by')); }
catch (e) { console.error(e.message); process.exit(2); }
console.log(what + ': ' + J.rest[1] + (L.opt(argv, '--note') ? ' (' + L.opt(argv, '--note') + ')' : '') + '. Queued for the board; push next.');
