#!/usr/bin/env node
// Google Docs and Sheets copies of a job's records, for reading, sharing and commenting off the
// board. The board stays the record and the place every decision is made; a copy is written once
// per version and its link shows on the step's card. Only the orchestrator uploads, through the
// Google Drive connector (create_file), and only when that connector is connected.
//
//   node gdocs.js <client> <job-id> export [--item research|scraper|interrogate|look|review]
//        writes .board/gdocs/<item>-v<n>.html (a Doc) or .csv (a Sheet) for each record on disk,
//        and prints one line per file: <item> <n> <contentMimeType> <bytes> <file> <title>
//   node gdocs.js <client> <job-id> folder [--id <drive folder id>] [--url <folder url>]
//        records the job's Drive folder, or prints it (and the name to create one under)
//   node gdocs.js <client> <job-id> link --item <item> --url <https://docs.google.com/...> [--label "Google Doc"] [--n <version>]
//        records the copy's link and queues it to the step's card on the board (push next)
//
// Exit 0 ok · 2 usage · 3 nothing to export / no folder recorded
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const board = require('./lib-board.js');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const { client, jobId, dir, rest } = ws.resolveJobArgs(argv, argv);
const cmd = rest && rest[0];
const USAGE = 'usage: gdocs.js <client> <job-id> export [--item X] | folder [--id <id> --url <url>] | link --item X --url <https url> [--label "..."] [--n N]';
if (!client || !jobId || !dir || !['export', 'folder', 'link'].includes(cmd)) { console.error(USAGE); process.exit(2); }

const ITEMS = { research: 'doc', scraper: 'sheet', interrogate: 'sheet', look: 'doc', review: 'doc' };
const LABEL = { research: 'Research', scraper: 'References', interrogate: 'Shots', look: 'Look', review: 'Review' };
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const job = read('job.json') || {};
const title = job.title || jobId;
const stateFile = path.join(dir, '.board', 'gdocs.json');
const state = (() => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { links: {} }; } })();
const save = () => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n'); };

