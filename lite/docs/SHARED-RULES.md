# Rules every Prod-Lite agent follows

They hold in a job (the eleven steps) and in a shot task (skill `shot-task`: one clip or still, one ask). Where a rule says the job folder, a task's folder is meant too; where it says the orchestrator, in a shot task that is the session running the skill.

1. **The job folder is the record.** A stage is done when its file is on disk and its script exited 0. What an agent says in chat is not state.
2. **Scripts do the work.** Splitting, cutting out, compositing, grading and rendering run through `scripts/`. An agent never hand-writes an ffmpeg command for a deliverable; when a script cannot do what is needed, it says so.
3. **Keep the performance.** People and products reach the master as the first cut's own pixels. Nothing in this pipeline redraws them; motion transfer's redrawn person is used as background only. In a shot task the person may ask for a redraw (a relight, a new pack); whatever they asked to keep is then pasted back from the original (`task.js do paste-back`) or measured against it (`task.js check`), and the number is reported.
4. **Credits only after a yes.** Only the orchestrator calls paid 3echo AgentC tools, only after a person approved that spend on the board (or in chat), and never above it. Any connected AgentC counts: a Claude connector, another 3echo plugin, or this plugin's own `agentc` server. If none answers, stop and say so (`/dandelion-prod:install` walks the sign-in). Never generate through a tool that is not AgentC. The video model makes 4 to 15 whole seconds and a video reference costs about three times a clip without one: say both before quoting, and quote both ways.
5. **A person signs off.** Steps are approved, and Gate A (look) and Gate B (master) signed off, by a person on the board or in chat. The run never writes an approval or a gate; wording is sign-off and release, never lock.
6. **Say what the picture shows.** Descriptions come from looking at the frames. Unknown stays unknown.
7. **Pictures from the web are references.** A scraped picture guides generation and the grade. It goes into the picture only when its licence allows it and the scraper recorded that with `--background`.
8. **Leaves do not branch.** The cataloguer, interrogator, researcher, scraper and renderer never spawn agents, never spend, never write to the board.
9. **Flags are shown, never passed.** A composite under 97% actor kept, a failed render check or a failed review goes in front of a person with its picture.
10. **Plain words.** Messages on the board are short and say what is true now: what was done, what was found, what is needed.
11. **Wait, then show the file.** While AgentC generates, wait with `wait_for_job` and nothing else. Never call `open_generation_view` or `open_asset_view`: the live view redraws itself in the chat while a clip renders and makes the conversation jump. When the job is ready, land the file and show it from disk.
