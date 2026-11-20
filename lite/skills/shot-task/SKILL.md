---
name: shot-task
description: >
  One clip or one still, one ask, no first cut and no gates. Use when the user gives a single
  picture or clip and says "relight this", "change the background", "mask the pack", "make a
  matte", "use my mask", "remove the people", "clean plate", "variants of this", "animate between
  these frames", or generates anything on AgentC outside a Prod-Lite job. A first cut to finish
  end to end is the prod-lite skill instead.
---

# Shot task

`T` is `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/task.js" {client} {task-id}`, run from the
workspace root (never the footage folder). This session does the work and is the one that spends;
it spawns nobody.

## Start

1. `T new --title "<what the person calls it>"`, the id `task-<slug>`. One task per shot or pack;
   later asks about it go in the same task (`T status`).
2. `T add --file <path>` for everything the person gave (clip, still, matte, clean plate). Copies;
   the originals are never touched.
3. `${CLAUDE_PLUGIN_ROOT}/lite/docs/SHARED-RULES.md` applies.

## What the tools cannot do. Say it before quoting.

| Fact | So |
|---|---|
| The image model takes a prompt and reference pictures. **It has no mask input.** | A matte sent to it is a request; it redraws what it was asked to keep. `T do paste-back` makes the matte hold. |
| The video model makes **4 to 15 whole seconds**. | A 2 second ask is generated at 4 and cut back: `T do clip --for-model` gives the extract and the trim. `T quote` refuses a length it cannot make. |
| The video model has **no first-frame or last-frame input**. | "Start on [Image 1], end on [Image 2]" is a request. Check what came back (`T check --b-at first`, `--b-at last`). |
| **A video reference costs about three times** a clip without one (4 s at 480p: about 7 against 20) and is what holds the subject and camera move. | Quote both ways, show both prices with what each keeps. |
| AI segmentation picks the main subject of each frame; it cannot be told which object. | A wrong matte is said, never passed: ask for a matte or a screen. |

## The spend, every time

Quote, ask, yes, generate, land, in that order; generate in the turn the yes arrived.

```bash
T quote --take orbit --label no-ref --kind video --credits 7 --seconds 4 --resolution 480p --keeps "the look only"
T quote --take orbit --label ref --kind video --credits 20 --seconds 4 --resolution 480p --video-ref --keeps "the pack and the camera move"
# ask the person in chat with both lines; end the turn
T approve --take orbit --label ref --by "<their name>"
# create_video_job (or create_image_job), wait_for_job, get_job_result, then in the same turn:
T land --take orbit --url <media url> --job-ref <job id> --credits 20
```

Video credits come from `estimate_video_job`; an image is 1, a redo another (`--count` for several). `T land`
refuses a paid landing with no yes on record, or one over what was approved. Pass an
`idempotencyKey` of `{task-id}/{take}/{n}` so a retry cannot charge twice. Never open AgentC's live
view (rule 11): `wait_for_job`, land, show the file from `takes/`.

Free, no yes needed: `T do paste-back | matte | clip | frame` and `T check`. Never hand-write ffmpeg
for something a person will use; when these cannot do it, say so.

## Recipes

Read `${CLAUDE_PLUGIN_ROOT}/lite/playbooks/shot-recipes.md` and follow the matching one before
quoting: regenerate behind a matte, clean plate, relight, new background with the camera move kept,
a matte across a clip, people out of a clip, one frame to another, a product pack and its turn. Its
order matters: a clean plate before a regenerate, a check before a paste.

## Report

After every take: the file in `takes/`, its numbers, anything flagged with its picture
(`previews/`), and `T status` for the spend so far. Never call a flagged take done.
