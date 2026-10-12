#!/usr/bin/env node
// One-time, per-machine setup for the mograph stage. Copies the 3echo Motion composer
// (vendor/3echo-motion/composer) to ~/.creative-studio-post/mograph, installs its packages
// from the lockfile and downloads Remotion's headless browser, then writes a stamp. Needs network
// and about 400 MB; takes a few minutes the first time. Safe to run again: it only redoes what the
// stamp says is out of date.
//
//   node mograph-setup.js           set up (or bring up to date)
//   node mograph-setup.js --check   print whether mograph is ready; exit 0 ready, 1 not
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const M = require('./lib-mograph');

if (process.argv.includes('--check')) {
  const s = M.status();
  console.log((s.ok ? 'mograph ready: ' : 'mograph not ready: ') + s.reason);
  process.exit(s.ok ? 0 : 1);
}

const win = process.platform === 'win32';
const step = (label, cmd, args, shell = false) => {
  console.log('\n== ' + label);
  const r = spawnSync(cmd, shell ? undefined : args, { cwd: M.COMPOSER, stdio: 'inherit', shell, timeout: 20 * 60 * 1000 });
  if (r.status !== 0) {
    console.error('\n' + label + ' failed' + (r.error ? ': ' + r.error.message : ' (exit ' + r.status + ')') + '. Nothing was rendered; fix this and run mograph-setup.js again.');
    process.exit(1);
  }
};

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) { console.error('Remotion needs Node 18 or newer; this is ' + process.version + '.'); process.exit(1); }

// 1. Copy the composer, keeping an existing node_modules; drop files the plugin no longer ships.
fs.mkdirSync(M.COMPOSER, { recursive: true });
const want = new Set(M.listFiles(M.VENDOR));
for (const f of M.listFiles(M.COMPOSER)) if (!want.has(f)) fs.rmSync(path.join(M.COMPOSER, f));
for (const f of want) {
  const dst = path.join(M.COMPOSER, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(M.VENDOR, f), dst);
}
console.log('composer copied to ' + M.COMPOSER);

// 2. Packages, exactly as locked. 3. The headless browser Remotion renders with.
// npm is a .cmd on Windows, so it needs a shell; node itself does not (its path may hold spaces).
step('installing packages (npm ci)', 'npm ci --no-audit --no-fund', [], win);
step('downloading the render browser', process.execPath, [M.CLI, 'browser', 'ensure']);

fs.writeFileSync(M.STAMP, JSON.stringify({ vendorHash: M.vendorHash(), node: process.version, at: new Date().toISOString() }, null, 2));
console.log('\nmograph ready: ' + M.COMPOSER);
