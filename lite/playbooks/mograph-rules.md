# Mograph rules

For the mograph stage. Owned by the renderer. Alpha-channel overlays burned into the master by `render.py`; sample-then-batch; compositions from the 3echo Motion composer at `vendor/3echo-motion/composer`.

## Rules

1. **Three templates.** Overlays only (transparent): `title` (HeroTitle), `endtag` (EndTagOverlay), `captions` (CaptionOverlayOnly). The composer's full-frame renderers would cover the picture this pipeline keeps; `mograph.js` refuses them. A client's own animation with alpha comes in through `mograph.js add`.
2. **One render path.** `scripts/mograph-render.js` and nothing else. It maps the template to its composition, closes stdin so nothing can wait on a question, stops a render that prints nothing for 3 minutes, and checks the alpha channel.
3. **Set up once per machine.** `scripts/mograph-setup.js` installs the composer to `~/.dandelion-prod/mograph`, never the Desktop (a synced Desktop stalls the render). `--check` says whether it is ready.
4. **Alpha channel is mandatory for overlays.** ProRes 4444, `yuva444p`. A rendered background on an overlay is a bug.
5. **Frame rate matches `job.json` fps** unless the request says otherwise. Off-fps mograph is a sync headache for the editor.
6. **Sample-then-batch.** One sample render (`mograph.js run --sample`), looked at, then the rest. The person sees every overlay in the master at the final sign-off.
7. **Plate art is a separate quote.** If the template needs a logo or hero image and it's not on disk, `create_image_job` for one plate with its own board yes.
8. **Props are the composition's own.** The prop names live in `vendor/3echo-motion/composer/src/` (HeroTitle: `title`, `subtitle`, `accentColor`, `textColor`, `subtitleColor`; EndTag: `text`, `palette`, `fadeInSeconds`, `holdSeconds`, `fadeOutSeconds`).
9. **Duration is the request's.** `durationSec` becomes `--duration` in frames at the job fps.
10. **Long titles on vertical.** HeroTitle wraps letter by letter, so a line over about 18 characters breaks mid-word at 1080 wide. Put the second half in `subtitle`, or use `endtag`.
11. **File naming:** `mograph/renders/{template}_{nn}.mov`, requests in `mograph/requests/{n}.json`, placements in `mograph.json`.
12. **Never edit the composer during a job.** A change is its own plugin change, tested and versioned (`docs/motion-composer.md`).
13. **Placement is the look's.** `start` and `durationSec` in `look.json` place each overlay on the first cut's timeline; `render.py` burns it in.

## Checklist

- [ ] `mograph-setup.js --check` ready
- [ ] Template in supported list
- [ ] Plate art quoted, approved and landed before render
- [ ] Sample rendered first and its PNG looked at
- [ ] Overlay has alpha (the script says `yuva…`)
- [ ] Frame rate matches `job.json` fps
- [ ] File named per convention with `v{k}` version
- [ ] `mograph.json` shows every overlay `rendered`
