# Research server

The web and social reading tools Prod-Lite's researcher and scraper use. Registered in the
plugin's `.mcp.json` as `research`, so the tools are named
`mcp__plugin_dandelion-prod_research__<tool>`.

| Tool | Reads |
|---|---|
| `web_crawl` | a page, a section (up to 25 pages) or a small site as clean text with its links, its pictures (`images`: og:image, the widest srcset, lazy-loaded and scripted gallery addresses; no icons or tracking pixels) and its preview tags (`meta`); robots.txt honoured, a gap between requests to one host, private addresses refused; a page drawn by JavaScript is retried in a real browser. A Vimeo video address is read through Vimeo's public oEmbed (title, maker, length, upload date, poster), which needs no login |
| `social_search`, `social_profile_get`, `social_post_get`, `social_comments_get` | public TikTok, Instagram and Facebook, through yt-dlp, the public embeds and the public pages. A single post or video address reads best (a Facebook video gives its views, date and length); later readers only fill what earlier ones left empty |
| `social_outliers_find` | the posts that did best on one account |
| `social_ad_search` | the Meta Ad Library and TikTok's ad pages |
| `social_backends_status` | what this machine can read today, per platform |

Every answer says how much it read (`coverage`: full, partial, none), which reader answered
(`backend`), what was tried (`attempts`), and, when nothing could be read, a
`web_evidence_plan` for the agent to run once with WebSearch and WebFetch.

The engine is the social-campaign plugin's (`server/social/`, MIT, 3echo; `LICENSE` here),
vendored without its workspace database: reads are live, and the agent writes what it relied
on into the job's files.

## What no reader here gets past

Instagram posts and the Meta Ad Library (outside the EU and UK) show a signed-out reader a
login wall or a bot check. Measured 2026-10-12 on a benchmark run: TikTok posts read in full
(7 of 7 numbers matched an independent yt-dlp check), Facebook videos and Vimeo films read
through yt-dlp and oEmbed, Instagram and the Ad Library not at all. Those two need a person in
a browser, or a signed-in browser session the agent drives.

## The browser helper (optional)

Pages that need JavaScript are read by `python/social_fetch.py` (crawl4ai + Playwright
Chromium). The server uses the first of: `PRODUCTION_RESEARCH_PYTHON`, a venv at
`~/.dandelion-prod/research-helper/venv`, `~/.production-studio/research-helper/venv`, the social plugin's venv at
`~/.social-campaign/research-helper/venv`. Playwright's browser must be downloaded once in that
venv: `<venv python> -m playwright install chromium`. Without it, those pages come back with
lower coverage, never as a failure.

## Tests

```
node research/test/server.test.mjs
node research/test/call.mjs web_crawl '{"url":"https://en.wikipedia.org/wiki/Shophouse"}'
```
