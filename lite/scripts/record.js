#!/usr/bin/env node
// Checks and records what an agent wrote, so a later stage can trust it.
//
//   node record.js <client> <job-id> research --file <json>        the researcher's first pass: the places, from the brief
//   node record.js <client> <job-id> interrogation --file <json>   the interrogator's read of every shot
//   node record.js <client> <job-id> look --file <json>            the researcher's second pass: a prompt per location, matched to the shots
//   node record.js <client> <job-id> review --file <json>          the interrogator's check of the results
//
// A file that fails the check is not recorded: the script names every problem and exits 1, and the
// agent fixes it. A recorded file is copied into the job (research.json, interrogation.json,
// look.json, review.json), the last three with the hash of the shots index they were written
// against. A look leaves out what the research already settled (summary, era, grade, palette,
// mograph, queries, sources) and inherits it.
// Exit 0 recorded · 1 failed the check · 2 usage · 3 not ready
const fs = require('fs');
const path = require('path');
const L = require('./lib-job.js');

const argv = process.argv.slice(2);
const J = L.open(argv);
const kind = J && J.rest[0];
const file = L.opt(argv, '--file');
if (!J || !['research', 'interrogation', 'look', 'review'].includes(kind) || !file) { console.error('usage: record.js <client> <job-id> research|interrogation|look|review --file <json>'); process.exit(2); }
const shots = kind === 'research' ? { shots: [] } : J.read('shots.json', null);
if (!shots) { console.error('no shots.json; run catalogue.py first'); process.exit(3); }
let data;
try { data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { console.error('cannot read ' + file + ': ' + e.message); process.exit(1); }

const ids = shots.shots.map(s => s.id);
const errs = [];
const str = (v, where) => { if (typeof v !== 'string' || !v.trim()) errs.push(where + ' must be a non-empty string'); };
const oneOf = (v, list, where) => { if (!list.includes(v)) errs.push(where + ' must be one of ' + list.join(', ') + ' (got ' + JSON.stringify(v) + ')'); };
const num = (v, lo, hi, where) => { if (v === undefined || v === null) return; if (typeof v !== 'number' || v < lo || v > hi) errs.push(where + ' must be a number from ' + lo + ' to ' + hi); };
const CAMERA = ['static', 'pan', 'tilt', 'push', 'pull', 'zoom', 'tracking', 'handheld', 'crane', 'other'];
const keyOf = s => String(s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const notes = [];
const research = J.read('research.json', null);
const placeKeys = research ? Object.keys(research.places || {}) : [];

// The grade, the palette, the titles and the searches: settled once, in the research, and
// checked again in the look.
function checkLookFields(d) {
  const g = d.grade;
  if (!g || typeof g !== 'object') errs.push('grade must be an object (an empty one {} means no grade)');
  else {
    num(g.exposure, -2, 2, 'grade.exposure'); num(g.contrast, 0.5, 2, 'grade.contrast'); num(g.saturation, 0, 3, 'grade.saturation');
    num(g.gamma, 0.5, 2, 'grade.gamma'); num(g.temperature, 2000, 12000, 'grade.temperature'); num(g.vibrance, -2, 2, 'grade.vibrance');
    for (const band of ['shadows', 'midtones', 'highlights']) {
      if (g[band] === undefined) continue;
      if (!Array.isArray(g[band]) || g[band].length !== 3 || g[band].some(x => typeof x !== 'number' || x < -1 || x > 1)) errs.push('grade.' + band + ' must be [r, g, b], each from -1 to 1');
    }
    if (g.lut !== undefined) { if (typeof g.lut !== 'string' || !/\.cube$/i.test(g.lut)) errs.push('grade.lut must be a path to a .cube file'); else if (!fs.existsSync(path.resolve(J.dir, g.lut)) && !fs.existsSync(path.resolve(g.lut))) errs.push('grade.lut ' + g.lut + ' does not exist'); }
    if (g.curves !== undefined && typeof g.curves !== 'string') errs.push('grade.curves must be an ffmpeg curves preset name (e.g. vintage, darker, lighter)');
  }
  if (d.palette !== undefined && (!Array.isArray(d.palette) || d.palette.some(c => !/^#[0-9a-f]{6}$/i.test(c)))) errs.push('palette must be a list of #rrggbb colours');
  if (d.queries !== undefined && (!Array.isArray(d.queries) || d.queries.some(q => typeof q !== 'string'))) errs.push('queries must be a list of search strings for the scraper');
  for (const [i, m] of (d.mograph || []).entries()) {
    const w = 'mograph[' + i + ']';
    oneOf(m.template, ['title', 'endtag', 'captions'], w + '.template');
    num(m.start, 0, 36000, w + '.start'); num(m.durationSec, 0.5, 120, w + '.durationSec');
    if (typeof m.start !== 'number' || typeof m.durationSec !== 'number') errs.push(w + ' needs start and durationSec in seconds');
    if (!m.props || typeof m.props !== 'object') errs.push(w + '.props must be the template\'s props object');
  }
}

if (kind === 'research') {
  str(data.summary, 'summary');
  if (!data.places || typeof data.places !== 'object' || !Object.keys(data.places).length) errs.push('places must name at least one new place from the context, keyed by a short lower-case name');
  const places = {};
  for (const [k, v] of Object.entries(data.places || {})) {
    places[keyOf(k)] = v;
    str(v && v.name, 'places.' + k + '.name'); str(v && v.description, 'places.' + k + '.description');
  }
  data.places = places;
  if (!Array.isArray(data.queries) || !data.queries.length) errs.push('queries must list the searches the scraper runs');
  if (!Array.isArray(data.sources) || !data.sources.length) errs.push('sources must list the pages the research read');
  checkLookFields(data);
}

if (kind === 'interrogation') {
  if (!Array.isArray(data.shots)) errs.push('shots must be an array, one entry per shot');
  const seen = new Set();
  for (const [i, s] of (data.shots || []).entries()) {
    const w = 'shots[' + i + ']' + (s && s.id ? ' (' + s.id + ')' : '');
    if (!s || !ids.includes(s.id)) { errs.push(w + ': id must be one of ' + ids.join(', ')); continue; }
    if (seen.has(s.id)) errs.push(w + ': listed twice'); seen.add(s.id);
    if (typeof s.people !== 'boolean') errs.push(w + '.people must be true or false');
    str(s.subject, w + '.subject'); str(s.setting, w + '.setting'); str(s.lighting, w + '.lighting');
    oneOf(s.camera, CAMERA, w + '.camera'); oneOf(s.screen, ['green', 'blue', 'none'], w + '.screen'); oneOf(s.treatment, ['replace', 'keep'], w + '.treatment');
    if (s.treatment === 'replace') { str(s.location, w + '.location'); if (s.people === false) notes.push(s.id + ': no people but marked replace: the cut-out keeps the main subject (a product, a car); check its mask.'); }
    if (s.treatment === 'replace' && s.camera && s.camera !== 'static') notes.push(s.id + ': camera ' + s.camera + ' - a still background will not follow it; offer motion transfer (hybrid.motionPanels) as its own credit question.');
    if (s.location) s.location = keyOf(s.location);
  }
  for (const id of ids) if (!seen.has(id)) errs.push(id + ' is not in the interrogation; every shot needs a read');
  for (const s of data.shots || []) if (s.treatment === 'replace' && s.location && placeKeys.length && !placeKeys.includes(s.location)) notes.push(s.id + ': location "' + s.location + '" is not one of the researched places (' + placeKeys.join(', ') + '); the look adds it, with references of its own.');
}

if (kind === 'look') {
  if (research) for (const f of ['summary', 'era', 'grade', 'palette', 'mograph', 'queries', 'sources']) if (data[f] === undefined && research[f] !== undefined) data[f] = research[f];
  str(data.summary, 'summary');
  if (!data.locations || typeof data.locations !== 'object' || !Object.keys(data.locations).length) errs.push('locations must name at least one place, keyed by the interrogation\'s location keys');
  const locs = {};
  for (const [k, v] of Object.entries(data.locations || {})) {
    const key = keyOf(k); locs[key] = v;
    str(v && v.name, 'locations.' + k + '.name'); str(v && v.description, 'locations.' + k + '.description');
    if (v && v.prompt !== undefined) str(v.prompt, 'locations.' + k + '.prompt');
  }
  data.locations = locs;
  checkLookFields(data);
  const inter = J.read('interrogation.json', null);
  if (inter) for (const s of inter.shots) if (s.treatment === 'replace' && !locs[s.location]) errs.push('location "' + s.location + '" (' + s.id + ') from the interrogation is missing');
}

if (kind === 'review') {
  if (!Array.isArray(data.shots)) errs.push('shots must be an array');
  for (const [i, s] of (data.shots || []).entries()) {
    const w = 'shots[' + i + ']';
    if (!s || !ids.includes(s.id)) { errs.push(w + ': id must be one of ' + ids.join(', ')); continue; }
    oneOf(s.verdict, ['pass', 'fail'], w + '.verdict');
    if (s.verdict === 'fail' && (!Array.isArray(s.issues) || !s.issues.length)) errs.push(w + ': a fail names its issues');
  }
  if (data.final) { oneOf(data.final.verdict, ['pass', 'fail'], 'final.verdict'); }
}

if (errs.length) { console.error(kind + ' NOT recorded, ' + errs.length + ' problem(s):\n  ' + errs.join('\n  ')); process.exit(1); }
if (kind !== 'research') data.shotsSha = L.sha256Text(JSON.stringify(shots.shots.map(s => s.sha256)));
data.recordedAt = L.nowIso();
J.write(kind + '.json', data);
// The same in words, for the agent's bubble on the board (record-run.js --output-file <kind>.md).
const md = kind === 'research'
  ? ['# The research', '', data.summary, '', ...Object.values(data.places).map(p => '- **' + p.name + '**: ' + p.description), '', 'Searches for the references: ' + data.queries.join('; ') + '.', 'Read: ' + data.sources.length + ' page(s).']
  : kind === 'interrogation'
  ? ['# What the shots show', '', ...data.shots.map(s => '- **' + s.id + '** ' + s.subject + '; ' + s.setting + ', ' + s.lighting + ', camera ' + s.camera + (s.screen !== 'none' && !/screen/i.test(s.setting) ? ', ' + s.screen + ' screen' : '') + '. ' + (s.treatment === 'replace' ? 'Replace: ' + s.location + '.' : 'Keep as shot.') + (s.notes ? ' ' + s.notes : ''))]
  : kind === 'look'
    ? ['# The look', '', data.summary, '', ...Object.values(data.locations).map(l => '- **' + l.name + '**: ' + l.description), '', 'Grade: ' + (Object.entries(data.grade).map(([k, v]) => k + ' ' + (Array.isArray(v) ? v.join('/') : v)).join(', ') || 'none') + '.', (data.mograph || []).length ? 'Motion graphics: ' + data.mograph.map(m => m.template + ' at ' + m.start + ' s').join(', ') + '.' : '']
    : ['# Review', '', ...data.shots.map(s => '- **' + s.id + '** ' + (s.verdict === 'pass' ? 'passes.' : 'fails: ' + s.issues.join('; ') + '.')), data.final ? '' : null, data.final ? 'The master ' + (data.final.verdict === 'pass' ? 'passes.' : 'fails: ' + (data.final.issues || []).join('; ') + '.') : null];
fs.writeFileSync(J.file(kind + '.md'), md.filter(l => l !== null).join('\n').trim() + '\n');
const summary = kind === 'research'
  ? Object.keys(data.places).length + ' place(s): ' + Object.keys(data.places).join(', ') + '; ' + data.queries.length + ' search(es) for the scraper; ' + data.sources.length + ' source(s)'
  : kind === 'interrogation'
  ? data.shots.filter(s => s.treatment === 'replace').length + ' shot(s) to replace, ' + data.shots.filter(s => s.treatment === 'keep').length + ' kept as they are; locations: ' + [...new Set(data.shots.filter(s => s.location).map(s => s.location))].join(', ')
  : kind === 'look' ? Object.keys(data.locations).length + ' location(s), grade ' + (Object.keys(data.grade).length ? 'set' : 'none') + ', ' + (data.mograph || []).length + ' mograph request(s)'
  : data.shots.filter(s => s.verdict === 'fail').length + ' shot(s) failed' + (data.final ? '; final ' + data.final.verdict : '');
console.log(kind + '.json recorded: ' + summary);
for (const n of notes) console.log('NOTE ' + n);
