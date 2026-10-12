// Where the work lives. One resolver, used by every script.
//
// Resolution order, first hit wins:
//   1. --root <dir> on the command line
//   2. PROD_LITE_ROOT in the environment
//   3. "root" in .creative-studio-post/config.json, from the nearest ancestor of cwd
//   4. the current directory
//
// A root holds workspaces/ (one folder per client). Pointing a root straight at a workspaces/
// directory also works, because people will do that. The shoot folder (the one that holds
// footage/) is client material and is never a root.
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = '.prod-lite';
const CONFIG_FILE = 'config.json';

function readConfigFrom(dir) {
  try {
    const p = path.join(dir, CONFIG_DIR, CONFIG_FILE);
    if (fs.existsSync(p)) return { config: JSON.parse(fs.readFileSync(p, 'utf8')), at: p };
  } catch { /* a malformed config must not stop a run */ }
  return null;
}

function findConfig(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const hit = readConfigFrom(dir);
    if (hit) return hit;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function rootWithSource(argv = process.argv) {
  const i = argv.indexOf('--root');
  if (i >= 0 && argv[i + 1]) return { path: path.resolve(argv[i + 1]), source: '--root' };
  if (process.env.PROD_LITE_ROOT) {
    return { path: path.resolve(process.env.PROD_LITE_ROOT), source: 'PROD_LITE_ROOT' };
  }
  const found = findConfig();
  if (found && found.config && found.config.root) {
    return { path: path.resolve(path.dirname(path.dirname(found.at)), found.config.root), source: found.at };
  }
  return { path: process.cwd(), source: 'current folder' };
}

const root = (argv) => rootWithSource(argv).path;

function clientsDir(argv) {
  const r = root(argv);
  const nested = path.join(r, 'workspaces');
  if (fs.existsSync(nested)) return nested;
  if (path.basename(r) === 'workspaces') return r;
  return nested;
}

const wsDir = (client, argv) => path.join(clientsDir(argv), client);
const jobsDir = (client, argv) => path.join(wsDir(client, argv), 'jobs');
const jobDir = (client, jobId, argv) => path.join(jobsDir(client, argv), jobId);

function listClients(argv) {
  const b = clientsDir(argv);
  try {
    return fs.readdirSync(b)
      .filter(n => !n.startsWith('.') && fs.existsSync(path.join(b, n, 'workspace.json')))
      .sort();
  } catch { return []; }
}

function listJobs(client, argv) {
  try { return fs.readdirSync(jobsDir(client, argv)).filter(j => j.startsWith('job-')).sort(); }
  catch { return []; }
}

// Flags that take a value. A flag missing from this list makes its value look like a
// positional, which is how a title once turned into part of a file path.
const VALUE_FLAGS = ['--root', '--also', '--out', '--config', '--job', '--client', '--by', '--comment', '--note',
  '--notes-file', '--next', '--blocked', '--item', '--n', '--seat', '--gate', '--file', '--preview',
  '--status', '--prompt-file', '--output-file', '--trace-file', '--model', '--turns', '--tokens',
  '--skills', '--started', '--decided-at', '--channel', '--title', '--activity', '--substep',
  '--agents', '--text', '--options', '--blocks', '--credits', '--quote', '--timeout', '--caption',
  // Prod-Lite's own
  '--as', '--agent', '--cut', '--brief', '--context', '--ratio', '--background-per', '--url', '--tag', '--page', '--license',
  '--threshold', '--min-shot', '--cuts', '--start', '--keys', '--job-ref', '--from', '--video-url', '--asset-id', '--strip', '--poster',
  '--set', '--panels', '--video-id', '--image-id', '--at'];

function positionals(args) {
  const out = [];
  for (let i = 0; i < (args || []).length; i++) {
    const a = String(args[i]);
    if (a.startsWith('--')) { if (VALUE_FLAGS.includes(a)) i++; continue; }
    out.push(a);
  }
  return out;
}

// Accept "<client> <job-id>" or a path to job.json, route.json or the job folder.
function resolveJobArgs(args, argv) {
  const positional = positionals(args);
  const first = positional[0];
  if (first && (/[\\/]/.test(first) || /\.json$/i.test(first))) {
    let p = path.resolve(first);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) p = path.dirname(p);
    const jobId = path.basename(p);
    const client = path.basename(path.dirname(path.dirname(p)));
    return { client, brand: client, jobId, dir: p, rest: positional.slice(1) };
  }
  const [client, jobId, ...rest] = positional;
  return { client, brand: client, jobId, dir: client && jobId ? jobDir(client, jobId, argv) : null, rest };
}

function workspaceConfig(client, argv) {
  try { return JSON.parse(fs.readFileSync(path.join(wsDir(client, argv), 'workspace.json'), 'utf8')); }
  catch { return {}; }
}

// Stamps carry the workspace's own zone, so a record says when the person decided.
function now(client, argv, date = new Date()) {
  const tz = (workspaceConfig(client, argv) || {}).timezone;
  const pad = n => String(n).padStart(2, '0');
  if (!tz) {
    const off = -date.getTimezoneOffset(), s = off < 0 ? '-' : '+';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes()) + ' ' +
      s + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  }
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'longOffset',
    });
    const parts = Object.fromEntries(f.formatToParts(date).map(p => [p.type, p.value]));
    const offset = (parts.timeZoneName || '').replace(/^GMT/, '') || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${offset}`;
  } catch {
    return now(null, argv, date);
  }
}

const fwd = p => String(p).split(path.sep).join('/');

// The shoot folder holds footage/ (and audio/, proxies/). It is read-only client material;
// nothing of the pipeline's belongs in it, and a session started inside it would otherwise
// write workspaces/ beside the camera masters.
const SHOOT_MARKS = ['footage', 'proxies'];
function shootMarks(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && SHOOT_MARKS.includes(e.name.toLowerCase()))
      .map(e => e.name).sort();
  } catch { return []; }
}
function refuseShootRoot(argv) {
  const { path: r, source } = rootWithSource(argv);
  const marks = shootMarks(r);
  if (!marks.length) return null;
  return 'REFUSED: the workspace root ' + fwd(r) + ' (set by ' + source + ') is the shoot folder: it holds ' +
    marks.join(', ') + '. The pipeline never writes beside the footage. Choose a root that is not the shoot folder: ' +
    'set-root.js <folder> from outside it, --root <folder>, or PROD_LITE_ROOT. Nothing was created.';
}

// A sibling studio/social plugin's ownership marker in the same folder tree. When one of these
// config.json files is found on the way up from cwd before our own, this folder is theirs: our
// hooks yield rather than writing .board or warning about an unpushed outbox in somebody else's
// project. The mirror of social-pipeline's siblingStudioRoot guard: every studio plugin steps
// aside in a folder another one owns. Our own config always wins.
const SIBLING_MARKERS = ['.social-pipeline', '.creative-studio-pipeline', '.creative-studio-post'];
function foreignOwner(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_DIR, CONFIG_FILE))) return null; // ours wins
    for (const marker of SIBLING_MARKERS) {
      try { if (fs.existsSync(path.join(dir, marker, CONFIG_FILE))) return marker; } catch { /* unreadable is not owned */ }
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

module.exports = {
  shootMarks, refuseShootRoot, foreignOwner, SIBLING_MARKERS,
  root, rootWithSource, clientsDir, brandsDir: clientsDir, wsDir, jobsDir, jobDir, listClients, listBrands: listClients,
  listJobs, positionals, resolveJobArgs, workspaceConfig, now, fwd,
  CONFIG_DIR, CONFIG_FILE, findConfig,
};