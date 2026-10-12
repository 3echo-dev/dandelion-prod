#!/usr/bin/env node
// Records which Prod-Lite board this workspace root talks to.
//
//   node set-board.js <board url>     record it in <cwd>/.prod-lite/config.json
//   node set-board.js --show          the board in use and where that was decided
//   node set-board.js --clear         back to the file board (offline, tests)
// Exit 0 ok · 2 usage · 3 no board set (--show)
const fs = require('fs');
const path = require('path');
const B = require('./lib-board.js');

const arg = process.argv[2];
const file = path.join(process.cwd(), B.CONFIG_DIR, B.CONFIG_FILE);
const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const write = c => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n'); };

if (arg === '--show') {
  const b = B.boardWithSource();
  if (!b) { console.log('no board set: board-sync.js runs against the file board. Run the board-setup skill.'); process.exit(3); }
  console.log('board: ' + b.url + ' (from ' + b.source + ')'); process.exit(0);
}
if (arg === '--clear') { const c = read(); delete c.boardUrl; delete c.boardSetAt; write(c); console.log('board cleared'); process.exit(0); }
if (!arg || !/^https:\/\/claude\.ai\/(code\/)?artifact\//.test(arg)) { console.error('usage: set-board.js <https://claude.ai/artifact/...> | --show | --clear'); process.exit(2); }
const c = read(); c.boardUrl = arg; c.boardSetAt = new Date().toISOString(); write(c);
console.log('board recorded for ' + process.cwd().split(path.sep).join('/'));
