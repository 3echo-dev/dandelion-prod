# Dandelion Prod

Prod-Lite as a Claude Code plugin: a first cut, a brief and the new world go in, and a finished
master comes out. The people stay as they were shot, researched AI backgrounds go behind them, and
the cut gets a colour grade and titles. It renders at the first cut's exact length with its own
sound. Every decision is a person's, made on one board.

## Install

```
/plugin marketplace add 3echo-dev/dandelion-prod
/plugin install dandelion-prod@dandelion-prod
```

Then run `/dandelion-prod:install`. It checks for ffmpeg, Python with Pillow, the motion composer
and the board, and asks before it installs anything.

## Start a job

`/dandelion-prod:prod-lite`, or open the **Prod-Lite** door on the board and fill in the form:

| Field | What to give |
|---|---|
| Project folder | a folder on this computer, or a Google Drive folder link. Its video is the first cut; files named brief and context are read; everything else is copied into the job |
| First cut | only if it is not in the folder |
| Brief | what the film is for, its length, the titles wanted |
| Context | the new world, per scene if it differs: "the street becomes a 1920s shophouse row at golden hour" |
| Deliver | the master, or the master plus a Nuke script per replaced shot |

## The steps

intake → research → references → catalogue → interrogate → look → **Gate A, Look sign-off** →
hybrid → grade → mograph → render → review → **Gate B, Master sign-off**

| Agent | Does |
|---|---|
| researcher | what each new place really looks like, the grade and the titles; later, one background prompt per location |
| scraper | reference pictures for each place, with source and licence |
| cataloguer | splits the cut into shots, contact sheet |
| interrogator | reads every shot (who, where, light, camera); checks the results |
| renderer | cut-outs, composites, grade, motion graphics, the master |
| lite-orchestrator | runs the steps and the board; the only one that spends credits |

Backgrounds are generated on 3echo AgentC at 1 credit each, and only after a person says yes on
the board. The plugin brings its own AgentC connection; sign in once with `/mcp` →
`plugin:dandelion-prod:agentc` using the 3echo account whose credits the studio will spend.

## Hand-offs and copies

- **Nuke.** `lite/scripts/nuke.js` writes a folder per replaced shot: a `.nk` script that rebuilds the
  master's composite node for node (key, spill, matte, background, light wrap), the plate, the
  background and the reviewer's notes. It runs as a deliverable (the Deliver choice) or from Gate B's
  **Send to compositor**, where the master waits until every shot comes back (`nuke.js return`) and
  is then regraded, retitled and reviewed again.
- **Google Docs and Sheets.** With the Google Drive connector, research, references, the shot list,
  the look and the review are copied to a Drive folder per job and linked on each step's card.
  The board stays the record; sign-offs happen there.

## Layout

| Folder | Holds |
|---|---|
| `lite/` | the agents, skills, playbooks and scripts |
| `research/` | the web and social reading server the researcher and scraper use |
| `board/` | the board page (`board/src/board.html` is the source; `scripts/build-board.js` builds it) |
| `vendor/3echo-motion/` | the motion-graphics composer (AGPL-3.0, see its licence) |
| `skills/` | `install` and `board-setup` |
| `hooks/` | the session-start check that the AgentC server is declared |

## Tests

```
node lite/scripts/test/run-all.js
node research/test/server.test.mjs
```

The end-to-end test needs ffmpeg, Python and Pillow, and runs in a temporary folder.
