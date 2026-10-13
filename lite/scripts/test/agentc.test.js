#!/usr/bin/env node
// The plugin must bring its own AgentC server: backgrounds are generated there, and a client's
// machine has no other plugin providing it.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
assert.strictEqual(mcp.mcpServers.agentc && mcp.mcpServers.agentc.type, 'http', '.mcp.json declares agentc over http');
assert.strictEqual(mcp.mcpServers.agentc.url, 'https://agentc.3echo.ai/api/mcp');
assert.ok(mcp.mcpServers.research, 'research server still declared');

const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
const cmds = hooks.hooks.SessionStart.flatMap(h => h.hooks.map(x => x.command));
assert.ok(cmds.some(c => c.includes('lite/scripts/check-agentc.js')), 'session start runs check-agentc');

const r = spawnSync(process.execPath, [path.join(ROOT, 'lite', 'scripts', 'check-agentc.js')], {
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT }, encoding: 'utf8',
});
assert.strictEqual(r.status, 0, r.stderr);
assert.match(r.stdout, /AgentC configured/);

// A plugin root without the server is caught.
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'agentc-'));
fs.writeFileSync(path.join(tmp, '.mcp.json'), JSON.stringify({ mcpServers: { research: {} } }));
const bad = spawnSync(process.execPath, [path.join(ROOT, 'lite', 'scripts', 'check-agentc.js')], {
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: tmp }, encoding: 'utf8',
});
assert.strictEqual(bad.status, 2);
assert.match(bad.stderr, /no "agentc" server/);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('agentc: ok');
