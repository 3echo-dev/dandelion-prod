#!/usr/bin/env node
// Call one research tool through the real server over stdio, the way Claude Code does.
//
//   node research/test/call.mjs <tool> '<json arguments>'
//   node research/test/call.mjs --list
//
// Prints the tool's structured result as JSON. Exit 0 ok · 1 the tool reported an error · 2 usage.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [tool, rawArgs] = process.argv.slice(2);
if (!tool) { console.error("usage: call.mjs <tool> '<json arguments>' | --list"); process.exit(2); }
const server = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const child = spawn(process.execPath, ['--no-warnings', server], { stdio: ['pipe', 'pipe', 'inherit'] });

const send = m => child.stdin.write(JSON.stringify(m) + '\n');
let buf = '';
child.stdout.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      if (tool === '--list') send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      else send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: JSON.parse(rawArgs || '{}') } });
    } else if (m.id === 2) {
      const r = m.result || {};
      const out = tool === '--list' ? r.tools.map(t => t.name) : (r.structuredContent ?? r.content ?? m.error);
      console.log(JSON.stringify(out, null, 2));
      child.stdin.end();
      process.exitCode = r.isError || m.error ? 1 : 0;
    }
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'call.mjs', version: '1' } } });
