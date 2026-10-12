#!/usr/bin/env node
// Start-of-session check. Reports what is on this machine, what is missing, and what each missing
// piece is needed for.
//
//   node check-deps.js            one line (the session-start hook)
//   node check-deps.js --setup    the full list with install commands, for setting up a new machine
//   node check-deps.js --json     the same as JSON (the install skill reads it)
//
// Required: every job needs them. Optional: only one route or one stage needs them; the rest of the
// pipeline runs without, and the stage that needs one stops with a plain message. Nothing is ever
// installed by this script. Python packages are looked up (find_spec), never imported, so the check
// stays fast.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MOGRAPH = require('./lib-mograph');
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const mac = process.platform === 'darwin';

const run = (c, a) => { try { return spawnSync(c, a, { encoding: 'utf8', timeout: 15000 }); } catch { return { status: 1 }; } };
const has = (c, a) => run(c, a).status === 0;
const PY = has('python', ['--version']) ? 'python' : has('python3', ['--version']) ? 'python3' : null;

const MODS = ['PIL', 'rembg', 'onnxruntime'];
let mods = {};
if (PY) {
  const r = run(PY, ['-c', 'import importlib.util as u, json; print(json.dumps({m: u.find_spec(m) is not None for m in ' + JSON.stringify(MODS) + '}))']);
  try { mods = JSON.parse(r.stdout); } catch { mods = {}; }
}
const pip = (PY || 'python3') + ' -m pip install';

const CHECKS = [
  { name: 'ffmpeg', need: 'required', ok: has('ffmpeg', ['-version']) && has('ffprobe', ['-version']), for: 'every stage (probe, cut, mix, previews)', install: mac ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg' },
  { name: 'node', need: 'required', ok: has('node', ['--version']), for: 'every script', install: mac ? 'brew install node' : 'winget install OpenJS.NodeJS.LTS' },
  { name: 'python', need: 'required', ok: !!PY, for: 'catalogue, cut-out, composite, grade, render', install: mac ? 'brew install python' : 'winget install Python.Python.3.12' },
  { name: 'Pillow', need: 'required', ok: !!mods.PIL, for: 'previews, contact sheets, cut-out, composite', install: pip + ' pillow' },
  { name: 'mograph', need: 'optional', ok: MOGRAPH.status().ok, for: 'motion graphics: titles, end tags, captions (the 3echo Motion composer)', install: 'node "' + path.join(PLUGIN_ROOT, 'scripts', 'mograph-setup.js') + '"   (one time, needs network, a few minutes)' },
  { name: 'rembg', need: 'optional', ok: !!(mods.rembg && mods.onnxruntime), for: 'cutting out people shot without a green or blue screen (screen shots do not need it)', install: pip + ' "rembg[cpu]"   (CPU; on Windows/Linux with an NVIDIA card, "rembg[gpu]" in its own venv is faster)' },
];

// --json: the install skill's input. Fresh probe, one entry per tool, required ones first.
if (process.argv.includes('--json')) {
  const tools = CHECKS.map(c => ({ name: c.name, present: !!c.ok, required: c.need === 'required', why: c.for, install: c.install }));
  tools.sort((x, y) => (y.required - x.required));
  console.log(JSON.stringify({ platform: process.platform, python: PY, ready: tools.every(t => t.present || !t.required), tools }, null, 2));
  process.exit(0);
}
if (process.argv.includes('--setup')) {
  console.log('prod-lite setup check (' + process.platform + ')\n');
  for (const c of CHECKS) console.log((c.ok ? '  ok      ' : c.need === 'required' ? '  MISSING ' : '  missing ') + c.name.padEnd(13) + c.need.padEnd(10) + c.for + (c.ok ? '' : '\n' + ' '.repeat(33) + 'install: ' + c.install));
  const bad = CHECKS.filter(c => !c.ok && c.need === 'required');
  console.log('\n' + (bad.length ? 'Required missing: ' + bad.map(c => c.name).join(', ') + '. Install these before the first job.' : 'Everything required is here.') + ' Optional items only matter for the route named next to them.');
  process.exit(bad.length ? 1 : 0);
}

const line = CHECKS.map(c => c.name + ': ' + (c.ok ? 'ok' : c.need === 'required' ? 'MISSING' : 'missing')).join(' | ');
const miss = CHECKS.filter(c => !c.ok);
console.log('[prod-lite] ' + line + (miss.length ? '\n[prod-lite] ' + miss.map(c => c.name + (c.need === 'required' ? ' (REQUIRED)' : '') + ' is needed for ' + c.for).join('; ') + '. For install commands: node "' + path.join(PLUGIN_ROOT, 'scripts', 'check-deps.js') + '" --setup' : ''));
process.exit(0);
