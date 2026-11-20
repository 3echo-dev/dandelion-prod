#!/usr/bin/env node
// A shot task end to end on synthetic pictures: inputs, a quote and a yes, the refusals that keep
// credits with a person, numbered takes, the matte that is made to hold (paste-back), a matte of a
// subject, the clip the video model can take, and the check that a picture stayed put.
// Needs ffmpeg, python, Pillow and numpy. Runs in a temp folder; leaves nothing behind unless KEEP=1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-task-'));
const C = 'acme'; const T = 'task-harbour';
const TD = path.join(ROOT, 'workspaces', C, 'tasks', T);
const env = { ...process.env, PROD_LITE_ROOT: ROOT };

function sh(cmd, args, expect = 0) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (expect !== null && r.status !== expect) { console.error(out); throw new Error(args.slice(1, 5).join(' ') + ' exited ' + r.status + ', expected ' + expect); }
  return out;
}
const task = (a, e) => sh(process.execPath, [path.join(SCRIPTS, 'task.js'), C, T, ...a], e);
const ff = a => sh('ffmpeg', ['-v', 'error', '-y', ...a]);
const read = () => JSON.parse(fs.readFileSync(path.join(TD, 'task.json'), 'utf8'));
const last = name => read().takes.filter(x => x.take === name).slice(-1)[0];
const step = (name, fn) => { const t = Date.now(); fn(); console.log('  ok  ' + name + ' (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)'); };
const src = path.join(ROOT, 'src'); fs.mkdirSync(src);
const S = f => path.join(src, f);

