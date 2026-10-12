#!/usr/bin/env node
// Attach a rendered preview to an item's card on the board. The MP4 is uploaded to the board
// artifact's asset store by the orchestrator (Artifact tool, asset: true) and the url it gets
// back (/_blob/<id>, which resolves in every view) is what the card plays. The poster is one frame at
// the video's own shape (render-preview writes {base}-poster.jpg next to the strip, found by itself),
// and its width and height set the player's box before the video loads. The strip is never the poster.
//
//   node set-preview.js <client> <job-id> --item sequence|sync --video-url <url> [--asset-id <id>]
//        [--strip previews/cut-v1-strip.png] [--poster previews/cut-v1-poster.jpg] [--caption "..."]
//
// Exit 0 queued · 2 usage · 3 strip missing
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const board = require('./lib-board.js');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const { client, jobId, dir } = ws.resolveJobArgs(argv, argv);
const item = opt('--item'), url = opt('--video-url');
if (!client || !jobId || !item || !url || !/^(https:\/\/|\/_blob\/)/.test(url)) { console.error('usage: set-preview.js <client> <job-id> --item <item> --video-url </_blob/<id> or https url> [--asset-id <id>] [--strip <png>] [--caption "..."]'); process.exit(2); }
const data = { video: url, updatedAt: new Date().toISOString() };
if (opt('--asset-id')) data.assetId = opt('--asset-id');
if (opt('--caption')) data.caption = opt('--caption');
const strip = opt('--strip');
if (strip) {
  const p = path.join(dir, strip);
  if (!fs.existsSync(p)) { console.error(strip + ' is not there.'); process.exit(3); }
  if (fs.statSync(p).size > 200 * 1024) { console.error(strip + ' is over 200 KB; the board card cannot carry it.'); process.exit(3); }
  data.thumb = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}
const posterRel = opt('--poster') || (strip ? strip.replace(/-strip\.png$/, '-poster.jpg') : null);
const posterAbs = posterRel ? path.join(dir, posterRel) : null;
if (posterAbs && fs.existsSync(posterAbs)) {
  if (fs.statSync(posterAbs).size > 150 * 1024) { console.error(posterRel + ' is over 150 KB; the board card cannot carry it.'); process.exit(3); }
  data.poster = 'data:image/jpeg;base64,' + fs.readFileSync(posterAbs).toString('base64');
  const r = require('child_process').spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', posterAbs], { encoding: 'utf8' });
  const [w, h] = String(r.stdout || '').trim().split(',').map(Number);
  if (w > 0 && h > 0) { data.w = w; data.h = h; }
} else if (opt('--poster')) { console.error(opt('--poster') + ' is not there.'); process.exit(3); }
board.appendOutbox(process.cwd(), client, jobId, { collection: 'previews', docId: item, op: 'update', data });
console.log('Preview video attached to ' + item + ' on the board (queued). Push next.');