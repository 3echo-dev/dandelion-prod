---
name: camera-director
description: >
  Load this BEFORE writing any prompt for a generated video or image (AgentC, SeeDance, B-roll,
  product shots, backgrounds, motion transfer, frame to frame) and before answering any camera
  question ("what camera move", "dolly in", "low angle", "which lens", "make it cinematic").
  Holds the camera words that AgentC follows and the rule for Prod-Lite: describe the cut's own
  camera, never invent one.
metadata:
  version: 0.2.0
---

# Skill: Camera director

**Purpose:** a prompt that names the camera in plain, concrete film words gets that camera back.
"Cinematic" and "dynamic" get whatever the model likes. This skill is the word list and the way
to put the words in a prompt.

## Two modes. Know which one you are in.

| Mode | When | Rule |
|---|---|---|
| **Describe** | Any Prod-Lite job: background prompts, motion transfer, a relight, anything with a first cut or a plate the person shot | The camera is the cut's. Name what `interrogation.json` saw (its `camera` field) and nothing else. Never add a move, change the lens feel or "improve" the framing: the person is pasted back from the plate, and a background shot with a different camera will not sit behind them. |
| **Direct** | A shot-task with nothing to match: new B-roll, a product turn, an establishing shot, "animate between these frames" | Choose the camera. One move per shot, said once, with its speed and where it ends. |

Not sure? It is Describe.

Everything is on this page: the rules, the word list (Part 1) and how to write it into an AgentC prompt (Part 2). Nothing else to open.

## Rules the plugin already set (they win)

- `${CLAUDE_PLUGIN_ROOT}/lite/docs/SHARED-RULES.md` applies, and so does every quote, ask and
  yes in `shot-task` and `lite-hybrid-motion`. This skill writes words; it spends nothing.
- Motion transfer sends `generateAudio` false. A camera prompt never turns sound on.
- The video model makes 4 to 15 s and has no first- or last-frame input: "end on [Image 2]" is a
  request, checked afterwards with `T check`.
- Background prompts never ask for people or text (researcher rule). A camera word that implies
  a subject ("over-the-shoulder", "two-shot") does not belong in a background prompt.

## Part 1: Camera words

Write the plain phrase in the right-hand column. One word per category is enough; leave out a
category that does not matter for the shot.

### From the interrogator's `camera` field (Describe mode)

`interrogation.json` gives each shot one of these. This is the phrase that goes in the prompt.

| `camera` | Prompt phrase |
|---|---|
| static | locked-off camera on a tripod, no camera movement |
| pan | the camera pans slowly left to right (or right to left, as the strip shows), fixed position |
| tilt | the camera tilts slowly up (or down) from a fixed position |
| push | the camera pushes in slowly towards the subject |
| pull | the camera pulls back slowly from the subject |
| zoom | slow optical zoom in (or out), the camera does not move |
| tracking | the camera tracks sideways alongside the subject at walking pace |
| handheld | handheld camera, slight natural sway, no sudden shakes |
| crane | the camera rises (or lowers) smoothly on a crane |
| other | describe what the first and last frames show: where the camera starts, where it ends |

Take the direction and speed from the strip, not from habit. A background for a static shot says
"locked-off" even if a move would look nicer.

### Shot size (how much of the subject is in frame)

| Word | On screen | Write |
|---|---|---|
| Extreme wide | Place is the subject; people are small | extreme wide shot, the whole street in frame |
| Wide | Whole body with room around it | wide shot, full figure with space around |
| Full | Head to feet, filling the height | full shot, head to toe |
| Medium | Waist up | medium shot, waist up |
| Medium close-up | Chest up | medium close-up, chest up |
| Close-up | Face, or one object filling the frame | close-up on the face |
| Extreme close-up | One detail: eyes, a label, a fingertip | extreme close-up on the bottle label |
| Insert | An object detail cut into a scene | insert shot of the hand on the cap |

### Angle and height

| Word | Effect | Write |
|---|---|---|
| Eye level | Neutral, plain | camera at eye level |
| Low angle | Subject looks strong, tall | low angle, camera below the subject looking up |
| High angle | Subject looks small, exposed | high angle, camera above looking down |
| Overhead / top shot | Map-like, graphic | overhead shot, camera straight down |
| Ground level | Close to the floor, objects loom | camera at ground level |
| Dutch | Unease; use rarely | the frame is tilted about 15 degrees |
| Over-the-shoulder | Conversation, point of view | over the shoulder of the person on the left |
| Point of view | What a character sees | point-of-view shot from the driver's seat |

### Lens and focus

| Word | Effect | Write |
|---|---|---|
| Wide lens (16 to 24 mm) | Space feels deep, lines stretch at the edges | 24 mm wide lens, deep perspective |
| Normal (35 to 50 mm) | Close to how the eye sees | 35 mm lens, natural perspective |
| Long lens (85 mm and up) | Background pulled close and flattened | 85 mm long lens, compressed background |
| Macro | Tiny detail, very thin focus | macro lens, a few millimetres in focus |
| Shallow focus | Subject sharp, background soft | shallow depth of field, background softly out of focus |
| Deep focus | Near and far both sharp | deep focus, everything sharp |
| Rack focus | Focus moves from one thing to another | focus shifts from the glass in front to the face behind |
| Anamorphic | Wide frame, oval bokeh, horizontal flares | anamorphic lens look, horizontal flares |

