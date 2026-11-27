---
name: camera-director
description: >
  Camera language for any prompt that asks AgentC for a picture or a clip: shot size, angle,
  height, lens, focus, movement and speed, and how to write them so the video model follows.
  Use before writing a create_video_job or create_image_job prompt (shot-task takes, B-roll,
  "animate between these frames", variants), when the researcher writes a location's background
  prompt, and when a person asks for "a dolly in", "a low angle", "make it more cinematic" or
  "what camera move should this be". In a Prod-Lite job it describes the camera the cut already
  has; it never invents a new one.
metadata:
  version: 0.1.0
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

## Read

1. `references/camera-words.md`: every word, what it does on screen, and the plain phrase to
   write. It also maps the interrogator's `camera` values to prompt phrases.
2. `references/agentc-video-prompts.md`: how to lay out a prompt for the AgentC video model so
   the camera holds, with worked examples for each mode.

## Rules the plugin already set (they win)

- `${CLAUDE_PLUGIN_ROOT}/lite/docs/SHARED-RULES.md` applies, and so does every quote, ask and
  yes in `shot-task` and `lite-hybrid-motion`. This skill writes words; it spends nothing.
- Motion transfer sends `generateAudio` false. A camera prompt never turns sound on.
- The video model makes 4 to 15 s and has no first- or last-frame input: "end on [Image 2]" is a
  request, checked afterwards with `T check`.
- Background prompts never ask for people or text (researcher rule). A camera word that implies
  a subject ("over-the-shoulder", "two-shot") does not belong in a background prompt.
