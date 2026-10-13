---
name: lite-google-copies
description: >-
  Google Docs and Sheets copies of a Prod-Lite job's records (research, references, shots, look, review), linked on each step's card on the board, for reading, sharing and commenting. Only when the Google Drive connector is connected. Orchestrator only.
metadata:
  version: 0.1.0
user-invocable: false
---

# Skill: Google copies

**Purpose:** people who never open the board can read the research, scroll the references with
their thumbnails, sort the shot list and share the review. The board stays the record: every
sign-off and change request happens there, never in a Doc's comments. `S` is
`${CLAUDE_PLUGIN_ROOT}/lite/scripts`.

**When:** right after record-version for research, scraper, interrogate, look and review, and
again for each new version (a copy is never edited; the next version gets a new file). Skip the
whole skill, silently, when no Google Drive tool (`create_file`, any prefix) is in the session.

| Step | Becomes | What is in it |
|---|---|---|
| research | Google Doc | the places, period and light, grade, palette, titles, searches, sources |
| scraper | Google Sheet | one row per reference: thumbnail (`=IMAGE`), place, licence, source page |
| interrogate | Google Sheet | one row per shot: in, out, length, people, setting, light, camera, treatment, place |
| look | Google Doc | each location's description and background prompt, which shot gets which place |
| review | Google Doc | the master's verdict and every shot's notes |

## Steps

1. **The job's folder, once.** `node S/gdocs.js {client} {job-id} folder`. Exit 3: create a
   folder with the Drive connector (`create_file`, mime type `application/vnd.google-apps.folder`,
   title as printed), then `gdocs.js {client} {job-id} folder --id <its id>`.
2. **Export.** `node S/gdocs.js {client} {job-id} export --item {step}`. It prints, tab-separated:
   item, version, content mime type, bytes, file, title.
3. **Upload.** Read the file and call `create_file` with `title` as printed, `textContent` = the
   file's whole text, `contentMimeType` as printed (`text/html` becomes a Doc, `text/csv` a
   Sheet), `parentId` = the folder id. Never change the text on the way: the file is the copy.
4. **Link.** `node S/gdocs.js {client} {job-id} link --item {step} --n {n} --url <the new file's
   link>`, then push. The step's card shows "Google Doc v2" (or Sheet); a link to an older
   version is marked older until the new one is made.
5. **Master, optional.** A Drive link the person already has for the master (they uploaded it
   themselves) can be linked the same way: `link --item render --url <link> --label "Master on Drive"`.
   The connector cannot carry a video's bytes; never try.

## Never

1. Ask a person to approve, sign off or request a change in a Doc or a Sheet; that is the board.
2. Share a file or change its sharing; the person shares from Drive.
3. Copy anything not in the table, or anything from the brief folder the client did not send.
4. Retry a `create_file` that may have gone through without searching the folder for its title first.
