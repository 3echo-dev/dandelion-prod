#!/usr/bin/env node
/**
 * The Dandelion Prod research server: the web and social reading tools every research seat
 * shares (pre-production's reference scout, Prod-Lite's researcher and scraper).
 *
 * The engine is the social-campaign plugin's (server/social/, MIT, 3echo), vendored as is: a
 * polite same-site crawler (robots.txt, a gap between requests to one host, private addresses
 * refused), public TikTok, Instagram and Facebook readers, the Meta and TikTok ad libraries, and
 * an optional real browser (crawl4ai + Playwright) for pages that need JavaScript. What it does
 * not bring is the social plugin's workspace database: every read here is live, and the agent
 * writes what it relied on into the job's own files.
 *
 * The browser helper is optional. It is found at PRODUCTION_RESEARCH_PYTHON, else a venv at
 * ~/.dandelion-prod/research-helper/venv, else ~/.production-studio/research-helper/venv, else the social plugin's own install at
 * ~/.social-campaign/research-helper/venv (one machine install serves both plugins). Without it
 * a page that needs JavaScript is reported with lower coverage, never as a failure.
 *
 * stdout is the protocol. Every diagnostic goes to stderr.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { StdioTransport } from './mcp/transport.mjs';
import { ToolRegistry } from './mcp/registry.mjs';
import { log } from './lib/log.mjs';
import { getSocialRouter } from './social/router.mjs';
import { BrowserBackend } from './social/backends/browser.mjs';
import { RESEARCH_HELPER_RECORD_VERSION, researchHelperWorkerSha256 } from './setup/research-helper-record.mjs';
import { socialTools } from './tools/social.mjs';

export const SERVER_VERSION = '1.0.0';

const WORKER = fileURLToPath(new URL('../python/social_fetch.py', import.meta.url));

/** The browser helper's venv, first found wins; null when none is installed. */
export function helperEnvironment() {
  const exe = root => join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const pinned = process.env.PRODUCTION_RESEARCH_PYTHON?.trim();
  if (pinned && existsSync(pinned)) return { python: pinned, environment: join(pinned, '..', '..') };
  for (const root of [
    join(homedir(), '.dandelion-prod', 'research-helper', 'venv'),
    join(homedir(), '.production-studio', 'research-helper', 'venv'),
    join(homedir(), '.social-campaign', 'research-helper', 'venv'),
  ]) {
    if (existsSync(exe(root))) return { python: exe(root), environment: root };
  }
  return null;
}

/** The helper record the browser backend reads, built from the venv found on this machine. */
function helperRecord() {
  const env = helperEnvironment();
  if (!env) return null;
  return {
    record_version: RESEARCH_HELPER_RECORD_VERSION,
    state: 'connected',
    python: env.python,
    environment_path: env.environment,
    environment_kind: 'venv',
    worker_path: WORKER,
    worker_sha256: researchHelperWorkerSha256(WORKER),
  };
}

export function createServer() {
  // The router is shared by every call; it is built first so it holds this browser backend.
  getSocialRouter({ browser: new BrowserBackend({ state: helperRecord, allowLegacyState: false }) });
  const registry = new ToolRegistry();
  registry.registerAll(socialTools);
  log.info('production research server ready', { tools: registry.list().length, browser: Boolean(helperEnvironment()) });
  return { registry };
}

export async function main() {
  const { registry } = createServer();
  const transport = new StdioTransport({
    registry,
    context: { workspace: null },
    serverInfo: { name: 'dandelion-prod-research', version: SERVER_VERSION },
  });
  await transport.start();
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.on('uncaughtException', e => log.error('uncaught exception, server staying alive', { error: String(e?.stack ?? e) }));
  process.on('unhandledRejection', e => log.error('unhandled rejection, server staying alive', { error: String(e?.stack ?? e) }));
  process.stdout.on('error', e => { if (e?.code !== 'EPIPE') log.error('stdout error', { error: String(e) }); });
  main().catch(e => { log.error('server crashed', { error: String(e?.stack ?? e) }); process.exit(1); });
}
