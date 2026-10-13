---
name: prod-lite
description: >
  Entry point for Prod-Lite: a first cut, a brief and context ("the street becomes a 1920s
  shophouse row", "a pine forest at dawn") become a finished master: people kept as shot, new
  backgrounds behind them, a colour grade, motion graphics, rendered at the cut's exact length with
  its own sound. Use when the user types /prod-lite, asks to start, resume or check a hybrid
  finish job, or says "new backgrounds for this cut", "finish this first cut", "change the
  location of this edit".
---

# Prod-Lite

Five agents and an orchestrator take a first cut to a master:

| Agent | Does |
|---|---|
| researcher | first, from the brief: what each new place really looks like, grade, titles, searches; after the cut is read, a prompt per location matched to the shots |
| scraper | reference pictures for each place, with source and licence |
| cataloguer | splits the cut into shots, indexes them, contact sheet |
| interrogator | looks at the frames: who, where, light, camera; later checks the results |
| renderer | cut-outs, composites, grade, motion graphics, the master |
| lite-orchestrator | runs the stages, the board, and is the only one that spends |

## Start

1. **Machine.** `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/check-deps.js"`. Anything required missing: show `check-deps.js --setup` and stop. Motion graphics need a one-time `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/mograph-setup.js"` (network, a few minutes): offer it only when the brief asks for titles.
2. **Root.** The current folder is the workspace root (it will hold `workspaces/`). Never the folder the footage sits in.
3. **Board.** `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/set-board.js" --show`. No board: offer the `board-setup` skill (one private claude.ai page per account). Without one, decisions are asked in chat.
4. **Resume or new.** Existing jobs are under `workspaces/*/jobs/`; `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/state.js" {client} {job-id} show` says where one stands. To resume, land the board first (the orchestrator's "Landing a decision").
5. **New job.** Three inputs, asked for in one message if any is missing:
   - **first cut**: a video file on this machine, or a **project folder** that holds it (a folder on this machine or a Google Drive folder link). The folder's one video is the cut (several: the one named first cut, rough cut or edit, else ask which); its files named brief and context stand in for the next two; everything else in it lands in the job's `inputs/`;
   - **brief**: a file or a few lines (what the film is for, length, deliverables, titles wanted);
   - **context**: the new world, per scene if it differs ("street shots: 1920s Singapore shophouse row at golden hour; interior: a 1920s kopitiam").
   Nuke scripts wanted: `--deliver nuke`. Pick a client and a job id (`job-<slug>`), then hand over.
6. **A Drive link.** `new-job.js --folder <link>` exits 4 and names a local folder under `incoming/`. Download the Drive folder into it with the Google Drive connector (`ToolSearch` `select:mcp__claude_ai_Google_Drive__search_files`): `search_files` with `parentId` the folder id, again for each sub-folder; `download_file_content` per file, its base64 saved to a temp file, then `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/drive-stage.js" <that folder> --rel "<Sub-folder/name>" --b64 <temp file>`. Google Docs: `exportMimeType` `text/plain`, saved as `.txt`. Then run new-job.js again with `--folder <that folder> --folder-source <link>`. Never search Drive by name. No connector, or a large video: ask for the path of a synced copy instead.

## Hand over

Spawn the **lite-orchestrator** with the workspace root, client, job id and the three inputs (or the job to resume). It runs the eleven steps in `agents/lite-orchestrator.md`, shows every one on the board as that agent's card and chat, and stops for a person:

- every step is approved (or sent back with a change) on its card;
- **Gate A, Look sign-off**: which shots change and how the new world looks, before anything is spent;
- the credit question for the backgrounds (1 credit each) in Needs you, and a second one for any motion transfer;
- **Gate B, Master sign-off**: the rendered master.

When the orchestrator stops for a person, end the turn. The person answers on the board (it wakes this session) or in chat.

## Where things land

`workspaces/{client}/jobs/{job-id}/`: `research.json`, `references.json`, `shots.json`, `interrogation.json`, `look.json`, `references.json`, `hybrid-brief.json`, `grade.json`, `mograph.json`, `render.json`, `review.json`; the master in `deliver/`.
