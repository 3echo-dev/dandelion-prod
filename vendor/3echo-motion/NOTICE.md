# 3echo Motion composer

`composer/` is the Remotion project behind the mograph stage: titles, end tags, captions and the
full-frame renderers. It ships inside this plugin under clearance held by the plugin owners, and is
covered by the licence in `LICENSE` (AGPL-3.0) next to it; the rest of the plugin stays MIT.

- Derived from the remotion-composer of the OpenMontage project (Remotion 4.0.484), taken
  2026-09-26 without `node_modules/`. Renamed for 3echo; the compositions are otherwise unchanged.
- Installed per machine by `scripts/mograph-setup.js`, into `~/.creative-studio-post/mograph`,
  never the Desktop. Rendered only by `scripts/mograph-render.js`.
