---
name: lite-hybrid-motion
description: >-
  Shots whose camera moves: motion transfer generated on 3echo AgentC. The plate is the video reference, the location's background the image reference, and the video model keeps the shot and replaces the surroundings; composite.py then lays the plate's own actor back on top. Every credit approved on the board first. Orchestrator only, during the hybrid stage, after cut-outs and before composite.
metadata:
  version: 0.1.0
user-invocable: false
---

# Skill: Hybrid motion transfer

A still background cannot follow a moving camera. Motion transfer asks the video model for the shot again, same camera move, in the new place. It redraws the person too, and on real talent that drifts (face retextured, label text garbled; tested 2026-09-28), so its clip is only a camera-tracked, relit background: the person in the cut stays the plate's own pixels.

## Inputs

- `job.json`: `hybrid.motionPanels` (`["S03"]`, the shots the interrogator saw move, proposed with `motion-transfer.js include S03 --by orchestrator --at <now>` so they can be quoted; the person decides), `hybrid.motion` (`resolution` "720p", `keepActor` true, `maxSec` 15).
- `hybrid-brief.json` with cut-outs and each motion shot's background landed.
- AgentC: `upload_asset`, `estimate_video_job`, `create_video_job`, `wait_for_job`, `get_job_result`.

## Steps

1. **Brief.** `motion-transfer.js {client} {job-id} brief`. Per shot: the reference clip `footage/motion/ref/{shot}.mp4` (the plate from its start, at most 15 s, at most 720 px, silent), the prompt ([Video 1] the shot, keep the person, timing and camera move; [Image 1] the place and its light), the duration (4 to 15 s), ratio, resolution, `generateAudio` false and an idempotency key bound to the reference.
2. **Upload and quote.** Per shot: `upload_asset` the `refVideo` and the `backgroundFile`; `motion-transfer.js asset {shot} --video-id V --image-id I`. `estimate_video_job` with the prompt, ratio, resolution, duration, `generateAudio` false and `assetIds` [V, I] (video first, so the prompt's [Video 1] and [Image 1] line up); `motion-transfer.js quote {shot} --credits N`. A video reference adds about 20 credits (10 s at 720p was 57).
3. **Ask: the second spend question.** Motion transfer needs the shot's background landed first, so it is asked after the backgrounds: `board-sync.js ask {client} {job-id} --item hybrid --text "Motion transfer for S03 (camera move): M credits. The background follows the camera; the person is pasted back from the shot." --options "Approve M credits|Decline"`; say it in chat; push; end the turn. Declined: the shot keeps its still background and is named at Gate B.
4. **Land the yes.** On the board's comment, `board-sync.js land`; `motion-transfer.js approve motion --by {answeredBy} --at {answeredAt} --credits M [--panels ...]`. The yes is bound to each shot's reference clip and background: a changed plate or background needs a new one.
5. **Generate.** Per shot in cut order: `create_video_job` with the quoted arguments and the idempotency key; `wait_for_job`; `get_job_result`; `motion-transfer.js land {shot} --url {media url} --job-ref {id} --credits N` in the same turn.
6. **Composite.** `python composite.py {client} {job-id}`: the clip is the background (no brightness nudge), the cut-out goes back on top. It reports `actor kept` (97% or more) and `model drift` (`regenActorPct`, 75% or more); low drift means the model moved the person and a ghost can show round the pasted actor. The before/after goes on the shot's card; a flagged shot is named at Gate B.

## Rules

- Never `keepActor: false` unless the creative director asks on the board; such a shot is then `needs-review`.
- One clip per shot, one approval for the set, never above the approved credits.
- The generated clip is an input, like a background: only `footage/composite/` goes on to the grade.
- Output is 24 fps; composite retimes it to the plate's rate and length.

## Failure modes

| Failure | Fix |
|---|---|
| Model drift under 75% | Before/after on the board; retry with a tighter `promptOverride` only after a new yes |
| Plate longer than 15 s | Only the first 15 s are transferred; run catalogue.py with an extra cut point (`--cuts`) |
| Real-face filter refuses the video | Report verbatim; the shot falls back to a still background (`motion-transfer.js include none` or without it) |
| Media url expired before landing | `get_job_result` again in the same turn; never re-generate |
