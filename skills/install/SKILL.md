---
name: install
description: >
  Checks that this computer has what Prod-Lite needs, asks before installing anything, and checks
  again. Use when the user types /dandelion-prod:install, after a fresh plugin install, or when a
  script says a tool is missing.
---

# Skill: Install

**Purpose:** one entry point for setting the computer up.

## Steps

1. **The tools.** `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/check-deps.js"`; `--setup` prints the
   install line for anything missing (ffmpeg, Python with Pillow; rembg optional, for cut-outs
   without a green screen).
2. **Motion graphics (only when titles are wanted).** `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/mograph-setup.js"`
   installs the 3echo Motion composer to `~/.dandelion-prod/mograph` (network, a few minutes);
   `--check` says whether it is ready.
3. **The research browser (optional).** Research pages drawn by JavaScript need the browser helper
   described in `${CLAUDE_PLUGIN_ROOT}/research/README.md`. Ask before running the one-time
   `<venv python> -m playwright install chromium`; without it those pages read with lower coverage.
4. **3echo AgentC: walk the person through it; never skip it.** New backgrounds and camera moves
   are generated on AgentC (1 credit per background, always asked first). Go through the
   "AgentC sign-in" steps below, then come back here.
5. **Google Docs and Sheets copies (optional).** Look for a Google Drive tool (`create_file`, any
   prefix). Present: say "Research, references, the shot list, the look and the review will also
   go to Google Docs and Sheets, linked on the board". Absent: offer it once (claude.ai, Settings,
   Connectors, Google Drive, Connect, then restart this session); a no is fine, the board has it all.
6. **The board.** If `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/set-board.js" --show` says none is
   set, offer the `board-setup` skill.
7. **Report** in one short list: what was already there, what was installed, what is still
   missing and why.

## AgentC sign-in

AgentC can reach this session three ways, and any one is enough: a connector added in Claude's
settings (Connectors, often shown as "AgentC, Web, Custom"), another 3echo plugin, or this plugin's
own `agentc` server. The plugin's own server is the fallback for a computer that has none.

a. **Declared?** `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/check-agentc.js"`. Exit 2 means the
   plugin copy is damaged: say so, suggest reinstalling the plugin, and stop this step.
b. **Already connected?** Look at the tools this session has for any `list_workspaces` from an
   AgentC server, whatever its prefix (`mcp__claude_ai_AgentC__`, `mcp__agentc__`, `mcp__3echo__`,
   `mcp__plugin_dandelion-prod_agentc__`, ...), and call it (free, read-only). The first one that
   answers is the connection: say which one ("your AgentC connector") and go to d. Do not ask the
   person to sign in again when one already answers.
c. **None answers** (no such tool, or each asks for authentication). Tell the person, in these
   words or close to them, then end the turn and wait:
   > To generate backgrounds, Dandelion Prod needs your 3echo AgentC sign-in (once per computer).
   > 1. Type `/mcp` and press Enter.
   > 2. Pick **plugin:dandelion-prod:agentc**, then **Authenticate**.
   > 3. Sign in with your 3echo account in the browser window that opens, and approve access.
   > 4. Come back here and say "done".
   If `/mcp` does not list the server, ask them to restart Claude Code (servers load at start)
   and try again. When they say done, go back to b. After two failed tries, record it as still
   missing and go on with the other steps; never pretend it is connected.
d. **Show what they are connected to.** List every workspace with its credit balance, from
   `list_workspaces`, so the person can see it is the account the studio means to spend from. If
   a balance is 0, say backgrounds cannot be generated there until credits are added. If two
   AgentC connections answer with different accounts, say so and ask which one jobs use. Never
   spend a credit in this step.

## Rules

- Ask before every install; never install anything the person did not say yes to.
- The person signs in to AgentC themselves; never ask for, type or store a password or token.
