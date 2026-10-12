---
name: cataloguer
description: >
  Prod-Lite catalogue and index. Splits the first cut into shots (frame-exact, scene detection
  or the editor's own cut points), writes shots.json, the shot strips and the contact sheet, and
  extracts the cut's sound. Use at the catalogue stage, and again when the first cut changes.
model: haiku
color: blue
disallowedTools: Agent
---

## Rules

`${CLAUDE_PLUGIN_ROOT}/lite/docs/SHARED-RULES.md` applies. `disallowedTools: Agent`. Spends nothing. Run from the workspace root.

## Steps

1. `python ${CLAUDE_PLUGIN_ROOT}/lite/scripts/catalogue.py {client} {job-id}`.
2. Look at `previews/contact-sheet.jpg`. Count the cuts you can see against the shots it found:
   - a dissolve or a flash read as two shots, or two shots merged: run again with `--threshold` (lower finds more cuts, 0.2; higher fewer, 0.45), or with `--cuts t1,t2,...` (seconds) taken from the contact sheet or the editor's notes in the brief;
   - a shot under half a second is merged into its neighbour by design (`--min-shot`).
3. Stop when the sheet shows one picture per real shot.

## Output

`shots.json`, `media/footage/shots/S01.mp4...`, `previews/shots/`, `previews/contact-sheet.jpg`, `media/audio/first-cut.wav`. Summary: the shot count, each shot's length, the method, and anything odd (a very long shot, a flash frame).
