---
name: lite-nuke-handoff
description: >-
  The compositor hand-off for a Prod-Lite job: a Nuke script per replaced shot (nuke.js), either as a deliverable beside the master (the project's Deliver choice) or as Gate B's "Send to compositor", where the master waits for the shots to come back. Orchestrator only.
metadata:
  version: 0.1.0
user-invocable: false
---

# Skill: Nuke hand-off

**Purpose:** the pipeline's composite is good; a compositor's is better at hair, fingers, contact
shadows and light. Each shot goes to Nuke as a script that rebuilds the composite the master uses,
node for node, so the artist starts from the master and fixes only what the reviewer noted.
`S` is `${CLAUDE_PLUGIN_ROOT}/lite/scripts`.

## What a hand-off is

`handoff/nuke-v<n>/` in the job folder: a folder per shot with `<shot>.nk`, `plate.mp4`,
`background.png`, `ref_pipeline_comp.mp4` (the composite the master uses now) and an empty
`render/`; `README.md` lists the reviewer's notes per shot, and each script carries them on a
sticky note. Paths inside the scripts are relative, so the folder is copied as it is. The grade
and the titles are not in the script: render.py puts them back on the returned shots.

## Two ways in

1. **Deliverable** (`job.json` `deliver.nuke`, from the project's Deliver choice or
   `new-job.js --deliver nuke`): after the review is recorded, `node S/nuke.js {client} {job-id} export`,
   push, and name the folder in the Gate B message. Nothing waits.
2. **Send to compositor** (Gate B's third answer on the board): land shows
   `compositor <id> requested by <who>`. Then `node S/nuke.js {client} {job-id} export --wait --by <who>`
   (it answers the request), push, and say in chat where the folder is and which shots are in it.
   Gate B stays shut on the board ("With the compositor") until every shot is back.

## The way back

The person drops the rendered shots in (a PNG sequence in the shot's `render/`, or a .mov) and
says so, in chat or on the board. Per shot:
`node S/nuke.js {client} {job-id} return --shot S01 --file <shot folder>/render` (exit 3: the render's
size or frame count is off; say so and wait). When the last shot of the round is back, the
renderer runs `grade.py` and `render.py` again, the interrogator reviews the new master, record
both as the next versions, attach the new preview (set-preview.js), push, and say "Gate B, the
master, is ready to sign off" again. `node S/nuke.js {client} {job-id} status` lists every round.

## Never

1. Send a hand-off nobody asked for: only the Deliver choice or the Gate B answer starts one.
2. Change a returned shot: it is the artist's; a fault goes back to them in chat.
3. Copy the folder anywhere but the job; the person moves it to the compositor.
