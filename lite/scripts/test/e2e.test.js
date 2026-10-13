#!/usr/bin/env node
// End to end on a synthetic first cut, against the file board: intake -> research -> references ->
// catalogue -> interrogation -> look -> board -> Gate A -> credit question -> cut-out -> composite -> grade -> render ->
// review -> board. Plus the refusals that keep credits and sign-off with a person.
// Needs ffmpeg, python and Pillow. Runs in a temp folder; leaves nothing behind unless KEEP=1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-e2e-'));
const PY = spawnSync('python', ['--version']).status === 0 ? 'python' : 'python3';
const C = 'acme'; const JOB = 'job-shophouse-test';
const JD = path.join(ROOT, 'workspaces', C, 'jobs', JOB);
const env = { ...process.env, PROD_LITE_ROOT: ROOT, PROD_LITE_BOARD_URL: '' };
delete env.PROD_LITE_BOARD_URL;
// Motion graphics run when the composer is set up on this machine (its own home, or the post plugin's).
const MG_HOMES = [path.join(os.homedir(), '.dandelion-prod', 'mograph'), path.join(os.homedir(), '.creative-studio-post', 'mograph')];
const MG = process.env.MOGRAPH_HOME || MG_HOMES.find(h => fs.existsSync(path.join(h, 'ready.json')));
if (MG) env.MOGRAPH_HOME = MG;

function sh(cmd, args, expect = 0) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (expect !== null && r.status !== expect) { console.error(out); throw new Error(path.basename(args[0] || cmd) + ' ' + args.slice(1, 4).join(' ') + ' exited ' + r.status + ', expected ' + expect); }
  return out;
}
const node = (s, a, e) => sh(process.execPath, [path.join(SCRIPTS, s), ...a], e);
const py = (s, a, e) => sh(PY, [path.join(SCRIPTS, s), ...a], e);
const ff = a => sh('ffmpeg', ['-v', 'error', '-y', ...a]);
const read = f => JSON.parse(fs.readFileSync(path.join(JD, f), 'utf8'));
const step = (name, fn) => { const t = Date.now(); fn(); console.log('  ok  ' + name + ' (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)'); };

