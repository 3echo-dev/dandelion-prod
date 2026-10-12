#!/usr/bin/env node
// Runs every *.test.js beside this file; exits 1 if any fails.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
let failed = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  console.log(f);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log('FAILED ' + f); }
}
console.log(failed ? failed + ' test file(s) failed' : 'all test files passed');
process.exit(failed ? 1 : 0);
