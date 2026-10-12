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
4. **3echo AgentC.** New backgrounds are generated on AgentC (1 credit each, always asked first).
   The connector must be connected in Claude for the run to generate; say so if it is not.
5. **The board.** If `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/set-board.js" --show` says none is
   set, offer the `board-setup` skill.
6. **Report** in one short list: what was already there, what was installed, what is still
   missing and why.

## Rules

- Ask before every install; never install anything the person did not say yes to.
