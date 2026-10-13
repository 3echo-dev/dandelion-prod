#!/usr/bin/env node
// The compositor hand-off: one Nuke script per replaced shot, and the way back in.
//
//   node nuke.js <client> <job-id> export [--shots S01,S03] [--by <who asked>] [--wait]
//        writes handoff/nuke-v<n>/: a folder per shot with <shot>.nk, the plate, the background,
//        the pipeline's own composite as a reference and an empty render/ folder, plus README.md
//        with the reviewer's notes per shot. Without --shots: every replaced shot. --wait (Gate B's
//        "Send to compositor"): the master waits until every shot of the round is returned;
//        without it the scripts are a deliverable beside the master and nothing waits.
//   node nuke.js <client> <job-id> return --shot S01 --file <render: a .mov/.mp4, or a folder or
//        any frame of an image sequence written by the script's Write node>
//        checks the render (frame count and size against the shot), encodes it with the plate's
//        sound as media/footage/composite/<shot>-nuke-v<n>.mp4 and makes it the shot's composite
//        in hybrid-brief.json (the pipeline's own composite is kept as pipelineFile). Then
//        grade.py and render.py again, and the reviewer.
//   node nuke.js <client> <job-id> status
//
// The script rebuilds the pipeline's composite node for node, so what opens in Nuke is what the
// master shows: the colour-difference key with colour extraction (cutout.py), the spill cap, the
// softened and choked matte, the background covered, brightened and defocused as composite.py did,
// the edge despill and the light wrap. The comp works on display values (every Read and the Write
// are raw), as the pipeline does; the grade and the titles are not in it, because render.py puts
// them back on the returned shot. Paths are relative to the script, so the folder can be copied to
// the compositor's machine as it is.
//
// Exit 0 ok · 2 usage · 3 not ready (no composite yet, render does not match the shot)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');
const board = require('./lib-board.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
const cmd = J && J.rest[0];
const USAGE = 'usage: nuke.js <client> <job-id> export [--shots S01,S03] [--by <who>] [--wait] | return --shot <id> --file <render> | status';
if (!J || !['export', 'return', 'status'].includes(cmd)) { console.error(USAGE); process.exit(2); }
const die = (msg, code = 3) => { console.error(msg); process.exit(code); };

const job = J.job() || die('no job.json');
const brief = J.read('hybrid-brief.json', null) || die('no hybrid-brief.json: the hybrid step has not run yet');
const review = J.read('review.json', null);
const W = job.source.width, H = job.source.height, FPS = Number(job.source.fps);
const handoffDir = J.file('handoff');
const stateFile = J.file('handoff', 'nuke.json');
const state = L.readJson(stateFile, { rounds: [] });
const saveState = () => { L.ensureDir(handoffDir); L.writeJson(stateFile, state); };
const replaced = (brief.panels || []).filter(p => p.composite && p.composite.file && p.cutout);

// ---- .nk writing ----
// A string knob in a .nk file: quoted, with Tcl's brackets escaped so they are kept as text and
// evaluated when Nuke reads the file path, not when it parses the script.
const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\r?\n/g, '\\n') + '"';
const rel = f => '"\\[file dirname \\[value root.name]]/' + f + '"';
const n4 = x => Number(x).toFixed(4).replace(/\.?0+$/, '') || '0';

