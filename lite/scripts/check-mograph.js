#!/usr/bin/env node
// Is the mograph stage ready on this machine? The 3echo Motion composer ships inside the plugin
// (vendor/3echo-motion/composer); mograph-setup.js installs it once per machine. Only the
// mograph stage needs it; every other stage runs without. This reports and never refuses.
const M = require('./lib-mograph');

const s = M.status();
if (s.ok) console.log('[prod-lite] mograph: ready (3echo Motion composer)');
else console.log('[prod-lite] mograph: not ready (' + s.reason + '). Before the first title or lower third, run: node "' + require('path').join(M.PLUGIN_ROOT, 'scripts', 'mograph-setup.js') + '". Every other stage runs without it.');
process.exit(0);
