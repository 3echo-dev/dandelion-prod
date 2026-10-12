// Where the 3echo Motion composer lives and where it is installed to run.
//
// The composer ships inside the plugin at vendor/3echo-motion/composer. It is installed
// (copied plus npm ci plus Remotion's headless browser) into one fixed folder in the home
// directory, never the Desktop: a synced Desktop (iCloud on macOS) stalls reads of node_modules
// and the render sits idle. The folder survives plugin updates; a stamp records which copy of
// the composer was installed, so an update that changes the composer asks for setup again.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// This pipeline's folder; the composer ships at vendor/3echo-motion beside it.
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(PLUGIN_ROOT, '..', 'vendor', '3echo-motion', 'composer');
const HOME = process.env.MOGRAPH_HOME || path.join(os.homedir(), '.dandelion-prod', 'mograph');
const COMPOSER = path.join(HOME, 'composer');
const STAMP = path.join(HOME, 'ready.json');
const CLI = path.join(COMPOSER, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

// Request template -> composition id in src/Root.tsx. The first three are transparent overlays
// (what the editor lays over the cut in Premiere); the last five are the full-frame
// renderers and bake their own background.
const TEMPLATES = {
  title: { id: 'HeroTitle', alpha: true, props: { scrimBackground: 'transparent' } },
  endtag: { id: 'EndTagOverlay', alpha: true, props: { overlay: true } },
  captions: { id: 'CaptionOverlayOnly', alpha: true, props: {} },
  cinematic: { id: 'CinematicRenderer', alpha: false },
  explainer: { id: 'Explainer', alpha: false },
  talkinghead: { id: 'TalkingHead', alpha: false },
  collageburst: { id: 'CollageBurst', alpha: false },
  lyricoverlay: { id: 'LyricOverlay', alpha: false },
};

function listFiles(dir, base = dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'out') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listFiles(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

function vendorHash() {
  const h = crypto.createHash('sha256');
  for (const f of listFiles(VENDOR)) {
    h.update(f + '\0');
    h.update(fs.readFileSync(path.join(VENDOR, f)));
  }
  return h.digest('hex');
}

// { ok, reason } — ok only when the installed copy matches the bundled one and its packages and
// browser are in place.
function status() {
  if (!fs.existsSync(path.join(VENDOR, 'package.json'))) return { ok: false, reason: 'the bundled composer is missing from the plugin (vendor/3echo-motion/composer)' };
  let stamp;
  try { stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return { ok: false, reason: 'mograph is not set up on this machine yet' }; }
  if (stamp.vendorHash !== vendorHash()) return { ok: false, reason: 'the plugin update changed the composer; set it up again' };
  if (!fs.existsSync(CLI)) return { ok: false, reason: 'the composer packages are not installed' };
  return { ok: true, reason: 'ready at ' + COMPOSER };
}

module.exports = { PLUGIN_ROOT, VENDOR, HOME, COMPOSER, STAMP, CLI, TEMPLATES, listFiles, vendorHash, status };
