#!/usr/bin/env node
// The hybrid step: the people in the first cut kept exactly as shot, the world behind them replaced.
// Every shot of the cut is a "panel" here (cutout.py, composite.py and motion-transfer.js read
// hybrid-brief.json in that shape): a shot to replace is a plate; a shot to keep is used as it is.
//
//   node hybrid.js <client> <job-id> brief                        write hybrid-brief.json from shots, interrogation, look, references
//   node hybrid.js <client> <job-id> quote <location> --credits N the AgentC quote for one background
//   node hybrid.js <client> <job-id> approve backgrounds --by <who> --at <iso> [--credits N] [--keys a,b]
//   node hybrid.js <client> <job-id> land <location> --file <png|jpg|mp4> | --url <https media url> [--job-ref id] [--credits N]
//   node hybrid.js <client> <job-id> status
//
// A location's background is, in order: a reference marked --background (client-owned or licensed,
// no credits), else one generated on AgentC after a quote and a yes on the board. A generated
// background takes the shot's clean frame (the actor blanked out, from cutout.py) as its framing
// reference and the scraped references for that location as look references; the researcher's
// prompt for the location leads. With backgroundPer "panel" (new-job --background-per shot) each
// shot gets its own background from its own camera angle, the first of a location being the
// continuity reference for the rest. This script never spends.
// Exit 0 ok · 1 fault · 2 usage · 3 not ready
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
const cmd = J && J.rest[0];
if (!J || !['brief', 'quote', 'approve', 'land', 'status'].includes(cmd)) { console.error('usage: hybrid.js <client> <job-id> brief|quote|approve|land|status ...'); process.exit(2); }
const job = J.job();
if (!job) { console.error('no job.json'); process.exit(3); }
const keyOf = s => String(s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const readBrief = () => { const b = J.read('hybrid-brief.json', null); if (!b) { console.error('no hybrid-brief.json yet; run brief first'); process.exit(3); } return b; };
const writeBrief = b => J.write('hybrid-brief.json', b);
const bgDir = path.join(job.driveFolder, 'footage', 'backgrounds');

if (cmd === 'brief') {
  const shots = J.read('shots.json', null); const inter = J.read('interrogation.json', null); const look = J.read('look.json', null);
  if (!shots) { console.error('no shots.json; run catalogue.py'); process.exit(3); }
  if (!inter) { console.error('no interrogation.json; the interrogator reads the shots first'); process.exit(3); }
  if (!look) { console.error('no look.json; the researcher writes the look first'); process.exit(3); }
  const shotsSha = L.sha256Text(JSON.stringify(shots.shots.map(s => s.sha256)));
  if (inter.shotsSha !== shotsSha) { console.error('interrogation.json was written for an older catalogue; interrogate the shots again'); process.exit(3); }
  // References a person ticked on the board (landed under .board/db/refsel) are the ones to build
  // from; with none ticked yet, every reference for the place is used.
  const chosen = new Set();
  try { for (const f of fs.readdirSync(J.file('.board', 'db', 'refsel'))) { const d = L.readJson(J.file('.board', 'db', 'refsel', f), {}); if (d.selected) chosen.add(f.replace(/\.json$/, '')); } } catch { /* nothing landed */ }
  const refs = (J.read('references.json', null) || { items: [] }).items.filter(r => r.background || !chosen.size || chosen.has(r.id));
  const per = (job.hybrid || {}).backgroundPer === 'panel' ? 'panel' : 'location';
  const motionIds = ((job.hybrid || {}).motionPanels || []).map(x => String(x).toUpperCase());
  const prev = J.read('hybrid-brief.json', null);
  const oldPanels = new Map(((prev || {}).panels || []).map(p => [p.id, p]));
  const oldBg = (prev || {}).backgrounds || {};
  const backgrounds = {}; const anchors = {};
  const readOf = new Map(inter.shots.map(s => [s.id, s]));
  const rows = shots.shots.map(s => {
    const r = readOf.get(s.id);
    const base = { id: s.id, scene: null, storyOrder: s.n, durationSec: s.duration, start: s.start, frames: s.frames };
    if (r.treatment === 'keep') return { ...base, keep: s.file, keepSha: s.sha256, plate: null, plateSha: null, background: null, cutout: null, composite: null, status: 'keep' };
    const locKey = keyOf(r.location);
    const loc = (look.locations || {})[locKey];
    if (!loc) { console.error(s.id + ': location "' + locKey + '" is not in look.json'); process.exit(3); }
    const owned = refs.find(x => x.tag === locKey && x.background);
    const key = per === 'panel' && !owned ? locKey + ' ' + s.id.toLowerCase() : locKey;
    if (!backgrounds[key]) {
      const anchor = per === 'panel' ? (anchors[locKey] = anchors[locKey] || key) : null;
      const old = oldBg[key] || {};
      const oldCut = (oldPanels.get(s.id) || {}).cutout;
      // A plate shot on a green or blue screen holds no place, horizon or light to match: sending it
      // as [Image 1] only invites a green cast or a grey shape. Those backgrounds are framed by the
      // look's words and the place references alone.
      const screen = r.screen === 'green' || r.screen === 'blue';
      const frame = screen ? null : (oldCut && oldCut.cleanFrame && fs.existsSync(oldCut.cleanFrame) ? oldCut.cleanFrame : s.mid);
      const lookRefs = refs.filter(x => x.tag === locKey && !x.background).slice(0, 8).map(x => x.file);
      if (owned) backgrounds[key] = { name: loc.name, location: locKey, source: 'library', file: owned.file, sha256: owned.sha256, reference: owned.id, status: 'provided', panels: [] };
      else backgrounds[key] = {
        name: loc.name + (key !== locKey ? ' (' + s.id + ')' : ''), location: locKey, source: 'generate', continuityOf: anchor && anchor !== key ? anchor : null,
        status: old.status === 'delivered' ? 'delivered' : 'pending', file: old.status === 'delivered' ? old.file : null, sha256: old.status === 'delivered' ? old.sha256 : null,
        prompt: old.promptOverride || [
          loc.prompt || ('An empty ' + loc.name + ': ' + loc.description + '.'),
          'No people in it: a film background plate for a live-action shot.',
          r.camera && r.camera !== 'static' ? null : 'Locked-off camera.',
          screen ? 'The people are added later over the centre and lower part of the frame: keep that area an open, natural continuation of the place, with no foreground object standing in it.'
            : 'Match the camera angle, height, horizon and light direction of [Image 1]. Anything standing in [Image 1] (a person, a grey shape) is not part of the background: fill that space with more of the place, never a person or an object.',
          lookRefs.length ? (screen ? 'The reference images show the place, materials and details to follow; do not copy their framing.' : 'The other reference images show the period, materials and details to follow; do not copy their framing.') : null,
          anchor && anchor !== key ? 'The same place, time of day and light as the continuity reference image, seen from this shot\'s camera angle.' : null,
          'Light: ' + r.lighting + '.',
          'Photographic, cinematic, ' + (job.aspectRatio || '16:9') + ' frame; no text, no people, no logos.',
        ].filter(Boolean).join(' '),
        promptOverride: old.promptOverride || null,
        referenceFrame: frame, lookReferences: lookRefs, ratio: job.aspectRatio || '16:9',
        idempotencyKey: J.jobId + '/background/' + key.replace(/\s+/g, '-'),
        quotedCredits: old.quotedCredits || null, jobRef: old.jobRef || null, credits: old.credits || null, panels: [],
      };
    }
    backgrounds[key].panels.push(s.id);
    const old = oldPanels.get(s.id) || {};
    const same = old.plateSha === s.sha256;
    return {
      ...base, plate: s.file, plateSha: s.sha256, background: key, location: locKey, camera: r.camera,
      cutout: same ? (old.cutout || null) : null, composite: same ? (old.composite || null) : null,
      motion: same && old.motion && motionIds.includes(s.id) ? old.motion : null,
      status: same && old.composite ? old.status : (same && old.cutout ? 'cut-out' : 'plate'),
    };
  });
  const out = { schemaVersion: '1.0', jobId: J.jobId, generatedAt: L.nowIso(), shotsSha, cutoutMethod: (job.hybrid || {}).cutout || 'auto', approvals: (prev || {}).approvals || {}, backgrounds, panels: rows };
  writeBrief(out);
  const kept = rows.filter(r => r.keep).map(r => r.id);
  const gen = Object.values(backgrounds).filter(b => b.source === 'generate' && b.status !== 'delivered');
  const moving = rows.filter(r => r.plate && r.camera && r.camera !== 'static' && !motionIds.includes(r.id)).map(r => r.id);
  console.log('hybrid-brief.json: ' + rows.length + ' shot(s), ' + rows.filter(r => r.plate).length + ' to replace' + (kept.length ? ', ' + kept.join(', ') + ' kept as they are' : '') + '.');
  for (const b of Object.values(backgrounds)) console.log('  ' + b.name + ' (' + b.panels.join(', ') + '): ' + (b.source === 'library' ? 'client/licensed picture ' + path.basename(b.file) : b.status === 'delivered' ? 'generated, ' + path.basename(b.file) : 'to generate' + (b.lookReferences.length ? ' with ' + b.lookReferences.length + ' look reference(s)' : '')));
  if (gen.length) console.log(gen.length + ' background(s) to generate, 1 credit each (create_image_job): ask once on the board (board-sync.js ask --item hybrid) before anything is spent.');
  if (moving.length) console.log('Camera moves on ' + moving.join(', ') + ': a still background will not follow. Offer motion transfer at the same gate (motion-transfer.js include).');
  process.exit(0);
}
if (cmd === 'quote') {
  const b = readBrief(); const bg = b.backgrounds[keyOf(J.rest[1])]; if (!bg || !L.opt(argv, '--credits')) { console.error('usage: quote <location> --credits N'); process.exit(2); }
  if (bg.source !== 'generate') { console.error(J.rest[1] + ' uses a supplied picture; nothing to quote'); process.exit(3); }
  bg.quotedCredits = Number(L.opt(argv, '--credits')); writeBrief(b); console.log(bg.name + ' quoted at ' + bg.quotedCredits + ' credit(s).'); process.exit(0);
}
if (cmd === 'approve') {
  if (J.rest[1] !== 'backgrounds' || !L.opt(argv, '--by') || !L.opt(argv, '--at')) { console.error('usage: approve backgrounds --by <who> --at <iso> [--credits N] [--keys a,b]'); process.exit(2); }
  const b = readBrief(); b.approvals = b.approvals || {};
  b.approvals.backgrounds = { by: L.opt(argv, '--by'), at: L.opt(argv, '--at'), credits: L.opt(argv, '--credits') ? Number(L.opt(argv, '--credits')) : null, channel: 'board', keys: L.opt(argv, '--keys') ? L.opt(argv, '--keys').split(',').map(keyOf).filter(Boolean) : null };
  writeBrief(b); console.log('backgrounds approved by ' + L.opt(argv, '--by') + (L.opt(argv, '--credits') ? ' for ' + L.opt(argv, '--credits') + ' credit(s)' : '') + '.'); process.exit(0);
}
if (cmd === 'land') {
  const b = readBrief(); const key = keyOf(J.rest[1]); const bg = b.backgrounds[key];
  if (!bg) { console.error('no background ' + J.rest[1] + ' in the brief'); process.exit(2); }
  if (bg.continuityOf && b.backgrounds[bg.continuityOf] && b.backgrounds[bg.continuityOf].status !== 'delivered') { console.error(bg.name + ' is generated against ' + b.backgrounds[bg.continuityOf].name + ', which has not landed yet; land that one first'); process.exit(3); }
  const ap = (b.approvals || {}).backgrounds;
  if (!ap) { console.error('no background approval on record; nothing lands without a yes to the credit question on the board'); process.exit(3); }
  if (ap.keys && !ap.keys.includes(key)) { console.error(bg.name + ' is outside the approved backgrounds (' + ap.keys.join(', ') + ')'); process.exit(3); }
  const spent = Object.values(b.backgrounds).reduce((s, x) => s + (Number(x.credits) || 0), 0) + (Number(L.opt(argv, '--credits')) || 0);
  if (ap.credits != null && spent > ap.credits) { console.error('this would take background spend to ' + spent + ' credit(s), over the ' + ap.credits + ' approved; ask again'); process.exit(3); }
  L.ensureDir(bgDir);
  let src = L.opt(argv, '--file'); let ext = src ? path.extname(src) : '.png';
  const url = L.opt(argv, '--url');
  if (url) { const tmp = path.join(bgDir, '.dl-' + Date.now()); const r = spawnSync('curl', ['-sSL', '--fail', '-o', tmp, url], { encoding: 'utf8' }); if (r.status !== 0) { console.error('download failed: ' + (r.stderr || r.error)); process.exit(1); } src = tmp; ext = /\.mp4|video/i.test(url) ? '.mp4' : '.png'; }
  if (!src || !fs.existsSync(src)) { console.error('land needs --file <png|jpg|mp4> or --url <media url>'); process.exit(2); }
  const dest = path.join(bgDir, key.replace(/\s+/g, '-') + ext.toLowerCase());
  fs.copyFileSync(src, dest); if (url) fs.unlinkSync(src);
  Object.assign(bg, { status: 'delivered', file: L.fwd(dest), sha256: L.sha256File(dest), landedAt: L.nowIso() });
  if (L.opt(argv, '--job-ref')) bg.jobRef = L.opt(argv, '--job-ref'); if (L.opt(argv, '--credits')) bg.credits = Number(L.opt(argv, '--credits'));
  // A new background voids the composites made over the old one.
  for (const p of b.panels) if (p.background === key && p.composite) { p.composite = null; p.status = p.cutout ? 'cut-out' : 'plate'; }
  writeBrief(b);
  const left = Object.values(b.backgrounds).filter(x => x.source === 'generate' && x.status !== 'delivered').length;
  console.log(bg.name + ' landed: ' + path.basename(dest) + '. ' + (left ? left + ' background(s) still to generate.' : 'Every location has a background; run composite.py.'));
  process.exit(0);
}
if (cmd === 'status') {
  const b = readBrief(); const bgs = Object.values(b.backgrounds);
  console.log('hybrid: ' + b.panels.filter(p => p.composite).length + '/' + b.panels.filter(p => p.plate).length + ' composited, ' + b.panels.filter(p => p.keep).length + ' kept; backgrounds ' + bgs.filter(x => ['provided', 'delivered'].includes(x.status)).length + '/' + bgs.length + ' ready; credits spent ' + bgs.reduce((s, x) => s + (Number(x.credits) || 0), 0));
  for (const p of b.panels) console.log('  ' + p.id + ' ' + p.status + (p.cutout ? ' · cut-out ' + p.cutout.method : '') + (p.motion ? ' · motion ' + p.motion.status : '') + (p.composite ? ' · actor kept ' + p.composite.actorPreservedPct + '%' : '') + (p.background ? ' · ' + b.backgrounds[p.background].name : ''));
  process.exit(0);
}
