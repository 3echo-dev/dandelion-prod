# Shot recipes

For the `shot-task` skill. `T` is `node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/task.js" {client} {task-id}`. Every generation below is quoted, asked and approved first (the skill's "The spend, every time"); the `T do` and `T check` steps are free.

**Regenerate part of a still behind a matte** (the person sends a plate and a matte, white = keep).

1. If what is kept is people or a product in front, make the **clean plate first** (next recipe)
   and regenerate from that. A model that redraws the people moves them, and the pasted originals
   then sit beside a second outline. An empty plate has nobody to move.
2. `create_image_job` with the plate (or clean plate) as [Image 1], the nearest `aspectRatio`, and a
   prompt for the change. Land each variant as its own take version.
3. `T do paste-back --take <name>_kept --original <plate> --generated <take>-v01.png --alpha <matte>`.
   Look at `previews/*-edges.jpg` (original | the model's frame | result) yourself before showing
   it. A second outline: `--grow 4` to `12` hides a thin one; a thick one means step 1 was skipped.

**Clean plate: take people or objects out of a still.** `create_image_job`, the frame as [Image 1],
prompt: remove X, fill what was behind, change nothing else. Then make "change nothing else" true:
`T do matte --take people --source <frame> --model u2net_human_seg`, and
`T do paste-back --take clean --original <frame> --generated clean_gen-v01.png --alpha people-v01.png --invert --grow -16`
(everything outside the people, grown by 16 px, is the original's own pixels).

**Relight a still or a clip, nothing else changed.** Image: `create_image_job` with the frame as
[Image 1]. Clip: `create_video_job` with the clip as [Video 1] (quote both ways). Then
`T check --a <original> --b <take> --take <take>`: structure kept and how far the picture slid. A
flag means more than the light changed: show both, say what moved, offer a redo. Where a matte
exists, paste the unlit original back only if the person wants the subject untouched by the new
light; usually they want it lit.

**A new background behind a subject, camera move kept.** Clip as [Video 1], quoted both ways. After
landing: `T do matte --take subject --source <original>`, then
`T check --a <original> --b <take> --alpha subject-v01.mp4` (did the subject stay where it was). Not
flagged: `T do paste-back --original <original> --generated <take> --alpha subject-v01.mp4` puts the
subject's own pixels back. Flagged: the model moved it; show the take as it came and say the
subject is redrawn.

**A matte of the pack or a person across a clip.** `T do matte --take pack_matte --source <clip>`
(`--mov` for ProRes). A green or blue screen is keyed; otherwise AI segmentation, frame by frame.
Look at `previews/*-mid.png` and scrub the matte. Free. A matte is not generated on AgentC: a
video model's drawing of a mask does not line up with the frames it is for.

**People out of a clip.** 1. `T do clip --take ref --source <clip> --start 12 --end 14 --for-model`.
2. Clean plate of one frame of it (recipe above; `T do frame`). 3. `create_video_job`, the extract
as [Video 1] and the clean plate as [Image 1]: the same shot, same camera, the room as in [Image 1],
nobody in it. 4. `T do matte --source ref-v01.mp4 --model u2net_human_seg`, then paste-back with
`--invert --grow -24` so everything away from the people is the original clip. 5. Cut back with the
trim step 1 reported. Say plainly that a person crossing a large part of the frame leaves the model
inventing what was behind them, and it can change between frames.

**From one frame to another** (a sunset time-lapse). Both stills as references, the prompt naming
[Image 1] the first frame and [Image 2] the last. After landing, `T check --a start.png --b <take>
--b-at first` and `--a end.png --b <take> --b-at last`; report both numbers.

**A product pack from words, variants, a turn.** One image per variant (1 credit each, all quoted
together with `--count`). The person picks one; that file is the reference for every later picture
and for the turn (`create_video_job`, the pack as [Image 1]). Label text and logos drift on a
generated turn: look at four frames and say what changed.