try {
  step('synthetic material', () => {
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', S('plate.mp4')]);
    ff(['-f', 'lavfi', '-i', 'smptebars=s=1280x720:r=24:d=5', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', S('generated.mp4')]);
    ff(['-i', S('plate.mp4'), '-frames:v', '1', S('plate.png')]);
    ff(['-i', S('generated.mp4'), '-frames:v', '1', S('generated.png')]);
    ff(['-f', 'lavfi', '-i', 'color=black:s=640x360:d=1', '-vf', 'drawbox=x=200:y=80:w=200:h=200:color=white:t=fill', '-frames:v', '1', S('alpha.png')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x00b140:s=640x360:r=25:d=2', '-vf', 'drawbox=x=260:y=80:w=120:h=240:color=0xc89070:t=fill', '-pix_fmt', 'yuv420p', S('green.mp4')]);
    ff(['-i', S('plate.png'), '-vf', 'eq=gamma=0.6:saturation=0.5', S('relit.png')]);
    ff(['-f', 'lavfi', '-i', 'color=white:s=640x360:d=1', '-frames:v', '1', S('white.png')]);
    ff(['-i', S('plate.png'), '-vf', 'crop=600:360:40:0,pad=640:360:0:0', S('slid.png')]);
  });

  step('a task opens and takes its inputs as copies', () => {
    task(['status'], 3);
    task(['new', '--title', 'Harbour changes']);
    task(['new'], 3);
    for (const f of ['plate.png', 'plate.mp4', 'alpha.png', 'green.mp4']) task(['add', '--file', S(f)]);
    const t = read();
    assert.strictEqual(t.inputs.length, 4);
    assert.deepStrictEqual([t.inputs[0].width, t.inputs[0].height, t.inputs[0].kind], [640, 360, 'image']);
    // The same file again is fine; a different file under the same name is refused.
    task(['add', '--file', S('plate.png')]);
    task(['add', '--file', S('generated.png'), '--as', 'plate'], 3);
    assert.strictEqual(read().inputs.length, 4);
  });

  step('nothing paid lands without a yes, or above it', () => {
    task(['land', '--take', 'harbour', '--file', S('generated.png'), '--credits', '1'], 3);
    task(['approve', '--take', 'harbour', '--by', 'Mei'], 3);                       // nothing quoted
    task(['quote', '--take', 'harbour', '--kind', 'image', '--credits', '2', '--count', '2']);
    task(['approve', '--take', 'harbour'], 2);                                      // a yes has a name
    task(['approve', '--take', 'harbour', '--by', 'Mei']);
    assert.match(task(['land', '--take', 'harbour', '--file', S('generated.png'), '--credits', '1', '--job-ref', 'j1']), /v01 landed/);
    assert.match(task(['land', '--take', 'harbour', '--file', S('generated.png'), '--credits', '1', '--job-ref', 'j2']), /v02 landed/);
    task(['land', '--take', 'harbour', '--file', S('generated.png'), '--credits', '1'], 3);   // a third is over the yes
    task(['land', '--take', 'harbour', '--url', 'https://example.invalid/x.png'], 2);          // a generation has a price
    const ledger = fs.readFileSync(path.join(TD, 'credits.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.strictEqual(ledger.reduce((s, l) => s + l.credits, 0), 2);
    assert.ok(fs.existsSync(path.join(TD, 'takes', 'harbour-v01.png')) && fs.existsSync(path.join(TD, 'takes', 'harbour-v02.png')));
    assert.match(task(['status']), /2 of 2 approved credit\(s\) spent[\s\S]*Spent on this task: 2 credit/);
  });

  step('a clip the video model cannot make is refused at the quote; both prices are asked for', () => {
    task(['quote', '--take', 'orbit', '--kind', 'video', '--credits', '7', '--seconds', '2', '--resolution', '480p'], 3);
    task(['quote', '--take', 'orbit', '--kind', 'video', '--credits', '7', '--seconds', '4', '--resolution', '4k'], 2);
    const one = task(['quote', '--take', 'orbit', '--label', 'no-ref', '--kind', 'video', '--credits', '7', '--seconds', '4', '--resolution', '480p', '--keeps', 'the look only']);
    assert.match(one, /Quote the other way too/);
    const two = task(['quote', '--take', 'orbit', '--label', 'ref', '--kind', 'video', '--credits', '20', '--seconds', '4', '--resolution', '480p', '--video-ref', '--keeps', 'the pack and the camera move']);
    assert.match(two, /"no-ref" 7 credit\(s\) \(keeps the look only\) \| "ref" 20 credit\(s\) \(keeps the pack and the camera move\)/);
    task(['approve', '--take', 'orbit', '--label', 'ref', '--by', 'Mei']);
    task(['land', '--take', 'orbit', '--file', S('generated.mp4'), '--credits', '21'], 3);
    task(['land', '--take', 'orbit', '--file', S('generated.mp4'), '--credits', '20']);
    assert.match(task(['status']), /harbour:.*waiting|orbit: v01 agentc 20cr/);
  });

  step('paste-back makes a matte hold on a still', () => {
    const out = task(['do', 'paste-back', '--take', 'harbour_kept', '--original', 'plate.png', '--generated', 'harbour-v01.png', '--alpha', 'alpha.png', '--feather', '0']);
    const t = last('harbour_kept'); const m = t.metrics;
    assert.strictEqual(t.credits, 0);
    assert.strictEqual(m.keptPct, 100);
    assert.ok(Math.abs(m.keptAreaPct - 17.4) < 1, 'kept area ' + m.keptAreaPct);
    assert.strictEqual(t.madeFrom.length, 3);
    assert.ok(fs.existsSync(m.edges) && fs.existsSync(m.beforeAfter));
    assert.match(out, /harbour_kept v01 \(paste-back\)/);
    // Pixel for pixel: the original inside the matte, the generated picture outside it.
    const px = sh('python', ['-c', [
      'from PIL import Image; import sys',
      'o=Image.open(sys.argv[1]).convert("RGB"); g=Image.open(sys.argv[2]).convert("RGB").resize(o.size, Image.LANCZOS); r=Image.open(sys.argv[3]).convert("RGB")',
      'print(r.getpixel((300,180))==o.getpixel((300,180)), r.getpixel((40,40))==g.getpixel((40,40)))'].join('\n'), S('plate.png'), S('generated.png'), t.file]);
    assert.match(px, /True True/);
    // The other way round, and a matte that keeps nothing or everything is said out loud.
    task(['do', 'paste-back', '--take', 'harbour_kept', '--original', 'plate.png', '--generated', 'harbour-v01.png', '--alpha', 'alpha.png', '--invert']);
    assert.ok(Math.abs(last('harbour_kept').metrics.keptAreaPct - 82.6) < 1.5);
    assert.strictEqual(last('harbour_kept').v, 2);
    const all = task(['do', 'paste-back', '--take', 'harbour_kept', '--original', 'plate.png', '--generated', 'harbour-v01.png', '--alpha', S('white.png')]);
    assert.match(all, /FLAG: the matte keeps everything/);
    assert.strictEqual(last('harbour_kept').flagged, true);
  });

  step('paste-back on a clip keeps the original\'s length, rate, size and sound', () => {
    task(['do', 'paste-back', '--take', 'orbit_kept', '--original', 'plate.mp4', '--generated', 'orbit-v01.mp4', '--alpha', 'alpha.png']);
    const t = last('orbit_kept');
    assert.ok(t.metrics.keptPct >= 97, 'kept ' + t.metrics.keptPct);
    assert.strictEqual(t.metrics.frames, 150);
    assert.ok(t.metrics.notes.some(n => /runs 5\.00 s against the original's 6\.00 s/.test(n)));
    const p = JSON.parse(sh('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames', '-of', 'json', t.file]));
    const v = p.streams.find(s => s.codec_type === 'video');
    assert.deepStrictEqual([v.width, v.height, Number(v.nb_read_frames)], [640, 360, 150]);
    assert.ok(p.streams.some(s => s.codec_type === 'audio'));
  });

  step('a matte of the subject across a clip', () => {
    task(['do', 'matte', '--take', 'pack_matte', '--source', 'green.mp4']);
    const t = last('pack_matte'); const m = t.metrics;
    assert.strictEqual(m.method, 'diffkey');
    assert.ok(Math.abs(m.subjectCoveragePct - 12.5) < 1.5, 'coverage ' + m.subjectCoveragePct);   // 120x240 of 640x360
    assert.match(t.file, /pack_matte-v01\.mp4$/);
    const p = JSON.parse(sh('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', t.file]));
    assert.strictEqual(Number(p.streams[0].nb_read_frames), 50);
    // The matte it wrote is white on the subject, black on the screen, and usable as --alpha.
    task(['do', 'paste-back', '--take', 'pack_swap', '--original', 'green.mp4', '--generated', S('generated.mp4'), '--alpha', 'pack_matte-v01.mp4']);
    assert.ok(last('pack_swap').metrics.keptPct >= 97);
    assert.ok(Math.abs(last('pack_swap').metrics.keptAreaPct - 12) < 2);
  });

  step('a short extract is widened to what the video model takes, with the trim back', () => {
    task(['do', 'clip', '--take', 'ref', '--source', 'plate.mp4', '--start', '3', '--end', '5', '--for-model']);
    const m = last('ref').metrics;
    assert.deepStrictEqual([m.from, m.seconds, m.fitsVideoModel], [2, 4, true]);
    assert.deepStrictEqual(m.trimBack, { start: 1, seconds: 2 });
    task(['do', 'clip', '--take', 'ref', '--source', 'plate.mp4', '--start', '3', '--end', '5']);
    assert.strictEqual(last('ref').metrics.fitsVideoModel, false);
    task(['do', 'frame', '--take', 'still', '--source', 'plate.mp4', '--at', 'last']);
    assert.match(last('still').file, /still-v01\.png$/);
  });

  step('the check tells a change of light from a picture that moved', () => {
    const same = task(['check', '--a', 'plate.png', '--b', S('relit.png'), '--take', 'harbour']);
    assert.match(same, /Nothing flagged/);
    const slid = task(['check', '--a', 'plate.png', '--b', S('slid.png'), '--take', 'harbour']);
    assert.match(slid, /FLAG:/);
    const t = read();
    assert.strictEqual(t.checks.length, 2);
    assert.ok(t.checks[0].structurePct > 70 && t.checks[0].shiftPctOfWidth === 0);
    assert.ok(t.checks[1].structurePct < 50);
    assert.strictEqual(last('harbour').flagged, true);
    // A clip's first frame against a start frame.
    const first = task(['check', '--a', 'plate.png', '--b', 'plate.mp4', '--b-at', 'first']);
    assert.match(first, /Nothing flagged/);
  });

  console.log('task.test.js passed');
} finally {
  if (!process.env.KEEP) fs.rmSync(ROOT, { recursive: true, force: true }); else console.log('kept ' + ROOT);
}