try {
  const src = path.join(ROOT, 'src'); fs.mkdirSync(src);
  step('synthetic first cut', () => {
    // Two green-screen shots with a person-sized block, a shot to keep between them, one sound bed.
    ff(['-f', 'lavfi', '-i', 'color=c=0x00b140:s=640x360:r=25:d=2', '-vf', 'drawbox=x=260:y=80:w=120:h=240:color=0xc89070:t=fill', '-pix_fmt', 'yuv420p', path.join(src, 'a.mp4')]);
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=2', '-pix_fmt', 'yuv420p', path.join(src, 'b.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x00b140:s=640x360:r=25:d=2', '-vf', 'drawbox=x=120:y=100:w=100:h=220:color=0x8a6040:t=fill', '-pix_fmt', 'yuv420p', path.join(src, 'c.mp4')]);
    ff(['-i', path.join(src, 'a.mp4'), '-i', path.join(src, 'b.mp4'), '-i', path.join(src, 'c.mp4'), '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(src, 'first-cut.mp4')]);
    // A "scraped" picture of the new place.
    ff(['-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x704020:c1=0xe0b070:d=1', '-frames:v', '1', path.join(src, 'street.png')]);
  });

  step('intake', () => {
    const out = node('new-job.js', [C, JOB, '--cut', path.join(src, 'first-cut.mp4'), '--brief', 'Brand film, 6 s, warm period feel.', '--context', 'The street becomes a 1920s Singapore shophouse row at golden hour.', '--title', 'Shophouse test']);
    assert.match(out, /640x360, 25 fps, 6\.0\d s, with sound/);
    node('new-job.js', [C, JOB, '--cut', path.join(src, 'first-cut.mp4'), '--brief', 'x'], 3);
  });

  step('intake from a project folder, and from a Drive link', () => {
    // A client folder: the cut, a brief, a logo in a sub-folder. Brief comes from the folder.
    const pf = path.join(ROOT, 'Client folder');
    fs.mkdirSync(path.join(pf, 'Assets'), { recursive: true });
    fs.copyFileSync(path.join(src, 'first-cut.mp4'), path.join(pf, 'Shophouse rough cut.mp4'));
    fs.writeFileSync(path.join(pf, 'Brief.md'), '30 s brand film from the folder.');
    fs.copyFileSync(path.join(src, 'street.png'), path.join(pf, 'Assets', 'logo.png'));
    const out = node('new-job.js', [C, 'job-folder-test', '--folder', pf, '--context', 'A pine forest at dawn.']);
    assert.match(out, /first cut Shophouse rough cut\.mp4; 2 file\(s\) copied to inputs\//);
    const FJ = path.join(ROOT, 'workspaces', C, 'jobs', 'job-folder-test');
    const job = JSON.parse(fs.readFileSync(path.join(FJ, 'job.json'), 'utf8'));
    assert.strictEqual(job.projectFolder.route, 'local');
    assert.ok(fs.existsSync(path.join(FJ, 'inputs', 'Assets', 'logo.png')), 'the folder\'s other files land in inputs/');
    assert.match(fs.readFileSync(path.join(FJ, 'brief.md'), 'utf8'), /from the folder/);
    // Two videos with no first-cut name: it asks which.
    fs.copyFileSync(path.join(src, 'a.mp4'), path.join(pf, 'Assets', 'broll.mp4'));
    fs.renameSync(path.join(pf, 'Shophouse rough cut.mp4'), path.join(pf, 'Shophouse v3.mp4'));
    assert.match(node('new-job.js', [C, 'job-folder-two', '--folder', pf], 3), /2 videos; say which is the first cut/);
    assert.match(node('new-job.js', [C, 'job-folder-two', '--folder', pf, '--cut', 'Shophouse v3.mp4']), /first cut Shophouse v3\.mp4/);
    // A Drive link: exit 4 naming the incoming folder; staged files then make the job.
    const link = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv';
    assert.match(node('new-job.js', [C, 'job-drive-test', '--folder', link], 4), /DRIVE 1AbCdEfGhIjKlMnOpQrStUv/);
    const inc = path.join(ROOT, 'incoming', 'job-drive-test');
    const b64 = path.join(ROOT, 'cut.b64');
    fs.writeFileSync(b64, fs.readFileSync(path.join(src, 'first-cut.mp4')).toString('base64'));
    node('drive-stage.js', [inc, '--rel', 'Edit/first cut.mp4', '--b64', b64]);
    fs.writeFileSync(b64, Buffer.from('Brief from Drive.').toString('base64'));
    node('drive-stage.js', [inc, '--rel', 'brief.txt', '--b64', b64]);
    assert.match(node('drive-stage.js', [inc, '--rel', '../escape.txt', '--b64', b64], 3), /outside/);
    assert.match(node('new-job.js', [C, 'job-drive-test', '--folder', inc, '--folder-source', link]), /\(drive\); first cut Edit\/first cut\.mp4/);
    // The workspace itself is never a project folder.
    assert.match(node('new-job.js', [C, 'job-root-test', '--folder', ROOT], 3), /holds the workspace root/);
  });

  const fx = (name, data) => { const f = path.join(ROOT, name); fs.writeFileSync(f, JSON.stringify(data)); return f; };
  step('research, from the brief alone: needs no shots, and is checked before it is recorded', () => {
    assert.ok(!fs.existsSync(path.join(JD, 'shots.json')), 'the cut is not read yet');
    assert.match(node('record.js', [C, JOB, 'research', '--file', fx('research-bad.json', { summary: 'x', places: {} })], 1), /places must name at least one/);
    const out = node('record.js', [C, JOB, 'research', '--file', fx('research.json', {
      summary: 'Warm, slightly faded 1920s Straits look.', era: '1920s Singapore',
      places: { 'Shophouse Street': { name: 'Shophouse street', description: 'two-storey Peranakan shophouses, five-foot way, timber shutters' } },
      grade: { temperature: 5200, saturation: 0.85, contrast: 1.08, shadows: [0.02, 0, -0.03], highlights: [0.04, 0.02, -0.02] },
      palette: ['#c8a165', '#5b3a29'], queries: ['1920s Singapore shophouse street photo'], sources: ['https://example.org/shophouses'],
      mograph: MG ? [{ template: 'title', start: 0.5, durationSec: 2, props: { title: 'Kampong Glam', subtitle: '1926' } }] : [] })]);
    assert.match(out, /1 place\(s\): shophouse street/);
    assert.ok(fs.existsSync(path.join(JD, 'research.md')));
  });

  step('references', () => {
    assert.match(node('scrape.js', [C, JOB, 'add', '--file', path.join(src, 'street.png'), '--tag', 'shophouse street', '--license', 'test fixture']), /R01 kept .* as a reference/);
    assert.match(node('scrape.js', [C, JOB, 'add', '--file', path.join(src, 'street.png'), '--tag', 'shophouse street']), /already held as R01/);
    fs.writeFileSync(path.join(src, 'not.png'), 'hello');
    node('scrape.js', [C, JOB, 'add', '--file', path.join(src, 'not.png'), '--tag', 'x'], 3);
  });

  step('catalogue splits three shots, frame-exact', () => {
    const out = py('catalogue.py', [C, JOB]);
    assert.match(out, /^3 shot\(s\) from 150 frames/m, out);
    const s = read('shots.json');
    assert.deepStrictEqual(s.shots.map(x => x.frames), [50, 50, 50]);
    assert.ok(fs.existsSync(s.contactSheet) && fs.existsSync(s.audio));
  });

  step('interrogation is checked before it is recorded', () => {
    const bad = fx('bad.json', { shots: [{ id: 'S01', people: 'yes', camera: 'dolly' }] });
    const out = node('record.js', [C, JOB, 'interrogation', '--file', bad], 1);
    assert.match(out, /people must be true or false/); assert.match(out, /S02 is not in the interrogation/);
    const good = fx('inter.json', { shots: [
      { id: 'S01', people: true, subject: 'one person standing', setting: 'green screen', lighting: 'soft key from camera left', camera: 'static', screen: 'green', treatment: 'replace', location: 'Shophouse Street' },
      { id: 'S02', people: false, subject: 'test pattern', setting: 'graphic', lighting: 'flat', camera: 'static', screen: 'none', treatment: 'keep' },
      { id: 'S03', people: true, subject: 'one person standing', setting: 'green screen', lighting: 'soft key from camera left', camera: 'pan', screen: 'green', treatment: 'replace', location: 'shophouse street' }] });
    const ok = node('record.js', [C, JOB, 'interrogation', '--file', good]);
    assert.match(ok, /2 shot\(s\) to replace, 1 kept/); assert.match(ok, /S03: camera pan/);
    assert.doesNotMatch(ok, /not one of the researched places/);
  });

  step('look, after the cut: a prompt per location, the rest inherited from the research', () => {
    assert.match(node('record.js', [C, JOB, 'look', '--file', fx('look-bad.json', { locations: { harbour: { name: 'Harbour', description: 'quay' } } })], 1), /location "shophouse street" \(S01\) from the interrogation is missing/);
    const out = node('record.js', [C, JOB, 'look', '--file', fx('look.json', {
      locations: { 'shophouse street': { name: 'Shophouse street', description: 'two-storey Peranakan shophouses, five-foot way, timber shutters, golden hour', prompt: 'An empty 1920s Singapore shophouse street at golden hour, sun from camera left, locked-off framing, no people, no text' } } })]);
    assert.match(out, MG ? /1 mograph request/ : /0 mograph request/);
    const look = read('look.json');
    assert.strictEqual(look.grade.temperature, 5200, 'the grade comes from the research');
    assert.deepStrictEqual(look.queries, ['1920s Singapore shophouse street photo']);
  });

  step('hybrid brief: one background to generate, the kept shot untouched', () => {
    const out = node('hybrid.js', [C, JOB, 'brief']);
    assert.match(out, /3 shot\(s\), 2 to replace, S02 kept/); assert.match(out, /1 background\(s\) to generate/); assert.match(out, /Camera moves on S03/);
    assert.strictEqual(read('hybrid-brief.json').backgrounds['shophouse street'].lookReferences.length, 1);
  });

  step('no credits without a yes', () => {
    assert.match(node('hybrid.js', [C, JOB, 'land', 'shophouse street', '--file', path.join(src, 'street.png')], 3), /no background approval/);
  });

  const db = (col, id) => { const p = path.join(JD, '.board', 'db', col, id + '.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  // What the page writes when a person decides, as ArtifactData's out_dir hands it to land.
  const landed = (docs) => { const dir = fs.mkdtempSync(path.join(ROOT, 'landed-')); for (const [col, id, data] of docs) { const d = path.join(dir, 'projects', JOB, col); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, id + '.json'), JSON.stringify(data)); } return dir; };

  step('the board: steps, chat, shot cards and references', () => {
    for (const s of ['research', 'scraper', 'catalogue', 'interrogate', 'look']) node('state.js', [C, JOB, s, 'done']);
    assert.match(node('board-shots.js', [C, JOB]), /queued/);
    assert.match(node('board-sync.js', ['push', C, JOB]), /pushed \d+ write/);
    assert.strictEqual(db('projects', JOB).kind, 'lite');
    assert.strictEqual(db('items', 'intake').status, 'draft');
    assert.strictEqual(db('items', 'hybrid').status, 'pending');
    const s1 = db('panels', 'S01'); assert.ok(s1.thumb.startsWith('data:image/jpeg;base64,')); assert.strictEqual(s1.treatment, 'replace'); assert.strictEqual(s1.location, 'shophouse street');
    assert.strictEqual(db('references', 'R01').site, 'Supplied by the client');
    assert.ok(fs.readdirSync(path.join(JD, '.board', 'db', 'messages')).length >= 1);
    assert.match(node('board-shots.js', [C, JOB]), /nothing new/);
  });

  step('Gate A: signed off on the board, bound to the files', () => {
    node('record-version.js', [C, JOB, '--item', 'look', '--n', '1', '--file', 'look.json', '--note', 'The look', '--seat', 'researcher']);
    node('board-sync.js', ['pull', C, JOB, '--gate', 'A'], 3);
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(JD, 'look.json'))).digest('hex');
    const out = node('board-sync.js', ['land', C, JOB, landed([['gates', 'A', { status: 'passed', decidedBy: 'creative-director', decidedAt: '2026-10-09T02:00:00Z', round: 1, items: { look: { status: 'approved', version: 1, file: 'look.json', sha256: sha } } }]])]);
    assert.match(out, /gate A approved by creative-director/);
    assert.match(node('board-sync.js', ['pull', C, JOB, '--gate', 'A']), /gate A approved/);
  });

  step('the credit question: asked on the Hybrid step, answered on the board', () => {
    node('hybrid.js', [C, JOB, 'quote', 'shophouse street', '--credits', '1']);
    assert.match(node('board-sync.js', ['ask', C, JOB, '--item', 'hybrid', '--text', 'Generate 1 background (shophouse street) for 1 credit?', '--options', 'Approve 1 credit|Decline']), /Approve 1 credit \/ Decline/);
    node('board-sync.js', ['push', C, JOB]);
    const q = fs.readdirSync(path.join(JD, '.board', 'db', 'inbox')).map(f => f.replace(/\.json$/, '')).find(id => /^q-/.test(id));
    assert.strictEqual(db('inbox', q).status, 'open');
    const out = node('board-sync.js', ['land', C, JOB, landed([['inbox', q, { ...db('inbox', q), status: 'answered', answer: 'Approve 1 credit', answeredBy: 'lead', answeredAt: '2026-10-09T02:10:00Z' }]])]);
    assert.match(out, /answered -> Approve 1 credit/);
    node('hybrid.js', [C, JOB, 'approve', 'backgrounds', '--by', 'lead', '--at', '2026-10-09T02:10:00Z', '--credits', '1']);
    node('hybrid.js', [C, JOB, 'land', 'shophouse street', '--file', path.join(src, 'street.png'), '--credits', '2'], 3);
    assert.match(node('hybrid.js', [C, JOB, 'land', 'shophouse street', '--file', path.join(src, 'street.png'), '--credits', '1']), /Every location has a background/);
  });

  step('cut-out and composite keep the person', () => {
    const cut = py('cutout.py', [C, JOB]);
    assert.match(cut, /S01 cut out by diffkey/); assert.match(cut, /S03 cut out by diffkey/);
    const comp = py('composite.py', [C, JOB]);
    for (const p of read('hybrid-brief.json').panels.filter(p => p.plate)) assert.ok(p.composite.actorPreservedPct >= 97, p.id + ' kept ' + p.composite.actorPreservedPct + '%\n' + comp);
  });

  step('grade', () => {
    assert.match(py('grade.py', [C, JOB, '--stills']), /S01 still from composite[\s\S]*S02 still from the cut/);
    py('grade.py', [C, JOB]);
    const g = read('grade.json'); assert.ok(/colortemperature=temperature=5200/.test(g.filter), g.filter);
    assert.ok(Object.values(g.shots).every(s => s.file && fs.existsSync(s.file)));
  });

  step(MG ? 'mograph: a title overlay with alpha' : 'mograph: skipped, composer not set up here', () => {
    if (!MG) { assert.match(node('mograph.js', [C, JOB, 'plan']), /no motion graphics/); return; }
    node('mograph.js', [C, JOB, 'plan']);
    assert.match(node('mograph.js', [C, JOB, 'run']), /yuva444p/);
  });

  step('render: master matches the first cut', () => {
    const out = py('render.py', [C, JOB]);
    assert.match(out, /150 frames/); assert.match(out, /checks: ok/); assert.match(out, MG ? /1 overlay/ : /0 overlay/);
    const r = read('render.json'); assert.strictEqual(r.checks, 'ok'); assert.ok(fs.existsSync(r.preview));
  });

  step('review, the shot cards, and Gate B', () => {
    node('record.js', [C, JOB, 'review', '--file', fx('review.json', { shots: [{ id: 'S01', verdict: 'pass' }, { id: 'S02', verdict: 'pass' }, { id: 'S03', verdict: 'fail', issues: ['background does not pan with the camera'] }], final: { verdict: 'pass' } })]);
    for (const s of ['hybrid', 'grade', 'render', 'review']) node('state.js', [C, JOB, s, 'done']);
    node('state.js', [C, JOB, 'mograph', MG ? 'done' : 'skipped']);
    node('record-version.js', [C, JOB, '--item', 'render', '--n', '1', '--file', 'render.json', '--note', 'Master, 150 frames, checks ok', '--seat', 'renderer']);
    node('state.js', [C, JOB, 'say', '--as', 'renderer', '--item', 'render', '--text', 'Master rendered: 150 frames, sound and length match the first cut.']);
    node('board-shots.js', [C, JOB]);
    node('board-sync.js', ['push', C, JOB]);
    const s3 = db('panels', 'S03');
    assert.strictEqual(s3.verdict, 'fail'); assert.ok(s3.after.startsWith('data:image/jpeg;base64,')); assert.ok(s3.graded.startsWith('data:image/jpeg;base64,')); assert.ok(s3.actorKept >= 97);
    assert.ok(db('previews', 'hybrid').thumb && db('previews', 'grade').thumb && db('previews', 'catalogue').thumb);
    assert.strictEqual(db('items', 'render').status, 'draft');
    assert.strictEqual(db('projects', JOB).status, 'master');
    for (const f of fs.readdirSync(path.join(JD, '.board', 'db', 'panels'))) assert.ok(fs.statSync(path.join(JD, '.board', 'db', 'panels', f)).size < 240 * 1024, f + ' is too big for a board document');
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(JD, 'render.json'))).digest('hex');
    node('board-sync.js', ['land', C, JOB, landed([['gates', 'B', { status: 'passed', decidedBy: 'creative-director', decidedAt: '2026-10-09T03:00:00Z', round: 1, items: { render: { status: 'approved', version: 1, file: 'render.json', sha256: sha } } }]])]);
    assert.match(node('board-sync.js', ['pull', C, JOB, '--gate', 'B']), /gate B approved/);
    assert.match(node('state.js', [C, JOB, 'show']), /Gate B Master sign-off: approved by creative-director/);
  });

  step('the master poster and the Google copies', () => {
    const r = read('render.json'); assert.ok(r.poster && fs.existsSync(r.poster) && fs.statSync(r.poster).size <= 140 * 1024);
    node('set-preview.js', [C, JOB, '--item', 'render', '--video-url', '/_blob/0123456789abcdef']);
    node('board-sync.js', ['push', C, JOB]);
    const pv = db('previews', 'render'); assert.ok(pv.poster.startsWith('data:image/jpeg;base64,') && pv.w > 0 && pv.h > 0);
    const out = node('gdocs.js', [C, JOB, 'export']);
    for (const item of ['research', 'interrogate', 'review']) assert.match(out, new RegExp('^' + item + '\\t', 'm'));
    const csvFile = out.split('\n').find(l => l.startsWith('interrogate\t')).split('\t')[4];
    assert.match(fs.readFileSync(csvFile, 'utf8'), /^"Shot","In","Out"/);
    node('gdocs.js', [C, JOB, 'link', '--item', 'review', '--url', 'https://docs.google.com/document/d/abc123/edit']);
    node('board-sync.js', ['push', C, JOB]);
    const links = db('items', 'review').links; assert.strictEqual(links[0].label, 'Google Doc'); assert.strictEqual(links[0].version, 1);
    assert.throws(() => node('gdocs.js', [C, JOB, 'link', '--item', 'review', '--url', 'https://example.com/x']));
  });

  step('the real board: pins for what a person writes, kept versions for what the run writes', () => {
    env.PROD_LITE_BOARD_URL = 'https://claude.ai/artifact/test';
    try {
      node('state.js', [C, JOB, 'review', 'running']);
      // A shot card that changed: the run wrote it before (version 2 on the board), so it carries its own version.
      const ownP = path.join(JD, '.board', 'own-versions.json');
      const own = fs.existsSync(ownP) ? JSON.parse(fs.readFileSync(ownP, 'utf8')) : {};
      own['projects/' + JOB + '/panels/S02'] = 2; fs.writeFileSync(path.join(JD, '.board', 'own-versions.json'), JSON.stringify(own));
      const sent = JSON.parse(fs.readFileSync(path.join(JD, '.board', 'shots-sent.json'), 'utf8')); delete sent['panels/S02']; fs.writeFileSync(path.join(JD, '.board', 'shots-sent.json'), JSON.stringify(sent));
      node('board-shots.js', [C, JOB]);
      const out = JSON.parse(node('board-sync.js', ['push', C, JOB, '--files']));
      const ws = out.batches.flat();
      const card = ws.find(w => w.doc_id === 'S02'); assert.strictEqual(card.if_version, 2); assert.ok(fs.existsSync(card.file_path));
      assert.ok(out.pins.some(p => p.doc_id === 'review' && /\/items$/.test(p.collection)), 'a step is pinned: a person writes steps too');
      assert.ok(!out.pins.some(p => /\/panels$/.test(p.collection)), 'shot cards are never pinned');
      node('board-sync.js', ['push', C, JOB, '--ack']);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(JD, '.board', 'own-versions.json'), 'utf8'))['projects/' + JOB + '/panels/S02'], 3);
    } finally { delete env.PROD_LITE_BOARD_URL; }
  });
  console.log('e2e: all passed');
} finally {
  if (process.env.KEEP) console.log('kept: ' + ROOT); else fs.rmSync(ROOT, { recursive: true, force: true });
}
