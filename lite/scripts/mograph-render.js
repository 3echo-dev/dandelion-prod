#!/usr/bin/env node
// Renders one mograph request with the 3echo Motion composer.
//
//   node mograph-render.js --request <job>/mograph-requests/1.json --out <job>/bundle/mograph/sample_title_1.mov
//                          [--fps 25] [--width 1920] [--height 1080] [--stall 180] [--max 900]
//
// The request carries template (title, endtag, captions, or one of the five full-frame renderers),
// props, and durationSec. Overlay templates render ProRes 4444 with alpha; the full-frame ones
// ProRes HQ. Writes <out>.log (the whole render log) and <out>.png (a middle frame, alpha kept).
//
// A render never waits on a person: stdin is closed, so a question from npm or Remotion ends the
// run instead of hanging it. A render that prints nothing for --stall seconds, or runs past --max
// seconds, is stopped and reported. Exit 0 rendered and checked; 1 render failed; 2 not set up or
// bad request.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const M = require('./lib-mograph');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const fail = (code, msg) => { console.error('[mograph] ' + msg); process.exit(code); };

const reqPath = arg('request');
const outArg = arg('out');
if (!reqPath || !outArg) fail(2, 'usage: mograph-render.js --request <file.json> --out <file.mov>');

const s = M.status();
if (!s.ok) fail(2, 'mograph is not ready: ' + s.reason + '. Run: node "' + path.join(M.PLUGIN_ROOT, 'scripts', 'mograph-setup.js') + '" (one time, needs network, a few minutes).');

let req;
try { req = JSON.parse(fs.readFileSync(reqPath, 'utf8')); } catch (e) { fail(2, 'cannot read request ' + reqPath + ': ' + e.message); }
const t = M.TEMPLATES[req.template];
if (!t) fail(2, 'template "' + req.template + '" is not one of: ' + Object.keys(M.TEMPLATES).join(', '));

// HeroTitle wraps letter by letter: on a narrow frame a long line breaks mid-word.
const longest = String((req.props || {}).title || '').split(/\s*\n\s*/).reduce((a, l) => Math.max(a, l.length), 0);
if (req.template === 'title' && Number(arg('width', 1920)) < 1200 && longest > 18)
  console.warn('[mograph] warning: a ' + longest + '-character title breaks mid-word at this width; put the second half in subtitle, or use endtag.');

const fps = Number(arg('fps', req.fps || 30));
const out = path.resolve(outArg);
fs.mkdirSync(path.dirname(out), { recursive: true });
const propsFile = path.join(M.HOME, 'props-' + process.pid + '.json');
fs.writeFileSync(propsFile, JSON.stringify({ ...(t.props || {}), ...(req.props || {}) }));

// Overlays render as a PNG sequence that the system ffmpeg encodes to ProRes 4444. Remotion's own
// bundled ffmpeg.exe is unsigned, and Windows Smart App Control refuses to run it (2026-10-09: exit
// 3236495362, 0xC0E90002, on every call), which failed the whole render. Remotion needs no ffmpeg
// to write PNG frames, and the system ffmpeg is a required dependency anyway.
const seqDir = t.alpha ? out.replace(/\.[a-z0-9]+$/i, '') + '_frames' : null;
if (seqDir) fs.rmSync(seqDir, { recursive: true, force: true });
const args = [M.CLI, 'render', 'src/index.tsx', t.id, seqDir || out, '--props=' + propsFile, '--fps=' + fps, '--overwrite'];
if (t.alpha) args.push('--sequence', '--image-format=png', '--muted');
else args.push('--codec=prores', '--prores-profile=hq');
if (arg('width')) args.push('--width=' + arg('width'));
if (arg('height')) args.push('--height=' + arg('height'));
if (req.durationSec) args.push('--duration=' + Math.max(1, Math.round(req.durationSec * fps)));

const stallSec = Number(arg('stall', 180));
const maxSec = Number(arg('max', 900));
const log = fs.createWriteStream(out + '.log');
log.write('$ node ' + args.map(a => JSON.stringify(a)).join(' ') + '\n(cwd ' + M.COMPOSER + ')\n\n');
console.log('[mograph] rendering ' + req.template + ' (' + t.id + ') -> ' + out);

const child = spawn(process.execPath, args, { cwd: M.COMPOSER, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
let last = Date.now();
let stopped = null;
const seen = (b) => { last = Date.now(); log.write(b); };
child.stdout.on('data', seen);
child.stderr.on('data', seen);
const started = Date.now();
const timer = setInterval(() => {
  if (Date.now() - last > stallSec * 1000) stopped = 'printed nothing for ' + stallSec + ' s';
  else if (Date.now() - started > maxSec * 1000) stopped = 'ran past ' + maxSec + ' s';
  if (stopped) { clearInterval(timer); child.kill(); }
}, 2000);

child.on('close', (code) => {
  clearInterval(timer);
  try { fs.rmSync(propsFile); } catch {}
  if (seqDir && code === 0 && !stopped) {
    const frames = fs.existsSync(seqDir) ? fs.readdirSync(seqDir).filter(f => /\.png$/i.test(f)).sort() : [];
    const m = frames[0] && frames[0].match(/^(.*?)(\d+)\.png$/i);
    if (!m) { log.end(); fail(1, 'the frame render wrote no PNG frames to ' + seqDir); }
    const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-start_number', String(Number(m[2])), '-i', path.join(seqDir, m[1] + '%0' + m[2].length + 'd.png'),
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', out], { encoding: 'utf8' });
    log.write('\n$ ffmpeg (system): ' + frames.length + ' PNG frames -> ProRes 4444\n' + (enc.stderr || ''));
    if (enc.status !== 0) { log.end(); fail(1, 'encoding the frames failed: ' + String(enc.stderr || enc.error || '').slice(-400)); }
    fs.rmSync(seqDir, { recursive: true, force: true });
  }
  log.end();
  const tail = () => { try { return fs.readFileSync(out + '.log', 'utf8').trim().split('\n').slice(-12).join('\n'); } catch { return ''; } };
  if (stopped) fail(1, 'render stopped: it ' + stopped + '. Last lines of ' + out + '.log:\n' + tail());
  if (code !== 0 || !fs.existsSync(out)) fail(1, 'render failed (exit ' + code + '). Last lines of ' + out + '.log:\n' + tail());

  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,width,height,r_frame_rate:format=duration', '-of', 'json', out], { encoding: 'utf8' });
  let info = {};
  try { const j = JSON.parse(probe.stdout); info = { ...j.streams[0], duration: Number(j.format.duration) }; } catch {}
  if (t.alpha && !/a/.test(String(info.pix_fmt).replace('yuv', ''))) fail(1, 'rendered, but without an alpha channel (pix_fmt ' + info.pix_fmt + '); an overlay needs one.');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String((info.duration || 1) / 2), '-i', out, '-frames:v', '1', out + '.png']);
  console.log('[mograph] ok: ' + out + ' ' + info.width + 'x' + info.height + ' ' + info.pix_fmt + ' ' + (info.duration || 0).toFixed(2) + ' s, preview ' + out + '.png');
});
