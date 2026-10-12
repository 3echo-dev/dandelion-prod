#!/usr/bin/env node
// Record what a director actually did, so the board can show it under the item.
//
//   node record-run.js <client> <job-id> --item sequence --n 1 --seat sequence-director
//        --prompt-file <spawn-prompt.txt> [--output-file rough-edl.json] [--trace-file <trace.json>]
//        [--model sonnet] [--turns 9] [--tokens 51900] [--status done|running]
//
// Writes runs/{item}-v{n}.json and queues the same record for the board's runs collection.
// The output file defaults to the one record-version.js recorded for this item and number; a
// finished run with nothing to show is refused, not recorded empty.
// Exit 0 recorded · 2 usage · 3 a named file is missing, or no version to take the output from
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const board = require('./lib-board.js');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const { client, jobId, dir } = ws.resolveJobArgs(argv, argv);
const item = opt('--item'), n = Number(opt('--n')), seat = opt('--seat');
if (!client || !jobId || !item || !Number.isInteger(n) || !seat || !opt('--prompt-file')) {
  console.error('usage: record-run.js <client> <job-id> --item <item> --n <n> --seat <agent> --prompt-file <file> [--output-file <path>] [--trace-file <file>] [--model m] [--turns t] [--tokens k] [--status done|running]');
  process.exit(2);
}
const readOr = (p, what) => {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : (fs.existsSync(path.join(dir, p)) ? path.join(dir, p) : path.resolve(p));
  if (!fs.existsSync(abs)) { console.error('The ' + what + ' is not there: ' + ws.fwd(abs)); process.exit(3); }
  return abs;
};
const promptPath = readOr(opt('--prompt-file'), 'prompt file');
const status = opt('--status') || 'done';
function versionOf(it, num) {
  try { return fs.readFileSync(path.join(dir, 'versions.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).find(v => v.item === it && Number(v.n) === num) || null; }
  catch { return null; }
}
let outputArg = opt('--output-file');
if (!outputArg) {
  const v = versionOf(item, n);
  if (v && v.path) { outputArg = v.path; console.error('Output: ' + v.path + ', as recorded for ' + item + ' v' + n + '.'); }
  else if (status === 'done') {
    console.error('Nothing was recorded. ' + item + ' v' + n + ' is not in versions.jsonl, so there is no file to show on the board. Run record-version.js first, or pass --output-file <path>.');
    process.exit(3);
  }
}
const outputPath = readOr(outputArg, 'output file');
const tracePath = readOr(opt('--trace-file'), 'trace file');
const TEXT = /\.(md|txt|csv|json|yaml|yml|fcpxml|xml)$/i;
let output = '';
if (outputPath && !fs.statSync(outputPath).isDirectory() && TEXT.test(outputPath)) output = fs.readFileSync(outputPath, 'utf8').slice(0, 60000);
if (!outputPath) console.error('Note: a running record carries no output yet.');
else if (!output) console.error('Note: ' + path.basename(outputPath) + ' is not text, so the board shows its path only.');
let trace = [];
if (tracePath) { try { trace = JSON.parse(fs.readFileSync(tracePath, 'utf8')); } catch { trace = []; } }
const rec = {
  item, seat, version: n, status,
  model: opt('--model') || null,
  turns: opt('--turns') ? Number(opt('--turns')) : null,
  tokens: opt('--tokens') ? Number(opt('--tokens')) : null,
  skills: (opt('--skills') || '').split(',').map(s => s.trim()).filter(Boolean),
  prompt: fs.readFileSync(promptPath, 'utf8'),
  output,
  trace: Array.isArray(trace) ? trace : [],
  artifactPath: outputPath ? path.relative(dir, outputPath).split(path.sep).join('/') : null,
  startedAt: opt('--started') || new Date().toISOString(),
  finishedAt: status === 'done' ? new Date().toISOString() : null,
};
fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
const out = path.join(dir, 'runs', item + '-v' + n + '.json');
fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
board.appendOutbox(process.cwd(), client, jobId, { collection: 'runs', docId: item + '-v' + n, data: { ...rec, trace: JSON.stringify(rec.trace).length > 20000 ? [] : rec.trace, prompt: rec.prompt.slice(0, 20000), output: rec.output.slice(0, 40000) } });
// The project's running cost, so the slate card and the Cost box never lag a run.
require('./tally-cost.js').queue(board, process.cwd(), client, jobId, dir);
console.log('Run recorded: ' + ws.fwd(out) + '. Queued for the board.');