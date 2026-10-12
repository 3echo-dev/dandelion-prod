# Rules every Prod-Lite agent follows

1. **The job folder is the record.** A stage is done when its file is on disk and its script exited 0. What an agent says in chat is not state.
2. **Scripts do the work.** Splitting, cutting out, compositing, grading and rendering run through `scripts/`. An agent never hand-writes an ffmpeg command for a deliverable; when a script cannot do what is needed, it says so.
3. **Keep the performance.** People and products reach the master as the first cut's own pixels. Nothing in this pipeline redraws them; motion transfer's redrawn person is used as background only.
4. **Credits only after a yes.** Only the orchestrator calls paid 3echo AgentC tools, only after a person approved that spend on the board (or in chat), and never above it.
5. **A person signs off.** Steps are approved, and Gate A (look) and Gate B (master) signed off, by a person on the board or in chat. The run never writes an approval or a gate; wording is sign-off and release, never lock.
6. **Say what the picture shows.** Descriptions come from looking at the frames. Unknown stays unknown.
7. **Pictures from the web are references.** A scraped picture guides generation and the grade. It goes into the picture only when its licence allows it and the scraper recorded that with `--background`.
8. **Leaves do not branch.** The cataloguer, interrogator, researcher, scraper and renderer never spawn agents, never spend, never write to the board.
9. **Flags are shown, never passed.** A composite under 97% actor kept, a failed render check or a failed review goes in front of a person with its picture.
10. **Plain words.** Messages on the board are short and say what is true now: what was done, what was found, what is needed.
