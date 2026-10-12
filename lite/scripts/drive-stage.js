#!/usr/bin/env node
// Lands one file downloaded through the Google Drive connector in the incoming/ folder that
// new-job.js named for a Drive link: the connector returns base64, this writes the bytes.
//
//   node drive-stage.js <incoming folder> --rel "<Sub-folder/name.ext>" --b64 <file holding the base64>
//
// The relative path keeps the Drive folder's own sub-folders; nothing may land outside the
// incoming folder. Exit 0 written · 2 usage · 3 refused (path escapes the folder, empty file)
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const dir = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const rel = flag('--rel');
const b64 = flag('--b64');
if (!dir || !rel || !b64) { console.error('usage: drive-stage.js <incoming folder> --rel "<Sub/name.ext>" --b64 <file>'); process.exit(2); }
if (!fs.existsSync(b64)) { console.error('no such file: ' + b64); process.exit(2); }

const to = path.resolve(dir, rel);
const back = path.relative(dir, to);
if (!back || back.startsWith('..') || path.isAbsolute(back)) { console.error('REFUSED: ' + rel + ' would land outside ' + dir); process.exit(3); }

// The connector's answer may be bare base64 or a data: URI; whitespace is dropped either way.
const text = fs.readFileSync(b64, 'utf8').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
const bytes = Buffer.from(text, 'base64');
if (!bytes.length) { console.error('REFUSED: ' + b64 + ' decodes to nothing'); process.exit(3); }
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.writeFileSync(to, bytes);
console.log('staged ' + back.split(path.sep).join('/') + ' (' + bytes.length + ' bytes)');
