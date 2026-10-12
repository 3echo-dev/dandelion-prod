#!/usr/bin/env node
// The shots on the board: one card per shot of the first cut, carrying what each step made of it.
//
//   node board-shots.js <client> <job-id>
//
// Queues projects/{job}/panels/{S01..} with the shot's middle frame (thumb), the interrogator's
// read (caption, treatment, new place), the composite's before/after (after) and the grade's
// before/after (graded), actor-kept and the review verdict; and a preview on the catalogue,
// hybrid and grade steps (the contact sheet, one composite, one graded shot). Pictures go as small
// JPEG data URIs, well under what a board document holds. Run it after catalogue, interrogate,
// composite, grade and review; push next. It only re-sends what changed.
// Exit 0 queued · 2 usage · 3 no shots yet
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./lib-job.js');
const B = require('./lib-board.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
if (!J) { console.error('usage: board-shots.js <client> <job-id>'); process.exit(2); }
const shots = J.read('shots.json', null);
if (!shots) { console.error('no shots.json yet; run catalogue.py'); process.exit(3); }
const inter = new Map(((J.read('interrogation.json', null) || {}).shots || []).map(s => [s.id, s]));
const panels = new Map(((J.read('hybrid-brief.json', null) || {}).panels || []).map(p => [p.id, p]));
const graded = (J.read('grade.json', null) || {}).shots || {};
const review = new Map(((J.read('review.json', null) || {}).shots || []).map(s => [s.id, s]));
const job = J.job();
const fps = Number(job.source.fps) || 25;

// A picture as a JPEG data URI at `width`, cached by the source's hash under .board/thumbs/.
function jpeg(file, width) {
  if (!file || !fs.existsSync(file)) return null;
  const out = J.file('.board', 'thumbs', L.sha256File(file).slice(0, 16) + '-' + width + '.jpg');
  if (!fs.existsSync(out)) {
    L.ensureDir(path.dirname(out));
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', 'scale=' + width + ':-2', '-frames:v', '1', '-q:v', '5', out], { encoding: 'utf8' });
    if (r.status !== 0) return null;
  }
  return 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64');
}
const tc = sec => { const f = Math.round(sec * fps), r = Math.round(fps), s = Math.floor(f / r), p = n => String(n).padStart(2, '0'); return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + ':' + p(f % r); };

const sentP = J.file('.board', 'shots-sent.json');
const sent = L.readJson(sentP, {});
let queued = 0;
const queue = (collection, docId, data) => {
  const h = L.sha256Text(JSON.stringify(data));
  if (sent[collection + '/' + docId] === h) return;
  B.appendOutbox(process.cwd(), J.client, J.jobId, { collection, docId, data: { ...data, updatedAt: L.nowIso() } });
  sent[collection + '/' + docId] = h; queued++;
};

for (const s of shots.shots) {
  const r = inter.get(s.id); const p = panels.get(s.id) || {}; const g = graded[s.id]; const v = review.get(s.id);
  const comp = p.composite || null;
  queue('panels', s.id, {
    storyOrder: s.n, scene: tc(s.start) + ' to ' + tc(s.end), width: job.source.width, height: job.source.height,
    thumb: jpeg(s.mid, 320),
    caption: r ? r.subject : s.duration.toFixed(2) + ' s',
    treatment: r ? r.treatment : null, location: r && r.treatment === 'replace' ? r.location : null,
    after: comp && comp.preview ? jpeg(comp.preview, 480) : null,
    actorKept: comp ? comp.actorPreservedPct : null,
    graded: g && g.preview ? jpeg(g.preview, 480) : null,
    verdict: v ? v.verdict : null, issues: v && v.issues && v.issues.length ? v.issues.join('; ') : null,
  });
}
// One picture per step card.
const firstComp = [...panels.values()].find(p => p.composite && p.composite.preview);
const firstGrade = shots.shots.map(s => graded[s.id]).find(g => g && g.preview);
if (shots.contactSheet) queue('previews', 'catalogue', { thumb: jpeg(shots.contactSheet, 640), caption: shots.shots.length + ' shots, the middle frame of each' });
if (firstComp) queue('previews', 'hybrid', { thumb: jpeg(firstComp.composite.preview, 640), caption: firstComp.id + ': plate and composite' });
if (firstGrade) queue('previews', 'grade', { thumb: jpeg(firstGrade.preview, 640), caption: 'Before and after the grade' });
L.writeJson(sentP, sent);
B.appendOutbox(process.cwd(), J.client, J.jobId, { collection: 'projects', docId: J.jobId, op: 'update', data: { shots: shots.shots.length } });
console.log(queued ? queued + ' shot card(s) and preview(s) queued; push next.' : 'nothing new to show on the board.');
