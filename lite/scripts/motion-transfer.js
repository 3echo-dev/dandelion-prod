#!/usr/bin/env node
// Motion transfer (hybrid jobs), generated on 3echo AgentC. For a plate whose
// camera moves, a still background cannot track it; instead the plate itself is the video reference
// ([Video 1]) and the location's background the image reference ([Image 1]), and the video model is
// asked to keep the shot (person, timing, camera move) and replace only the surroundings. The model
// redraws the whole frame, and the test on real talent (2026-09-28) showed the face and small label
// text drift, so by default the result is used as a moving, camera-tracked background only:
// composite.py lays the plate's own cut-out actor back on top (hybrid.motion.keepActor, default true).
//
//   node motion-transfer.js <client> <job-id> include P03,P04|none --by <who> --at <iso>   the intake answer: which camera-move panels get a moving background
//   node motion-transfer.js <client> <job-id> brief                       make the [Video 1] refs, write each panel's request
//   node motion-transfer.js <client> <job-id> asset <panel> --video-id V --image-id I   the uploaded AgentC asset ids
//   node motion-transfer.js <client> <job-id> quote <panel> --credits N   the estimate_video_job figure
//   node motion-transfer.js <client> <job-id> approve motion --by <who> --at <iso> --credits N [--panels P03,P04]
//   node motion-transfer.js <client> <job-id> land <panel> --url <media url> | --file <mp4> [--job-ref id] [--credits N]
//   node motion-transfer.js <client> <job-id> status
//
// Panels: job.hybrid.motionPanels (["P03"]); settings job.hybrid.motion {resolution "720p",
// keepActor true, maxSec 15}. Runs after hybrid.js brief and after the panel's background is ready.
// The reference clip is the plate from its start, at most maxSec long, at most 720 px high, silent,
// under footage/motion/ref/; the generated clip lands under footage/motion/raw/. Neither is a clip
// to cut: composite.py turns them into footage/composite/{panel}.mp4 like every other hybrid panel.
// This script never spends; the orchestrator makes the AgentC calls after the yes.
// Exit 0 ok · 1 fault · 2 usage · 3 not ready
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const board = require('./lib-board.js');

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const { client, jobId, dir, rest } = ws.resolveJobArgs(argv, argv);
const cmd = rest[0];
if (!client || !jobId || !['include', 'brief', 'asset', 'quote', 'approve', 'land', 'status'].includes(cmd)) { console.error('usage: motion-transfer.js <client> <job-id> include|brief|asset|quote|approve|land|status ...'); process.exit(2); }
const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
if (job.footageSource !== 'hybrid') { console.error('job.json footageSource is not "hybrid"; motion transfer works on actor plates.'); process.exit(3); }
// The answer to intake's camera question is a person's: it only ever arrives with --by and --at.
if (cmd === 'include') {
  const list = rest[1]; if (!list || !opt('--by') || !opt('--at')) { console.error('usage: include P03,P04|none --by <who> --at <iso>'); process.exit(2); }
  const ids = /^none$/i.test(list) ? [] : list.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  job.hybrid = Object.assign({}, job.hybrid, { motionPanels: ids, motionDecision: { by: opt('--by'), at: opt('--at'), panels: ids } });
  const jp = path.join(dir, 'job.json'); fs.writeFileSync(jp + '.tmp', JSON.stringify(job, null, 2) + '\n'); fs.renameSync(jp + '.tmp', jp);
  console.log(ids.length ? 'Moving background for ' + ids.join(', ') + ' (decided by ' + opt('--by') + '). Next: hybrid.js brief, cut-outs, then motion-transfer.js brief.' : 'Locked backgrounds everywhere (decided by ' + opt('--by') + '); no motion transfer.');
  process.exit(0);
}
const briefPath = path.join(dir, 'hybrid-brief.json');
if (!fs.existsSync(briefPath)) { console.error('no hybrid-brief.json yet; run hybrid.js brief first'); process.exit(3); }
const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
const save = () => { fs.writeFileSync(briefPath + '.tmp', JSON.stringify(brief, null, 2) + '\n'); fs.renameSync(briefPath + '.tmp', briefPath); };
const fwd = p => p.replace(/\\/g, '/');
const S = (job.hybrid || {}).motion || {};
const RES = S.resolution || '720p';
const MAX = Math.min(15, Number(S.maxSec) || 15);
const wanted = ((job.hybrid || {}).motionPanels || []).map(x => String(x).toUpperCase());
const motionDir = path.join(job.driveFolder, 'footage', 'motion');
const panelOf = id => { const p = brief.panels.find(x => String(x.id).toUpperCase() === String(id || '').toUpperCase()); if (!p) { console.error('no panel ' + id + ' in the brief'); process.exit(2); } if (!p.motion) { console.error(p.id + ' is not a motion-transfer panel (job.hybrid.motionPanels, then brief)'); process.exit(3); } return p; };