For a background prompt, the lens feel must match the plate: a long-lens close-up wants a soft,
compressed background; a wide-lens wide shot wants depth and sharp distance.

### Movement (Direct mode)

| Word | What the camera does | Write |
|---|---|---|
| Push in / dolly in | Moves towards the subject | the camera pushes in slowly |
| Pull out / dolly out | Moves away, reveals the place | the camera pulls back to reveal the room |
| Truck | Slides sideways | the camera trucks left past the shelves |
| Pan | Turns left or right, stays put | slow pan right across the skyline |
| Tilt | Turns up or down, stays put | the camera tilts up the building |
| Pedestal / crane | Rises or lowers | the camera rises above the crowd |
| Orbit / arc | Circles the subject | the camera orbits halfway round the bottle |
| Follow | Moves with a walking subject, behind or in front | the camera follows behind her at walking pace |
| Zoom | Lens changes, camera still | slow zoom in |
| Push-pull (dolly zoom) | Background stretches while the subject holds size | dolly zoom, the background stretches behind him |
| Whip pan | Very fast pan that blurs | whip pan to the door |
| Locked-off | No movement | locked-off camera, no movement |

### Speed and feel

Always give a move a speed: **slow**, **steady**, **gentle** or **fast**. Say how it ends: "and
settles on the label", "and stops at the doorway". Add **smooth** for a dolly or gimbal feel, or
**handheld** for a slight human sway. For slow motion, say "in slow motion" once; for a time-lapse,
say "time-lapse" and what changes (light, clouds, crowd).

### Light words that go with the camera

Name the source and its direction, not a mood: "soft key light from camera left", "hard noon sun
from above", "warm practical lamps in frame", "cool blue window light from behind (backlight)",
"golden hour, low sun behind the subject". For a background, copy the interrogation's `lighting`
field so the person pasted on top already matches.

## Part 2: Writing a camera into an AgentC prompt

The AgentC video model (SeeDance) reads camera words literally. It follows a clear, single
instruction and blends or ignores a crowded one.

### Order

Write the prompt in this order. Leave out a line that does not matter.

1. **References**: what each reference is for. "[Video 1] is the shot: keep its timing and
   camera move. [Image 1] is the place and its light."
2. **Shot**: size, angle and lens. "Medium shot, eye level, 50 mm, shallow focus."
3. **Subject and action**: who or what, doing what, in the order it happens.
4. **Place**: where, period, time of day.
5. **Camera**: the one move (or "locked-off"), its speed and where it ends.
6. **Light**: the source and direction.
7. **Hold**: what must not change. "No people. No text. The label stays readable."

### Rules that keep the camera

- **One move per clip.** "Push in and orbit and tilt up" gets a wobble. Two moves the person
  really wants are two clips, cut together.
- **Say it once, with a speed.** "The camera pushes in slowly and stops on the label."
- **Match the length.** A slow push across the whole room needs 8 s or more; a 4 s clip wants a
  small move or none. The model makes 4 to 15 s.
- **Static means static.** For a locked-off shot write "locked-off camera, no camera movement".
  Saying nothing lets the model drift.
- **A video reference holds the camera better than words.** When the move must match something
  that exists, send it as [Video 1] and say "keep [Video 1]'s camera move". It costs more, about
  three times (see `shot-task`), so quote both ways.
- **References in order.** `assetIds` order is the [Video 1], [Image 1], [Image 2] numbering.
  Limits: 9 images, 3 videos, 3 audio clips.
- **No mood words in place of choices.** Replace "cinematic" with the lens, the light and the
  move that make it so.

### Describe mode: examples

**Background for a static green-screen shot** (researcher, `look.json` prompt):

> An empty 1920s Singapore street of two-storey shophouses, painted shutters, wet stone road.
> Medium shot framing at eye level, 50 mm lens feel, background slightly soft. Locked-off camera,
> no movement. Late afternoon, soft key light from camera left, warm. No people. No text.

**Motion transfer for a push-in plate** (`lite-hybrid-motion`):

> [Video 1] is the shot: keep the person, the timing and the camera's slow push in exactly.
> [Image 1] is the place and its light. The same shot in the shophouse street of [Image 1],
> light from camera left as in [Video 1]. Nothing else changes.

The camera line only repeats what the interrogator saw. It never adds a move.

### Direct mode: examples

**Product B-roll, 6 s:**

> [Image 1] is the bottle. Close-up, low angle, 85 mm, shallow focus. The bottle stands on wet
> black stone. The camera orbits slowly a quarter of the way round it from left to right and
> settles with the label facing camera. Hard backlight from behind, a soft fill from camera
> right. The label stays sharp and readable. No text added.

**Establishing shot, 10 s:**

> Extreme wide shot of a pine forest at dawn, mist between the trunks. 24 mm, deep focus. The
> camera rises slowly on a crane from the forest floor to just above the treetops and stops.
> Low sun behind the trees, cool blue shadows. No people.

**From one frame to another** (shot-task, both stills as references):

> [Image 1] is the start, [Image 2] the end. Locked-off camera, no movement. A time-lapse from
> the afternoon of [Image 1] to the sunset of [Image 2]: the light warms and lowers, the clouds
> move left to right.

Afterwards, `T check --b-at first` and `--b-at last`: the model has no frame inputs, so the
start and end are a request until checked.