function nk(p, notes) {
  const id = p.id, frames = p.frames;
  const fmt = `"${W} ${H} 0 0 ${W} ${H} 1 ${job.jobId.replace(/[^A-Za-z0-9]/g, '_')}_${W}x${H}"`;
  const c = p.cutout, comp = p.composite;
  const blue = (c.keyColour && c.keyColour.kind) === 'blue';
  const hex = parseInt(String((c.keyColour || {}).hex || '0x00ff00').replace(/^0x|^#/, ''), 16);
  const K = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => v / 255);
  // cutout.py: the screen level is the key colour's own difference, lo and hi fractions of it.
  const scr = Math.max(20 / 255, blue ? K[2] - Math.max(K[0], K[1]) : K[1] - Math.max(K[0], K[2]));
  const [lo, hi] = c.keyRange || [0.18, 0.62];
  const LO = scr * lo, HI = scr * Math.max(hi, lo + 0.05);
  const S = blue ? 'b' : 'g', O = blue ? 'max(r, g)' : 'max(r, b)';
  const key = `(1 - clamp((${S} - ${O} - ${n4(LO)}) / ${n4(HI - LO)}))`;
  const ext = (ch, k) => `k > 0.05 ? clamp((${ch} - (1 - s) * ${n4(k)}) / s) : ${ch}`;
  const shift = Number(comp.brightnessShift || 0);
  const defocus = Number(p.defocus || 0) * W / 1080;
  const wrap = Number(comp.lightWrap == null ? 0.5 : comp.lightWrap);
  const k = W / 1080;
  // Nuke's Blur size is about 2.5 gaussian sigmas: composite.py's sigmas, as sizes.
  const size = sigma => n4(sigma * 2.5);
  const node = (cls, knobs, pos) => `${cls} {\n${knobs.map(([kk, v]) => ` ${kk} ${v}`).join('\n')}\n xpos ${pos[0]}\n ypos ${pos[1]}\n}\n`;
  const read = (name, file, label, first, last, pos) => node('Read', [['inputs', 0], ['file', rel(file)], ['format', fmt], ['first', first], ['last', last], ['origfirst', first], ['origlast', last], ['origset', 'true'], ['raw', 'true'], ['name', name], ['label', q(label)]], pos);
  const expr = (name, e, label, pos, temps = []) => node('Expression', [...temps.flatMap(([n, t], i) => [['temp_name' + i, n], ['temp_expr' + i, q(t)]]), ['expr0', q(e[0])], ['expr1', q(e[1])], ['expr2', q(e[2])], ['expr3', q(e[3])], ['name', name], ['label', q(label)]], pos);
  const mexpr = (name, e, label, pos) => node('MergeExpression', [['inputs', 2], ['expr0', q(e[0])], ['expr1', q(e[1])], ['expr2', q(e[2])], ['expr3', q(e[3])], ['name', name], ['label', q(label)]], pos);
  const blur = (name, channels, sz, label, pos) => node('Blur', [['channels', channels], ['size', sz], ['name', name], ['label', q(label)]], pos);
  const sticky = [
    `${id}, ${job.title}: the pipeline's composite, rebuilt node for node.`,
    `Render the Write node (render/${id}.####.png, ${frames} frames, ${W}x${H}) and send the folder back; the pipeline grades it and lays the titles on again.`,
    `Everything is on display values (raw), as the master is. The DiffKey is a colour-difference key; swap in Keylight or IBK for hair as you like.`,
    notes.length ? 'Reviewer notes:\n- ' + notes.join('\n- ') : 'No reviewer notes for this shot.',
  ].join('\n\n');
  let s = '';
  s += '#! nuke -nx\nversion 14.0 v5\n';
  s += `Root {\n inputs 0\n frame 1\n first_frame 1\n last_frame ${frames}\n lock_range true\n format ${fmt}\n fps ${n4(FPS)}\n}\n`;
  s += node('StickyNote', [['inputs', 0], ['name', 'Notes'], ['label', q(sticky)], ['note_font_size', 16]], [-560, -600]);
  s += read('REF_PipelineComp', 'ref_pipeline_comp.mp4', 'REFERENCE: the composite the master uses now', 1, frames, [300, -600]);
  // The person, keyed as cutout.py keys them.
  s += read('Plate', 'plate.mp4', 'the shot as filmed', 1, frames, [0, -600]);
  s += expr('DiffKey', [ext('r', K[0]), ext('g', K[1]), ext('b', K[2]), 'k'],
    `colour-difference key with colour extraction\nscreen ${(c.keyColour || {}).hex || ''}, range ${lo}-${hi}`, [0, -480],
    [['k', key], ['s', `max(${key}, 0.05)`]]);
  s += expr('SpillCap', ['r', blue ? 'g' : 'min(g, max(r, b))', blue ? 'min(b, max(r, g))' : 'b', 'a'], 'spill: the screen channel no higher than the other two', [0, -400]);
  s += blur('MatteSoften', 'alpha', size(1.0 * k), 'soften by about a pixel', [0, -340]);
  s += expr('MatteChoke', ['r', 'g', 'b', 'clamp((a - 0.12) / 0.84)'], 'choke 0.12', [0, -280]);
  s += node('Premult', [['name', 'Premult1']], [0, -220]);
  s += 'set NFG [stack 0]\n';
  // The place, prepared as composite.py prepares it.
  s += read('Background', 'background.png', 'the new place (' + (p.location || p.background || '') + ')', 1, 1, [-300, -600]);
  s += node('Reformat', [['format', fmt], ['resize', 'fill'], ['center', 'true'], ['name', 'Cover'], ['label', q('cover the frame, centred')]], [-300, -480]);
  s += expr('Brightness', [`r + ${n4(shift)}`, `g + ${n4(shift)}`, `b + ${n4(shift)}`, '1'], `brightness ${n4(shift)} towards the actor`, [-300, -400]);
  if (defocus > 0) s += blur('LensDefocus', 'rgb', size(defocus), `lens match: gaussian ${n4(defocus)} px`, [-300, -340]);
  s += 'set NBG [stack 0]\n';
  // Over, then the edge despill where the person meets the place.
  s += 'push $NBG\npush $NFG\n';
  s += node('Merge2', [['inputs', 2], ['operation', 'over'], ['name', 'Comp']], [-150, -160]);
  s += 'push $NFG\n';
  s += mexpr('EdgeDespill', ['Br', blue ? 'Bg' : 'Aa > 0.02 && Aa < 0.995 ? min(Bg, max(Br, Bb) + 1 / 255) : Bg', blue ? 'Aa > 0.02 && Aa < 0.995 ? min(Bb, max(Br, Bg) + 1 / 255) : Bb' : 'Bb', 'Aa'],
    'edge despill in the blend band; alpha = the person', [-150, -90]);
  s += 'set NCD [stack 0]\n';
  // Light wrap: the softened place bleeds a few pixels onto the person's edges.
  if (wrap > 0) {
    s += 'push $NFG\n';
    s += expr('InvAlpha', ['r', 'g', 'b', '1 - a'], 'outside the person', [150, -160]);
    s += blur('InvSoften', 'alpha', size(12 * k), 'gaussian 12 px', [150, -110]);
    s += 'set NINV [stack 0]\n';
    s += 'push $NCD\npush $NINV\n';
    s += mexpr('WrapEdge', ['Br', 'Bg', 'Bb', `Ba * Aa * ${n4(wrap)}`], `light wrap ${n4(wrap)}: how much of the place reaches each edge pixel`, [0, -20]);
    s += 'set NWE [stack 0]\n';
    s += 'push $NBG\n';
    s += blur('PlaceSoft', 'rgb', size(30 * k), 'the place, softened (gaussian 30 px)', [-300, -20]);
    s += 'push $NWE\n';
    s += mexpr('LightWrap', ['Ar + Aa * (Br - Ar)', 'Ag + Aa * (Bg - Ag)', 'Ab + Aa * (Bb - Ab)', '1'], 'mix the softened place in at the edges', [-150, 60]);
  } else {
    s += expr('Solid', ['r', 'g', 'b', '1'], 'no light wrap on this shot', [-150, 60]);
  }
  s += node('Write', [['file', rel(`render/${id}.####.png`)], ['file_type', 'png'], ['raw', 'true'], ['create_directories', 'true'], ['first', 1], ['last', frames], ['use_limit', 'true'], ['name', 'Write_Return'], ['label', q('back to the pipeline')]], [-150, 160]);
  s += node('Viewer', [['inputs', 1], ['frame', 1], ['frame_range', `1-${frames}`], ['name', 'Viewer1']], [-150, 260]);
  return s;
}

const notesFor = id => {
  const shot = review && (review.shots || []).find(x => x.id === id);
  return shot && Array.isArray(shot.issues) ? shot.issues.map(String) : [];
};

if (cmd === 'status') {
  if (!state.rounds.length) { console.log('no Nuke hand-off yet'); process.exit(0); }
  for (const r of state.rounds) console.log(`nuke-v${r.n} ${r.status}: ${r.shots.map(s => s.id + ' ' + s.status).join(', ')} (${r.folder})`);
  process.exit(0);
}

if (cmd === 'export') {
  if (!replaced.length) die('no shot has a composite yet: run the hybrid step first.');
  const want = L.opt(argv, '--shots');
  const ids = want ? want.split(',').map(x => x.trim()).filter(Boolean) : replaced.map(p => p.id);
  const unknown = ids.filter(id => !replaced.some(p => p.id === id));
  if (unknown.length) die('not replaced shots with a composite: ' + unknown.join(', '), 2);
  const n = state.rounds.length + 1;
  const out = path.join(handoffDir, 'nuke-v' + n);
  L.ensureDir(out);
  const shots = [];
  for (const id of ids) {
    const p = replaced.find(x => x.id === id);
    const bg = (brief.backgrounds || {})[p.background] || {};
    if (!bg.file || !fs.existsSync(bg.file)) die(id + ': its background file is missing (' + (bg.file || 'none') + ')');
    const d = path.join(out, id); L.ensureDir(path.join(d, 'render'));
    fs.copyFileSync(p.plate, path.join(d, 'plate.mp4'));
    fs.copyFileSync(bg.file, path.join(d, 'background.png'));
    fs.copyFileSync(p.composite.file, path.join(d, 'ref_pipeline_comp.mp4'));
    const notes = notesFor(id);
    fs.writeFileSync(path.join(d, id + '.nk'), nk(p, notes));
    shots.push({ id, status: 'out', frames: p.frames, notes: notes.length, script: L.fwd(path.join(d, id + '.nk')) });
  }
  const readme = [`# ${job.title}: Nuke hand-off v${n}`, '',
    `${shots.length} shot(s), ${W}x${H} at ${n4(FPS)} fps. Open each shot's .nk in Nuke; every path is relative to the script, so copy the folder as it is.`, '',
    'Each script rebuilds the composite the master uses now (`ref_pipeline_comp.mp4` beside it, for comparison): the key, the spill cap, the matte, the background as placed, the edge despill and the light wrap. Fix what the notes say, render the Write node (a PNG sequence in `render/`), and send the folder back. The pipeline grades the shot and lays the titles on again; do not grade or title here.', '',
    ...shots.flatMap(s => [`## ${s.id}`, '', ...(notesFor(s.id).length ? notesFor(s.id).map(x => '- ' + x) : ['- No reviewer notes.']), ''])].join('\n');
  fs.writeFileSync(path.join(out, 'README.md'), readme);
  const wait = L.has(argv, '--wait');
  state.rounds.push({ n, folder: L.fwd(out), status: wait ? 'out' : 'delivered', wait, by: L.opt(argv, '--by') || null, at: L.nowIso(), shots });
  saveState();
  board.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'projects', docId: J.jobId, op: 'update', data: { handoff: { kind: 'nuke', round: n, status: wait ? 'out' : 'delivered', shots: shots.map(s => s.id), at: L.nowIso() } } });
  // The board's request is answered by this export: close it so a later land does not repeat it.
  if (wait) {
    const ip = board.inboxPath(process.cwd(), J.client, J.jobId);
    const open = fs.existsSync(ip) ? fs.readFileSync(ip, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.type === 'compositor' && r.status === 'open') : [];
    for (const r of open) board.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'inbox', docId: r.id, op: 'update', data: { status: 'answered', answer: 'nuke-v' + n, answeredAt: L.nowIso(), answeredBy: 'pipeline' } });
  }
  console.log(`Nuke hand-off v${n}: ${shots.map(s => s.id).join(', ')} in ${L.fwd(out)}` + (wait ? '; the master waits for every shot to come back' : '; a deliverable, nothing waits') + ' (queued to the board; push next).');
  process.exit(0);
}

