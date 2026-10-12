#!/usr/bin/env node
// Build the shipped board page from its source, or check that the shipped page is that build.
//
//   node build-board.js            board/src/board.html -> board/board.html
//   node build-board.js --check    exit 1 when the shipped page is not the build of the source
//
// The page carries its own source as base64 in a #__src tag, so a gate sign-off can republish
// itself from a pristine copy. That made the shipped file "built", and until this script the
// source of truth lived outside the repository: nobody working from the repo could fix the
// page. Edit board/src/board.html, run this, commit both files. The test suite runs
// --check, so a hand-edit of the built page fails the build.
//
// Exit 0 ok · 1 the check failed · 3 a file is missing
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'board', 'src', 'board.html');
const OUT = path.join(__dirname, '..', 'board', 'board.html');
const OPEN = '<script type="text/plain" id="__src">';
const lf = s => String(s).replace(/\r\n/g, '\n');

function build(src) {
  return src + '\n' + OPEN + Buffer.from(src, 'utf8').toString('base64') + '</script>\n';
}
function embedded(page) {
  const at = page.lastIndexOf(OPEN);
  if (at < 0) return null;
  const end = page.indexOf('</script>', at);
  return Buffer.from(page.slice(at + OPEN.length, end).trim(), 'base64').toString('utf8');
}

module.exports = { build, embedded, lf, SRC, OUT };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (!fs.existsSync(SRC)) { console.error('No source at ' + SRC.split(path.sep).join('/')); process.exit(3); }
  const src = lf(fs.readFileSync(SRC, 'utf8'));
  const built = build(src);
  if (argv.includes('--check')) {
    const page = fs.existsSync(OUT) ? lf(fs.readFileSync(OUT, 'utf8')) : '';
    if (page !== built) {
      console.error('board/pre-production.html is not the build of board/src/pre-production.html. Run build-board.js and commit both files; never hand-edit the built page.');
      process.exit(1);
    }
    console.log('ok: the shipped board is the build of its source (' + src.length + ' bytes).');
    process.exit(0);
  }
  fs.writeFileSync(OUT, built);
  console.log('Built board/board.html from board/src (' + src.length + ' bytes of source, ' + built.length + ' built).');
}