function probe(f) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,height:format=duration', '-of', 'json', f], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout); const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
  return { duration: Number((j.format || {}).duration) || 0, height: Number(v.height) || 0 };
}

if (cmd === 'brief') {
  if (!wanted.length) { console.error('job.hybrid.motionPanels is empty: name the panels to motion-transfer (usually the plates where the camera moves).'); process.exit(3); }
  const lines = [], waiting = [];
  for (const id of wanted) {
    const p = brief.panels.find(x => String(x.id).toUpperCase() === id);
    if (!p) { waiting.push(id + ' (not a shot of the cut)'); continue; }
    if (!p.plate) { waiting.push(id + (p.keep ? ' (kept as it is; nothing to transfer)' : ' (no plate)')); continue; }
    const bg = brief.backgrounds[p.background] || {};
    if (!['provided', 'delivered'].includes(bg.status) || !bg.file) { waiting.push(id + ' (background ' + (bg.name || p.background) + ' not ready)'); continue; }
    const old = p.motion || {};
    // A changed plate or background voids the request and anything generated from it.
    if (old.plateSha === p.plateSha && old.backgroundSha === bg.sha256 && old.refVideo && fs.existsSync(old.refVideo)) { old.keepActor = S.keepActor !== false; lines.push(id + ': ' + (old.status || 'pending') + ' (unchanged)'); continue; }
    const info = probe(p.plate);
    if (!info || !info.duration) { waiting.push(id + ' (ffprobe cannot read the plate)'); continue; }
    const refSec = Math.min(info.duration, MAX);
    board.ensureDir(path.join(motionDir, 'ref'));
    const ref = path.join(motionDir, 'ref', p.id + '.mp4');
    const vf = info.height > 720 ? ['-vf', 'scale=-2:720'] : [];
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', p.plate, '-t', refSec.toFixed(3), ...vf, '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', ref], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(id + ': making the reference clip failed: ' + (r.stderr || '').slice(-400)); process.exit(1); }
    const place = bg.name || p.background;
    p.motion = {
      method: 'agentc-video', status: 'pending',
      refVideo: fwd(ref), refVideoSha: board.sha256File(ref), refSec: Math.round(refSec * 1000) / 1000,
      plateSha: p.plateSha, background: p.background, backgroundFile: bg.file, backgroundSha: bg.sha256,
      prompt: old.promptOverride || [
        '[Video 1] is a live-action shot. Keep the person exactly as in [Video 1]: face, hair, clothes, pose, every movement and its timing, whatever they hold and any label on it.',
        'Keep the camera move, framing, lens and cut points of [Video 1] exactly, frame for frame.',
        'Replace only the surroundings with the place in [Image 1] (' + place + '), with its light and time of day, and let that light fall on the person so they sit in it.',
        'No new people, no text, no logos, no change to the product.'].join(' '),
      promptOverride: old.promptOverride || null,
      durationSec: Math.max(4, Math.min(15, Math.ceil(refSec))), ratio: job.aspectRatio || '16:9', resolution: RES, generateAudio: false,
      keepActor: S.keepActor !== false,
      idempotencyKey: jobId + '/motion/' + p.id + '/' + String(board.sha256File(ref)).slice(0, 8),
      assets: null, quotedCredits: null, jobRef: null, credits: null, file: null, sha256: null,
    };
    p.composite = null; if (p.status === 'composited' || p.status === 'needs-review') p.status = p.cutout ? 'cut-out' : 'plate';
    lines.push(id + ': reference ' + p.motion.refSec + ' s -> ask ' + p.motion.durationSec + ' s at ' + RES + ' over ' + place + (p.motion.keepActor ? ' (actor pasted back from the plate)' : ' (the regenerated actor is used: needs a person\'s look)'));
  }
  save();
  console.log('motion transfer: ' + lines.length + ' panel(s)\n' + lines.map(l => '  ' + l).join('\n') + (waiting.length ? '\nwaiting: ' + waiting.join('; ') : ''));
  console.log('Next per panel: upload_asset the refVideo and the backgroundFile, record them with `asset`, estimate_video_job, `quote`; ask once on the board for all of them.');
  process.exit(0);
}
if (cmd === 'asset') {
  const p = panelOf(rest[1]); if (!opt('--video-id') || !opt('--image-id')) { console.error('usage: asset <panel> --video-id V --image-id I'); process.exit(2); }
  p.motion.assets = { video: opt('--video-id'), image: opt('--image-id'), refVideoSha: p.motion.refVideoSha, backgroundSha: p.motion.backgroundSha };
  save(); console.log(p.id + ': [Video 1] and [Image 1] recorded; assetIds in order: ' + p.motion.assets.video + ', ' + p.motion.assets.image); process.exit(0);
}
if (cmd === 'quote') {
  const p = panelOf(rest[1]); if (!opt('--credits')) { console.error('usage: quote <panel> --credits N'); process.exit(2); }
  p.motion.quotedCredits = Number(opt('--credits')); save(); console.log(p.id + ' quoted at ' + p.motion.quotedCredits + ' credit(s).'); process.exit(0);
}
if (cmd === 'approve') {
  if (rest[1] !== 'motion' || !opt('--by') || !opt('--at') || !opt('--credits')) { console.error('usage: approve motion --by <who> --at <iso> --credits N [--panels P03,P04]'); process.exit(2); }
  brief.approvals = brief.approvals || {};
  const panels = opt('--panels') ? opt('--panels').split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : null;
  // The yes is bound to the exact references it was given for: a changed plate or background needs a new one.
  const refs = {}; for (const p of brief.panels.filter(x => x.motion && (!panels || panels.includes(String(x.id).toUpperCase())))) refs[p.id] = p.motion.refVideoSha + ':' + p.motion.backgroundSha;
  brief.approvals.motion = { by: opt('--by'), at: opt('--at'), credits: Number(opt('--credits')), channel: 'board', panels, refs };
  save(); console.log('motion transfer approved by ' + opt('--by') + ' for ' + opt('--credits') + ' credit(s)' + (panels ? ' (' + panels.join(', ') + ')' : '') + '.'); process.exit(0);
}
if (cmd === 'land') {
  const p = panelOf(rest[1]);
  const ap = (brief.approvals || {}).motion;
  if (!ap) { console.error('no motion-transfer approval on record; nothing lands without a yes from the board'); process.exit(3); }
  if (ap.panels && !ap.panels.includes(String(p.id).toUpperCase())) { console.error(p.id + ' is outside the approved panels (' + ap.panels.join(', ') + ')'); process.exit(3); }
  if ((ap.refs || {})[p.id] !== p.motion.refVideoSha + ':' + p.motion.backgroundSha) { console.error(p.id + ': the plate or background changed since the yes; ask again'); process.exit(3); }
  board.ensureDir(path.join(motionDir, 'raw'));
  const dest = path.join(motionDir, 'raw', p.id + '.mp4');
  if (opt('--url')) { const tmp = dest + '.dl'; const r = spawnSync('curl', ['-sSL', '--fail', '-o', tmp, opt('--url')], { encoding: 'utf8' }); if (r.status !== 0) { console.error('download failed: ' + (r.stderr || r.error)); process.exit(1); } fs.renameSync(tmp, dest); }
  else if (opt('--file') && fs.existsSync(opt('--file'))) fs.copyFileSync(opt('--file'), dest);
  else { console.error('land needs --url <media url> or --file <mp4>'); process.exit(2); }
  const info = probe(dest); if (!info || !info.duration) { fs.unlinkSync(dest); console.error('the landed file is not a readable video'); process.exit(1); }
  Object.assign(p.motion, { status: 'delivered', file: fwd(dest), sha256: board.sha256File(dest), durationOut: Math.round(info.duration * 1000) / 1000, landedAt: new Date().toISOString() });
  if (opt('--job-ref')) p.motion.jobRef = opt('--job-ref'); if (opt('--credits')) p.motion.credits = Number(opt('--credits'));
  p.composite = null;
  save();
  const left = brief.panels.filter(x => x.motion && x.motion.status !== 'delivered').map(x => x.id);
  console.log(p.id + ' landed: ' + path.basename(dest) + ' (' + p.motion.durationOut + ' s). ' + (left.length ? 'Still to generate: ' + left.join(', ') + '.' : 'Every motion panel has its clip; run composite.py.'));
  process.exit(0);
}
if (cmd === 'status') {
  const ms = brief.panels.filter(p => p.motion);
  if (!ms.length) { console.log('motion transfer: no panel (job.hybrid.motionPanels, then brief)'); process.exit(0); }
  console.log('motion transfer: ' + ms.filter(p => p.motion.status === 'delivered').length + '/' + ms.length + ' generated; credits spent ' + ms.reduce((s, p) => s + (Number(p.motion.credits) || 0), 0) + (brief.approvals && brief.approvals.motion ? '; approved ' + brief.approvals.motion.credits + ' by ' + brief.approvals.motion.by : '; no yes yet'));
  for (const p of ms) console.log('  ' + p.id + ' ' + p.motion.status + ' · ' + p.motion.durationSec + ' s ' + p.motion.resolution + (p.motion.quotedCredits ? ' · quoted ' + p.motion.quotedCredits : '') + (p.motion.assets ? ' · assets ready' : ' · assets to upload') + (p.composite ? ' · actor kept ' + p.composite.actorPreservedPct + '%' + (p.composite.regenActorPct != null ? ', model drift ' + p.composite.regenActorPct + '%' : '') : ''));
  process.exit(0);
}
