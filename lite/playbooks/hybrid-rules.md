# Hybrid rules

Real actors, AI backgrounds. The performance is the client's; the pipeline only changes what is behind it.

1. **Separate, never redraw.** The actor reaches the cut as the plate's own pixels with transparency added. A step that regenerates or restyles the actor is not part of this route.
2. **Chroma key first.** A plate on a green or blue screen is keyed by colour (ffmpeg), sampled from its own corners, so any shade of screen works. AI segmentation (rembg) is for plates with no screen; it works frame by frame, so edges can shimmer: check the mask.
3. **One background per location.** Every shot at a location uses the same background, so the place does not change between cuts (`--background-per shot` gives each shot its own, generated against the first as the continuity reference). A picture the client owns or is licensed to use (`scrape.js add/fetch --background`) wins over generating one; a scraped reference never goes in the picture.
4. **Credits only after a yes.** A generated background is quoted, asked on the board, approved, then generated; `hybrid.js land` refuses without the approval.
5. **Measure the performance.** Every composite reports the share of the actor's pixels kept from the plate. Under 97% is flagged with its before/after still.
6. **Hashes bind the chain.** Plate → cut-out → composite each record the hash of what they were made from; a changed input voids what was made from it.
7. **Moving camera: motion transfer.** A still background does not track the camera. For a plate with a camera move, name the shot in `hybrid.motionPanels` (`motion-transfer.js include S03`): the plate goes to the AgentC video model as [Video 1] with the background as [Image 1], and the model returns the shot, camera move and all, in the new place. That clip is a background only: the plate's own cut-out goes back on top (`keepActor`), so rule 1 still holds. Its drift from the plate is measured (`regenActorPct`, 75% or more) because a person the model moved leaves a ghost round the pasted actor. Skill `lite-hybrid-motion`.
