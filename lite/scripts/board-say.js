#!/usr/bin/env node
// Say something in an agent's chat on the board.
//
//   node board-say.js <client> <job-id> --as <agent> [--item <step>] "<what the agent says>"
//   node board-say.js --slate <slate id> --as orchestrator "<what the run says>"
//
// A person who writes in an agent's chat is answered in the board's comment thread, where the
// page cannot look: it can post comments but never read them. The first form queues the same
// answer as a board message from that agent in the job's outbox; `board-sync.js push` delivers
// it and the board draws it as the agent's bubble. The second form is for a project a person
// opened on the slate, before any job folder exists: nothing can be queued for it, so the write
// is printed for ArtifactData instead.
//
// Exit 0 queued or printed · 2 usage, an unknown agent or an unknown step
const lib = require('./lib-board.js');

const { SEATS, STAGE_KEYS: ITEMS } = require('./lib-job.js');
const ALIASES = { producer: 'orchestrator', run: 'orchestrator', 'lite-orchestrator': 'orchestrator', catalogue: 'cataloguer', cataloger: 'cataloguer',
  interrogate: 'interrogator', research: 'researcher', scrape: 'scraper', render: 'renderer' };

const argv = process.argv.slice(2);
const valueOf = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const VALUE = ['--as', '--item', '--slate', '--root'];
const rest = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (VALUE.includes(argv[i])) i++; continue; } rest.push(argv[i]); }
const slate = valueOf('--slate');
const [client, job, ...words] = slate ? [null, slate, ...rest] : rest;
const text = words.join(' ').trim();
const said = String(valueOf('--as') || '').trim().toLowerCase();
const seat = SEATS.includes(said) ? said : ALIASES[said];
const item = valueOf('--item');

function refuse(why) {
  console.error(why + '\nusage: board-say.js <client> <job-id> --as <agent> [--item <step>] "<what the agent says>" | --slate <slate id> --as orchestrator "..."\nNothing was queued.');
  process.exit(2);
}
if ((!slate && (!client || !job)) || !text) refuse('A client and job id (or --slate <slate id>) and the words to say are all needed.');
if (!seat) refuse('Unknown agent "' + (valueOf('--as') || '') + '". Use one of: ' + SEATS.join(', ') + '.');
if (item && !ITEMS.includes(item)) refuse('Unknown step "' + item + '". Use one of: ' + ITEMS.join(', ') + '.');

const data = { by: seat, text, item: item || null, at: new Date().toISOString() };
const docId = 'm-' + Date.now().toString(36);
if (slate) {
  console.log('Write this to the board now (ArtifactData set) so it shows in the chat on the board:');
  console.log(JSON.stringify({ writes: [{ op: 'set', collection: 'projects/' + slate + '/messages', doc_id: docId, data }] }));
} else {
  lib.appendOutbox(process.cwd(), client, job, { collection: 'messages', docId, data });
  console.log('Queued for the board: ' + seat + ' says it in the chat' + (item ? ' on ' + item : '') + '. Deliver it with board-sync.js push ' + client + ' ' + job + '.');
}
