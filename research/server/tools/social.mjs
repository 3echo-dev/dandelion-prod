/**
 * Social and web research tools.
 *
 * Thin handlers over server/social/: the router picks the best healthy backend for
 * each platform and operation, and every read answers with the research envelope
 * from docs/CONTRACTS.md section 1a. When a platform cannot be read without a login,
 * the envelope says so with coverage "none" or "partial", a degraded_reason, and a
 * web_evidence_plan for Claude to run with WebSearch and WebFetch, whose findings
 * come back through research_evidence_save.
 *
 * Read only: no login, no cookies, no paid scraper. yt-dlp is the only external
 * binary, and its absence lowers coverage rather than failing a call.
 */

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { getSocialRouter } from '../social/router.mjs';

const PLATFORMS = ['tiktok', 'instagram', 'facebook'];

/**
 * The shared router. Production Studio keeps no research database: every read is live,
 * and what a run relies on is written into the job's own files by the agent.
 */
function routerFor() {
  return getSocialRouter();
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function integerIn(value, name, min, max, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidInputError(`${name} is a whole number from ${min} to ${max}.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
function oneOf(value, allowed, name, fallback) {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw new InvalidInputError(`${name} is one of ${allowed.join(', ')}.`);
  return value;
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const socialTools = [
  defineTool({
    name: 'social_profile_get',
    description:
      'Read a public TikTok, Instagram or Facebook account: profile facts plus its most recent posts. ' +
      'Says honestly how much it could read, and when it could not, returns a plan for finding the same evidence on the web.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        handle_or_url: { type: 'string', description: 'A handle like @brand or the profile address.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many recent posts to include. Default 12.' },
      },
      required: ['platform', 'handle_or_url'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).profile({
        platform: oneOf(args.platform, PLATFORMS, 'platform'),
        handle_or_url: String(args.handle_or_url),
        limit: integerIn(args.limit, 'limit', 1, 50, 12),
      }),
  }),
  defineTool({
    name: 'social_post_get',
    description:
      'Read one public post or reel from its address: caption, author, date, engagement counts and media details.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The post address.' } },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, context) => routerFor(context).post({ url: String(args.url) }),
  }),
  defineTool({
    name: 'social_comments_get',
    description: 'Read the public comments on one post, most engaged first, for audience and objection research.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post address.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, context) => routerFor(context).comments({ url: String(args.url), limit: integerIn(args.limit, 'limit', 1, 500, 100) }),
  }),
  defineTool({
    name: 'social_search',
    description: 'Find public posts or accounts on one platform that match a topic, hashtag or phrase.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        query: { type: 'string', description: 'A topic, #hashtag or phrase.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20.' },
      },
      required: ['platform', 'query'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).search({
        platform: oneOf(args.platform, PLATFORMS, 'platform'),
        query: String(args.query),
        limit: integerIn(args.limit, 'limit', 1, 50, 20),
      }),
  }),
  defineTool({
    name: 'social_outliers_find',
    description:
      'Find the posts on a public account that did far better than that account usually does, measured against its own recent baseline.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: PLATFORMS },
        handle_or_url: { type: 'string' },
        window: {
          type: 'string',
          enum: ['30d', '90d', '180d', 'all'],
          description: 'How far back the baseline reaches. Default 90d.',
        },
      },
      required: ['platform', 'handle_or_url'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).outliers({
        platform: oneOf(args.platform, PLATFORMS, 'platform'),
        handle_or_url: String(args.handle_or_url),
        window: /** @type {any} */ (oneOf(args.window, ['30d', '90d', '180d', 'all'], 'window', '90d')),
      }),
  }),
  defineTool({
    name: 'social_ad_search',
    description:
      'Look up the ads an advertiser is running, or ads matching a phrase, in the public Meta or TikTok ad libraries.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['meta', 'tiktok'] },
        advertiser_or_query: { type: 'string', description: 'An advertiser name, page address or phrase.' },
        country: { type: 'string', description: 'Two letter country code. Default is the brand market, else US.' },
      },
      required: ['platform', 'advertiser_or_query'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).adSearch({
        platform: /** @type {any} */ (oneOf(args.platform, ['meta', 'tiktok'], 'platform')),
        advertiser_or_query: String(args.advertiser_or_query),
        country: typeof args.country === 'string' ? args.country : undefined,
      }),
  }),
  defineTool({
    name: 'web_crawl',
    description:
      'Read a website page, or a few pages of the same site, as clean text with its links, for brand and landing page research.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        scope: { type: 'string', enum: ['page', 'section', 'site'], description: 'Default page.' },
        max_pages: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 5. Ignored for scope page.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, context) =>
      routerFor(context).crawl({
        url: String(args.url),
        scope: /** @type {any} */ (oneOf(args.scope, ['page', 'section', 'site'], 'scope', 'page')),
        max_pages: integerIn(args.max_pages, 'max_pages', 1, 25, 5),
      }),
  }),
  defineTool({
    name: 'social_backends_status',
    description:
      'Report which ways of reading TikTok, Instagram, Facebook, the ad libraries and the web work on this computer right now, and how complete each one is.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, context) => routerFor(context).status(),
  }),
];
