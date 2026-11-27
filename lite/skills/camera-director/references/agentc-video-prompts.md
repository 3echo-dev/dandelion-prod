# Writing a camera into an AgentC prompt

The AgentC video model (SeeDance) reads camera words literally. It follows a clear, single
instruction and blends or ignores a crowded one.

## Order

Write the prompt in this order. Leave out a line that does not matter.

1. **References**: what each reference is for. "[Video 1] is the shot: keep its timing and
   camera move. [Image 1] is the place and its light."
2. **Shot**: size, angle and lens. "Medium shot, eye level, 50 mm, shallow focus."
3. **Subject and action**: who or what, doing what, in the order it happens.
4. **Place**: where, period, time of day.
5. **Camera**: the one move (or "locked-off"), its speed and where it ends.
6. **Light**: the source and direction.
7. **Hold**: what must not change. "No people. No text. The label stays readable."

## Rules that keep the camera

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

## Describe mode: examples

**Background for a static green-screen shot** (researcher, `look.json` prompt):

> An empty 1920s Singapore street of two-storey shophouses, painted shutters, wet stone road.
> Medium shot framing at eye level, 50 mm lens feel, background slightly soft. Locked-off camera,
> no movement. Late afternoon, soft key light from camera left, warm. No people. No text.

**Motion transfer for a push-in plate** (`lite-hybrid-motion`):

> [Video 1] is the shot: keep the person, the timing and the camera's slow push in exactly.
> [Image 1] is the place and its light. The same shot in the shophouse street of [Image 1],
> light from camera left as in [Video 1]. Nothing else changes.

The camera line only repeats what the interrogator saw. It never adds a move.

## Direct mode: examples

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
