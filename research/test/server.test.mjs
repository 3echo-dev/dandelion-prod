#!/usr/bin/env node
// The research server starts on stdio, lists the shared tools, refuses bad input as a tool
// error (never a crash), and refuses a private address. Offline: no page on the internet is read.
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const call = fileURLToPath(new URL('./call.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [call, ...args], { encoding: 'utf8', timeout: 60_000 });

const list = run('--list');
assert.strictEqual(list.status, 0, list.stderr);
const tools = JSON.parse(list.stdout);
for (const t of ['web_crawl', 'social_search', 'social_profile_get', 'social_post_get', 'social_comments_get', 'social_outliers_find', 'social_ad_search', 'social_backends_status']) {
  assert.ok(tools.includes(t), 'lists ' + t);
}
assert.ok(!tools.includes('research_evidence_save'), 'no database-backed tool is served');
console.log('ok   the server lists the ' + tools.length + ' shared research tools');

const bad = run('web_crawl', '{"url":"https://example.com","scope":"everything"}');
assert.strictEqual(bad.status, 1, 'a bad scope is a tool error');
console.log('ok   a bad argument comes back as a tool error, not a crash');

const local = run('web_crawl', '{"url":"http://127.0.0.1:9/"}');
const answer = JSON.parse(local.stdout);
assert.ok(answer.coverage === 'none' || local.status === 1, 'a private address is never read');
console.log('ok   a private address is refused');
// The page reader keeps a page's pictures, largest first, and drops the furniture.
const { extractImages, vimeoId } = await import('../server/social/backends/web.mjs');
const html = '<meta property="og:image" content="/media/hero.jpg"><img src="/i/a.jpg" srcset="/i/a-480.jpg 480w, /i/a-1600.jpg 1600w">'
  + '<img data-src="https://cdn.example.org/b.webp"><img src="/icons/x.png"><img src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1">'
  + '<img src="data:image/gif;base64,R0lGOD"><script>var g={"full":"https:\\/\\/cdn.example.org\\/gallery\\/c.jpg"}</script>';
assert.deepStrictEqual(extractImages(html, 'https://example.org/page'), [
  'https://example.org/media/hero.jpg', 'https://example.org/i/a-1600.jpg', 'https://example.org/i/a.jpg',
  'https://cdn.example.org/b.webp', 'https://cdn.example.org/gallery/c.jpg']);
console.log('ok   a page read returns its pictures: og:image, the widest srcset, lazy and scripted ones; no icons or pixels');
assert.strictEqual(vimeoId('https://vimeo.com/1082980067'), '1082980067');
assert.strictEqual(vimeoId('https://player.vimeo.com/video/875133526?h=1'), '875133526');
assert.strictEqual(vimeoId('https://vimeo.com/channels/staffpicks/512986343'), '512986343');
assert.strictEqual(vimeoId('https://vimeo.com/search?q=skincare'), null);
console.log('ok   Vimeo video addresses are recognised for the oEmbed reader; a search page is not');
console.log('research server verification passed');
