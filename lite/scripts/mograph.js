#!/usr/bin/env node
// Motion graphics for the finish: the look's mograph requests rendered as alpha overlays, placed
// on the cut's timeline, ready for render.py to burn in.
//
//   node mograph.js <client> <job-id> plan                      write mograph/requests/{n}.json from look.json
//   node mograph.js <client> <job-id> run [--n 2] [--sample]    render with mograph-render.js; --sample renders only the first
//   node mograph.js <client> <job-id> add --file <alpha.mov> --start S [--note "..."]   a supplied overlay (client's own animation)
//   node mograph.js <client> <job-id> status
//
// Requests come from look.json "mograph": [{template: title|endtag|captions, props, start, durationSec, note}].
// Overlays only: a full-frame template would cover the picture this pipeline exists to keep.
// Renders at the cut's own size and frame rate. The placements live in mograph.json, which
// render.py reads. No look.json mograph and nothing added: the stage is skipped.
// Exit 0 ok · 1 render failed · 2 usage · 3 not ready (composer not set up, no look)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');
const M = require('./lib-mograph.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
const cmd = J && J.rest[0];
if (!J || !['plan', 'run', 'add', 'status'].includes(cmd)) { console.error('usage: mograph.js <client> <job-id> plan|run|add|status ...'); process.exit(2); }
const job = J.job();
const rec = J.read('mograph.json', null) || { schemaVersion: '1.0', items: [] };
const save = () => J.write('mograph.json', rec);
const OVERLAYS = ['title', 'endtag', 'captions'];

function probe(f) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,width,height:format=duration', '-of', 'json', f], { encoding: 'utf8' });
  try { const j = JSON.parse(r.stdout); return { ...j.streams[0], duration: Number(j.format.duration) }; } catch { return null; }
}

if (cmd === 'plan') {
  const look = J.read('look.json', null);
  if (!look) { console.error('no look.json'); process.exit(3); }
  const reqs = look.mograph || [];
  const dir = J.file('mograph', 'requests'); L.ensureDir(dir);
  rec.items = rec.items.filter(i => i.source !== 'look');
  reqs.forEach((r, i) => {
    if (!OVERLAYS.includes(r.template)) { console.error('mograph[' + i + ']: ' + r.template + ' is not an overlay (title, endtag, captions)'); process.exit(2); }
    if (r.start + r.durationSec > job.source.duration + 0.01) console.log('NOTE mograph ' + (i + 1) + ' runs past the end of the cut; it will be trimmed.');
    const n = i + 1; const reqFile = path.join(dir, n + '.json');
    L.writeJson(reqFile, { template: r.template, props: r.props, durationSec: r.durationSec, aspectRatio: job.aspectRatio, fps: job.source.fps, note: r.note || null });
    rec.items.push({ n, source: 'look', template: r.template, request: L.fwd(reqFile), start: r.start, durationSec: r.durationSec, status: 'planned', file: null });
  });
  save();
  console.log(reqs.length ? reqs.length + ' overlay(s) planned: ' + reqs.map((r, i) => (i + 1) + ' ' + r.template + ' at ' + r.start + ' s for ' + r.durationSec + ' s').join('; ') : 'no motion graphics in the look; the stage can be skipped.');
  process.exit(0);
}
if (cmd === 'add') {
  const f = L.opt(argv, '--file'); const start = Number(L.opt(argv, '--start'));
  if (!f || !fs.existsSync(f) || !Number.isFinite(start)) { console.error('usage: add --file <alpha.mov> --start S'); process.exit(2); }
  const info = probe(f); if (!info) { console.error('not a readable video'); process.exit(1); }
  if (!/a/.test(String(info.pix_fmt).replace('yuv', ''))) console.log('NOTE ' + path.basename(f) + ' has no alpha channel (' + info.pix_fmt + '): it will cover the picture while it plays.');
  const dir = J.file('mograph', 'renders'); L.ensureDir(dir);
  const n = rec.items.reduce((m, i) => Math.max(m, i.n), 0) + 1;
  const dest = path.join(dir, 'supplied_' + n + path.extname(f)); fs.copyFileSync(f, dest);
  rec.items.push({ n, source: 'supplied', template: 'supplied', start, durationSec: info.duration, status: 'rendered', file: L.fwd(dest), sha256: L.sha256File(dest), note: L.opt(argv, '--note') });
  save(); console.log('overlay ' + n + ' added at ' + start + ' s (' + info.duration.toFixed(2) + ' s)'); process.exit(0);
}
if (cmd === 'run') {
  const s = M.status();
  if (!s.ok) { console.error('mograph is not ready: ' + s.reason + '. Run once: node "' + path.join(M.PLUGIN_ROOT, 'scripts', 'mograph-setup.js') + '"'); process.exit(3); }
  const only = L.opt(argv, '--n') ? Number(L.opt(argv, '--n')) : null;
  let todo = rec.items.filter(i => i.source === 'look' && (only ? i.n === only : i.status !== 'rendered'));
  if (L.has(argv, '--sample')) todo = todo.slice(0, 1);
  if (!todo.length) { console.log('nothing to render'); process.exit(0); }
  const dir = J.file('mograph', 'renders'); L.ensureDir(dir);
  for (const it of todo) {
    const out = path.join(dir, it.template + '_' + String(it.n).padStart(2, '0') + '.mov');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'mograph-render.js'), '--request', it.request, '--out', out, '--fps', String(job.source.fps), '--width', String(job.source.width), '--height', String(job.source.height)], { stdio: 'inherit' });
    if (r.status !== 0) { it.status = 'failed'; save(); console.error('overlay ' + it.n + ' failed; see ' + out + '.log'); process.exit(1); }
    Object.assign(it, { status: 'rendered', file: L.fwd(out), sha256: L.sha256File(out), preview: fs.existsSync(out + '.png') ? L.fwd(out + '.png') : null, renderedAt: L.nowIso() });
    save();
  }
  console.log(todo.length + ' overlay(s) rendered');
  process.exit(0);
}
if (cmd === 'status') {
  if (!rec.items.length) { console.log('mograph: none'); process.exit(0); }
  for (const i of rec.items) console.log('  ' + i.n + ' ' + i.template + ' at ' + i.start + ' s for ' + Number(i.durationSec).toFixed(2) + ' s: ' + i.status);
  process.exit(0);
}
