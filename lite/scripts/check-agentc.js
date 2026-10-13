#!/usr/bin/env node
// Verify .mcp.json declares the 3echo AgentC server that generates the backgrounds.
// Claude Code makes the actual connection (and asks the person to sign in through /mcp);
// this script only guards against a missing or mis-edited .mcp.json.
const fs = require('fs');
const path = require('path');

// The plugin root: this file is lite/scripts/check-agentc.js.
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
const EXPECTED_URL = 'https://agentc.3echo.ai/api/mcp';
const EXPECTED_KEY = 'agentc';
const TAG = '[dandelion-prod]';

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.mcp.json'), 'utf8'));
} catch (e) {
  console.error(`${TAG} .mcp.json missing or unreadable, so backgrounds cannot be generated: ${e.message}`);
  process.exit(2);
}

const server = cfg.mcpServers && cfg.mcpServers[EXPECTED_KEY];
if (!server) {
  console.error(`${TAG} .mcp.json has no "${EXPECTED_KEY}" server, so backgrounds cannot be generated`);
  process.exit(2);
}
if (server.url !== EXPECTED_URL) {
  console.error(`${TAG} the AgentC server points at "${server.url}", expected "${EXPECTED_URL}"`);
  process.exit(2);
}

console.log(`${TAG} AgentC configured (${EXPECTED_URL}). If it is not signed in, run /mcp and pick plugin:dandelion-prod:agentc.`);
process.exit(0);