// The step's current version number, from the job's version log.
function versionOf(item) {
  let n = 0;
  try {
    for (const line of fs.readFileSync(path.join(dir, 'versions.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const v = JSON.parse(line);
      if (v.item === item && Number(v.n) > n) n = Number(v.n);
    }
  } catch {}
  return n;
}

// ---- HTML for Docs: plain tags only; Drive converts headings, lists, tables, links and cell shading ----
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a = u => /^https?:\/\//.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u);
const table = (head, rows) => `<table border="1" cellpadding="6" style="border-collapse:collapse">${head ? `<tr>${head.map(h => `<th style="text-align:left;background:#eeeeee">${esc(h)}</th>`).join('')}</tr>` : ''}${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const page = (h1, sub, body) => `<html><head><meta charset="utf-8"><title>${esc(h1)}</title></head><body style="font-family:Arial,sans-serif"><h1>${esc(h1)}</h1><p style="color:#666666">${esc(sub)}</p>${body}</body></html>`;
const sub = (item, n) => `${title} · ${LABEL[item]} v${n} · copied from the Dandelion Prod board ${new Date().toISOString().slice(0, 10)}. The board is the record; sign-offs happen there.`;

function gradeHtml(g) {
  if (!g) return '';
  const rgb = v => Array.isArray(v) ? v.map(x => (x > 0 ? '+' : '') + x).join(' / ') : esc(v);
  return '<h2>Grade</h2>' + table(['Setting', 'Value'], [
    ['Temperature', esc(g.temperature) + ' K'], ['Saturation', esc(g.saturation)], ['Contrast', esc(g.contrast)],
    ['Shadows (R / G / B)', rgb(g.shadows)], ['Highlights (R / G / B)', rgb(g.highlights)]]);
}
function paletteHtml(p) {
  if (!Array.isArray(p) || !p.length) return '';
  return '<h2>Palette</h2>' + table(null, [p.map(c => `<span style="background:${esc(c)}">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`), p.map(c => esc(c))])
    .replace(/<td>(<span style="background:(#[0-9a-fA-F]{3,8})">)/g, '<td style="background:$2">$1');
}
function mographHtml(m) {
  if (!Array.isArray(m) || !m.length) return '';
  return '<h2>Titles and motion graphics</h2>' + table(['Template', 'Starts', 'Runs', 'Text'], m.map(x => {
    const p = x.props || {};
    const text = [p.title, p.subtitle, p.text, p.line, p.small].filter(Boolean).map(esc).join('<br>');
    return [esc(x.template), esc(x.start) + ' s', esc(x.durationSec) + ' s', text];
  }));
}

const BUILD = {
  research(n) {
    const r = read('research.json'); if (!r) return null;
    const places = Object.entries(r.places || {}).map(([k, p]) => `<h3>${esc(p.name || k)}</h3><p>${esc(p.description)}</p>`).join('');
    const body = `<p><b>Summary.</b> ${esc(r.summary)}</p>${r.era ? `<p><b>Period and light.</b> ${esc(r.era)}</p>` : ''}<h2>The places</h2>${places}`
      + gradeHtml(r.grade) + paletteHtml(r.palette) + mographHtml(r.mograph)
      + (r.queries && r.queries.length ? '<h2>What the scraper searched</h2><ul>' + r.queries.map(q => `<li>${esc(q)}</li>`).join('') + '</ul>' : '')
      + (r.sources && r.sources.length ? '<h2>Sources</h2><ol>' + r.sources.map(s => `<li>${a(s)}</li>`).join('') + '</ol>' : '');
    return page(`${title}: Research`, sub('research', n), body);
  },
  look(n) {
    const l = read('look.json'); if (!l) return null;
    const locs = Object.entries(l.locations || {}).map(([k, p]) => `<h3>${esc(p.name || k)}</h3><p>${esc(p.description)}</p><p><b>Background prompt</b></p><p style="font-family:Courier New,monospace">${esc(p.prompt)}</p>`).join('');
    const shotTable = (() => {
      const it = read('interrogation.json'); if (!it || !it.shots) return '';
      return '<h2>Which shots get which place</h2>' + table(['Shot', 'Treatment', 'Place'], it.shots.map(s => [esc(s.id), esc(s.treatment), esc(s.location || '')]));
    })();
    return page(`${title}: Look`, sub('look', n), `<p>${esc(l.summary)}</p><h2>Locations</h2>${locs}${shotTable}` + gradeHtml(l.grade) + paletteHtml(l.palette) + mographHtml(l.mograph));
  },
  review(n) {
    const v = read('review.json'); if (!v) return null;
    const verdict = s => s === 'pass' ? '<b style="color:#1a7f37">PASS</b>' : `<b style="color:#c0392b">${esc(String(s || '').toUpperCase())}</b>`;
    const shots = (v.shots || []).map(s => `<h3>${esc(s.id)}: ${verdict(s.verdict)}</h3>${(s.issues || []).length ? '<ul>' + s.issues.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>' : '<p>No notes.</p>'}`).join('');
    const f = v.final || {};
    return page(`${title}: Review`, sub('review', n), `<h2>The master: ${verdict(f.verdict)}</h2>${(f.issues || []).length ? '<ul>' + f.issues.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>' : ''}<h2>Shot by shot</h2>${shots}`);
  },
};

// ---- CSV for Sheets: every field quoted; a cell starting with = is a formula Sheets runs ----
const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
const csv = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const fq = s => String(s).replace(/"/g, '""');
// Wikimedia Commons originals can be many megabytes; the sheet shows its 320 px thumbnail.
function thumbUrl(u) {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/.exec(u || '');
  if (!m) return u;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/320px-${m[3]}${/\.(tiff?|svg)$/i.test(m[3]) ? '.jpg' : ''}`;
}
const CSV = {
  scraper() {
    const r = read('references.json'); if (!r || !r.items) return null;
    return csv([['Ref', 'Place', 'Picture', 'Licence', 'Source page', 'Background', 'Note']].concat(r.items.map(x => [
      x.id, x.tag, /^https:\/\//.test(x.url || '') ? `=IMAGE("${fq(thumbUrl(x.url))}")` : '', x.license,
      /^https?:\/\//.test(x.page || '') ? `=HYPERLINK("${fq(x.page)}","${fq(x.page.replace(/^https?:\/\/(www\.)?([^/]+).*$/, '$2'))}")` : (x.page || ''),
      x.background ? 'yes' : '', x.note || ''])));
  },
  interrogate() {
    const it = read('interrogation.json'); if (!it || !it.shots) return null;
    const shots = (read('shots.json') || {}).shots || [];
    const tc = t => { const s = Number(t) || 0; return Math.floor(s / 60) + ':' + (s % 60).toFixed(2).padStart(5, '0'); };
    return csv([['Shot', 'In', 'Out', 'Length (s)', 'People', 'Subject', 'Setting', 'Light', 'Camera', 'Screen', 'Treatment', 'Place', 'Notes']].concat(it.shots.map(s => {
      const c = shots.find(x => x.id === s.id) || {};
      return [s.id, c.start != null ? tc(c.start) : '', c.end != null ? tc(c.end) : '', c.duration != null ? Number(c.duration).toFixed(2) : '',
        s.people ? 'yes' : 'no', s.subject, s.setting, s.lighting, s.camera, s.screen || '', s.treatment, s.location || '', s.notes || ''];
    })));
  },
};

if (cmd === 'export') {
  const only = opt('--item');
  if (only && !ITEMS[only]) { console.error('--item is one of ' + Object.keys(ITEMS).join(', ')); process.exit(2); }
  const out = path.join(dir, '.board', 'gdocs'); fs.mkdirSync(out, { recursive: true });
  let wrote = 0;
  for (const item of Object.keys(ITEMS)) {
    if (only && item !== only) continue;
    const n = versionOf(item) || 1;
    const sheet = ITEMS[item] === 'sheet';
    const text = sheet ? CSV[item]() : BUILD[item](n);
    if (!text) continue;
    const file = path.join(out, `${item}-v${n}.${sheet ? 'csv' : 'html'}`);
    fs.writeFileSync(file, text);
    const bytes = Buffer.byteLength(text);
    console.log([item, n, sheet ? 'text/csv' : 'text/html', bytes, file.split(path.sep).join('/'), `${title} · ${LABEL[item]} v${n}`].join('\t'));
    if (bytes > 60000) console.error(item + ' is ' + bytes + ' bytes: large for one create_file call; upload it on its own.');
    wrote++;
  }
  if (!wrote) { console.error('nothing to export yet: none of ' + (only || Object.keys(ITEMS).join(', ')) + ' is recorded.'); process.exit(3); }
  console.error('Upload each with the Google Drive connector: create_file, title as printed, textContent = the file, contentMimeType as printed, parentId = the job folder. Then: gdocs.js ' + client + ' ' + jobId + ' link --item <item> --n <n> --url <the file\'s link>.');
  process.exit(0);
}

if (cmd === 'folder') {
  const id = opt('--id');
  if (id) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) { console.error('--id is a Drive folder id'); process.exit(2); }
    state.folder = { id, url: opt('--url') || `https://drive.google.com/drive/folders/${id}`, at: new Date().toISOString() }; save();
    console.log('Drive folder recorded: ' + state.folder.url); process.exit(0);
  }
  if (state.folder) { console.log(state.folder.id + '\t' + state.folder.url); process.exit(0); }
  console.log('no folder yet; create one named "Dandelion Prod · ' + title + '" and record it with --id'); process.exit(3);
}

if (cmd === 'link') {
  const item = opt('--item'), url = opt('--url');
  if (!item || !LABEL[item] && !['render', 'catalogue', 'hybrid', 'grade', 'mograph', 'intake'].includes(item) || !url || !/^https:\/\/(docs|drive)\.google\.com\//.test(url)) {
    console.error('usage: gdocs.js <client> <job-id> link --item <item> --url <https://docs.google.com/... or https://drive.google.com/...> [--label "..."] [--n N]'); process.exit(2);
  }
  const n = Number(opt('--n')) || versionOf(item) || 1;
  const kind = /\/spreadsheets\//.test(url) ? 'Google Sheet' : /\/document\//.test(url) ? 'Google Doc' : /\/presentation\//.test(url) ? 'Google Slides' : 'Google Drive';
  const label = opt('--label') || kind;
  const list = (state.links[item] || []).filter(l => l.label !== label);
  list.push({ label, url, version: n, at: new Date().toISOString() });
  state.links[item] = list; save();
  board.appendOutbox(process.cwd(), client, jobId, { collection: 'items', docId: item, op: 'update', data: { links: list } });
  console.log(label + ' (v' + n + ') linked on ' + item + ' (queued). Push next.');
  process.exit(0);
}
