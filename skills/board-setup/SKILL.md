---
name: board-setup
description: >
  Publishes this account's own copy of the Dandelion Prod board, shipped at board/board.html, as a
  claude.ai artifact with the db, artifact, comments, downloads and assets capabilities, and
  records its address for Prod-Lite in this workspace. Use once per account or workspace, when
  set-board.js --show says no board is set, or when the user asks for a fresh board.
---

# Skill: Board setup

**Purpose:** give the account that runs Prod-Lite one board it owns. The plugin carries the page;
the artifact belongs to whoever publishes it, only an owner's session can write its database, and
only a session watching it is woken by its decisions.

## Steps

1. **Is there one already?**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/set-board.js" --show
   ```

   Exit 0 prints the board in use: say so in one line and stop, unless the user asked for a new
   one (`--new`). Exit 3: continue.

2. **Publish the page** with the Artifact tool, `file_path` set to
   `${CLAUDE_PLUGIN_ROOT}/board/board.html`, `title` "Dandelion Prod", `icon` "film",
   `capabilities` `{"db": {}, "artifact": {}, "comments": {}, "downloads": true, "assets": {}}`,
   and a one-line description ("Dandelion Prod board: Prod-Lite projects, gates, inbox and
   chat"). Publish it as it is: never edit the page, never strip the base64 copy at its end, never
   pass `contract`. The publish result says whether this session now watches the board: note the
   answer for step 5.

3. **Record the address** the publish result returned:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/set-board.js" {url}
   ```

   A `PROD_LITE_BOARD_URL` in the environment would win: say so if one is set.

4. **Prove the session can write it.** One `ArtifactData` set on the new artifact, collection
   `meta`, document `board`, data `{"installedBy": "dandelion-prod", "pluginVersion":
   "{version from plugin.json}", "installedAt": "{now}"}`. The first write asks the person for
   consent once; a refusal means the board cannot be driven from this session, say that and stop.

5. **Say who is watching.** A decision reaches the run as a comment sent to Claude, only in a
   session watching the artifact with replies armed; publishing from this session arms it.
   `ArtifactComments` `action: "watch"` with no `url` lists the watches. Otherwise say plainly
   that every decision on the board must also be said in chat.

6. **Open it** with the Artifact tool (`action: "open"`), then ask the person to press **Signal
   pipeline** on the board once and approve the prompt that lets the page message this session.
   Never repeat the address.

## Rules

1. One board per workspace root. A second `board-setup` without `--new` changes nothing.
2. The page is published unmodified. Changes to the board are a plugin release.
3. `--new` publishes a fresh, empty board; projects on the old one stay there. Say that before
   publishing.
4. Never point a workspace at a board this account does not own.

## Output contract

A private artifact of the board page with capabilities db, artifact, comments, downloads and
assets; `boardUrl` and `boardSetAt` in `<root>/.prod-lite/config.json`; the `meta/board` document
on the artifact's database.

## Failure modes

| Failure | Fix |
|---|---|
| Publish refused for the capabilities | Say which; the page needs all five |
| A decision on the board wakes nobody | Press Signal pipeline and approve the prompt |
| The run says a permission check blocked a script | Allow the plugin's scripts for that workspace: `Bash(node:*)` and `Bash(python:*)` in its `.claude/settings.local.json` |
| The consent for the first write is declined | Stop; the board stays published but unused |
