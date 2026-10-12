#!/usr/bin/env node
// Prod-Lite on the Dandelion Prod board: the page (board/, built by scripts/build-board.js) opens
// the Prod-Lite door only, and its model names the same steps, in the same order, and the same
// seats the scripts write. Agents and skills stay in the plugin's size budgets.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const LITE = path.resolve(__dirname, '..', '..');
const SRC = path.join(LITE, '..', 'board', 'src', 'board.html');
const ok = name => console.log('  ok  ' + name);

const src = fs.readFileSync(SRC, 'utf8');
const L = require(path.join(LITE, 'scripts', 'lib-job.js'));
const model = src.slice(src.indexOf('const LITE = {'), src.indexOf('// A picture per step'));
assert.ok(model.length > 100, 'the board has the Prod-Lite model');
const ids = [...model.matchAll(/\{id:'([a-z_]+)',\s+stage:/g)].map(m => m[1]);
assert.deepStrictEqual(ids, L.STAGE_KEYS, 'the board steps are the scripts\' steps, in order');
const seats = [...model.matchAll(/\{id:'([a-z-]+)',\s+n:'0\d'/g)].map(m => m[1]);
assert.deepStrictEqual(seats, L.SEATS, 'the board seats are the scripts\' seats');
for (const st of L.STAGES) assert.ok(new RegExp("\\{id:'" + st.key + "'[^\\n]*seat:'" + st.agent + "'").test(model), st.key + ' belongs to ' + st.agent + ' on the board too');
ok('steps (research first, look after the cut) and seats match lib-job.js');

assert.ok(/const PIPES = \{pre:PRE, post:POST, lite:LITE\};/.test(src), 'the board knows three pipelines');
assert.ok(/const DOORS = \['lite'\];/.test(src), 'the home page opens Prod-Lite only');
const built = require(path.join(LITE, '..', 'scripts', 'build-board.js'));
assert.strictEqual(built.embedded(fs.readFileSync(built.OUT, 'utf8')), built.lf(src), 'board/board.html is the build of board/src (run scripts/build-board.js)');
assert.ok(!/\block\b/i.test(model), 'gate wording is sign-off, never lock');
ok('one door, sign-off wording, the shipped page is the build');

const words = f => fs.readFileSync(f, 'utf8').split(/\s+/).filter(Boolean).length;
for (const f of fs.readdirSync(path.join(LITE, 'agents'))) assert.ok(words(path.join(LITE, 'agents', f)) <= 900, f + ' is over 900 words');
for (const d of fs.readdirSync(path.join(LITE, 'skills'))) assert.ok(words(path.join(LITE, 'skills', d, 'SKILL.md')) <= 700, d + ' is over 700 words');
ok('agents within 900 words, skills within 700');
console.log('board: all passed');