if (cmd === 'return') {
  const id = L.opt(argv, '--shot'), file = L.opt(argv, '--file');
  if (!id || !file) die(USAGE, 2);
  const round = [...state.rounds].reverse().find(r => r.shots.some(s => s.id === id));
  if (!round) die(id + ' was not handed to Nuke (nuke.js export first).', 2);
  const p = (brief.panels || []).find(x => x.id === id);
  let abs = path.resolve(file);
  if (!fs.existsSync(abs)) die('no such file or folder: ' + L.fwd(abs), 2);
  // An image sequence: a folder of frames or one frame of it, as an ffmpeg pattern.
  let input = ['-i', abs], label = path.basename(abs);
  const seqDir = fs.statSync(abs).isDirectory() ? abs : (/\.(png|exr|tif|tiff|jpg|dpx)$/i.test(abs) ? path.dirname(abs) : null);
  if (seqDir) {
    const frames = fs.readdirSync(seqDir).filter(f => /\d+\.(png|exr|tif|tiff|jpg|dpx)$/i.test(f)).sort();
    if (!frames.length) die('no numbered frames in ' + L.fwd(seqDir));
    const m = /^(.*?)(\d+)(\.[A-Za-z]+)$/.exec(frames[0]);
    input = ['-framerate', String(FPS), '-start_number', String(Number(m[2])), '-i', path.join(seqDir, m[1] + '%0' + m[2].length + 'd' + m[3])];
    label = frames.length + ' frames ' + frames[0] + '..';
  }
  const n = (fs.readdirSync(path.dirname(p.composite.file)).filter(f => f.startsWith(id + '-nuke-v')).length) + 1;
  const dest = path.join(path.dirname(p.composite.file), `${id}-nuke-v${n}.mp4`);
  const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', ...input, '-i', p.plate, '-map', '0:v', '-map', '1:a?', '-frames:v', String(p.frames), '-vf', 'format=yuv420p', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-c:a', 'aac', '-b:a', '192k', '-shortest', dest], { encoding: 'utf8' });
  if (enc.status !== 0) die('ffmpeg could not read the render: ' + (enc.stderr || '').trim().slice(-600));
  const pr = spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_packets', '-of', 'csv=p=0', dest], { encoding: 'utf8' });
  const [w, h, frames] = String(pr.stdout || '').trim().split(',').map(Number);
  if (w !== W || h !== H || frames !== p.frames) { fs.unlinkSync(dest); die(`${id}: the render is ${w}x${h}, ${frames} frames; the shot is ${W}x${H}, ${p.frames} frames. Render the Write node over the full range.`); }
  p.composite = Object.assign({}, p.composite, {
    pipelineFile: p.composite.pipelineFile || p.composite.file, pipelineSha: p.composite.pipelineSha || p.composite.sha256,
    file: L.fwd(dest), sha256: L.sha256File(dest), source: 'nuke', handoff: 'nuke-v' + round.n, returnedAt: L.nowIso(), returnedFrom: label,
  });
  J.write('hybrid-brief.json', brief);
  const s = round.shots.find(x => x.id === id); s.status = 'returned'; s.file = L.fwd(dest);
  if (round.shots.every(x => x.status === 'returned')) round.status = 'returned';
  saveState();
  board.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'projects', docId: J.jobId, op: 'update', data: { handoff: { kind: 'nuke', round: round.n, status: round.status, shots: round.shots.map(x => x.id), returned: round.shots.filter(x => x.status === 'returned').map(x => x.id), at: L.nowIso() } } });
  console.log(`${id} back from Nuke: ${L.fwd(dest)} is its composite now (${frames} frames).` + (round.status === 'returned' ? ' Every shot of this round is back: grade.py, render.py, then the review.' : ' Waiting on: ' + round.shots.filter(x => x.status !== 'returned').map(x => x.id).join(', ') + '.'));
  process.exit(0);
}
