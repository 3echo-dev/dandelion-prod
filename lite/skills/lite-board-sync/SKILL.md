---
name: lite-board-sync
description: >-
  How the orchestrator keeps the Prod-Lite board and the job folder agreeing: push the outbox after every step, land what the person decided at every gate, every answer and every resume, bind a signed-off gate to the file hashes. Orchestrator only.
metadata:
  version: 0.2.0
user-invocable: false
---

# Skill: Board sync

**Purpose:** the board shows what the files say; the files record what the board decided. Only the orchestrator reaches the board, through the ArtifactData tool. `S` is `${CLAUDE_PLUGIN_ROOT}/lite/scripts`.

## The board

Its address comes from `lib-board.js` (`PROD_LITE_BOARD_URL`, else `.prod-lite/config.json`); pass it to the tool as `url`, never print it in chat. With no address set the scripts use the file board at `<job>/.board/db/`.

Collections under `projects/{job-id}`: `items` (the eleven steps), `versions`, `runs`, `messages` (each agent's chat), `inbox` (questions), `gates` (A, B), `panels` (one card per shot), `previews` (a picture or video per step), `references` and `refsel` (what a person ticked). Scripts never write the board; they queue to `<job>/.board/outbox.jsonl`.

## Open, once

`node S/board-sync.js open {client} {job-id}` (new-job.js does it): the project with `kind: 'lite'` and its eleven steps. Push next.

## Push, after every step and before ending any turn

```bash
node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/board-sync.js" push {client} {job-id} --files
```

It prints `{url, pins, batches}`. For each pin: `ArtifactData get` that document; put its `version` as `if_version` on that write (`mayExist`: skip when nothing is found). Shot cards, previews, references, runs and versions carry their own `if_version` already: the job keeps those numbers (`.board/own-versions.json`). Hand each batch to `ArtifactData` `action: batch` as `writes`. When every batch committed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/board-sync.js" push {client} {job-id} --ack
```

A rejected batch is never acknowledged. A version refusal on a shot card or preview means the numbers drifted: read that document, write its version into `.board/own-versions.json` under its full path, push again.

## Land, on every bell, at a gate and on every resume

Read the board with `ArtifactData`, every call with the same `out_dir` `.board/landed/{stamp}`:

1. `action: list`, collection `projects/{job-id}/inbox`.
2. `action: list`, collection `projects/{job-id}/items`.
3. `action: list`, collection `projects/{job-id}/gates`.
4. `action: list`, collection `projects/{job-id}/refsel` (after the References step).

```bash
node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/board-sync.js" land {client} {job-id} ".board/landed/{stamp}"
```

It writes `.board/db/`, `.board/inbox.jsonl`, and prints what changed: approvals, change notes, answers, gates.

## Pull, once a gate is signed off

`node S/board-sync.js pull {client} {job-id} --gate A` (or `B`). Exit 0: the files signed off still match disk; `approvals/gate-a.json` is written. Exit 1 names a file changed after the sign-off: present it again. Exit 3: not signed off yet; say what waits, end the turn.

## Ask

```bash
node "${CLAUDE_PLUGIN_ROOT}/lite/scripts/board-sync.js" ask {client} {job-id} --item hybrid --text "Generate 2 backgrounds (shophouse street, five-foot way) for 2 credits?" --options "Approve 2 credits|Decline"
```

The question sits in Needs you with its buttons; say the same in chat; push; end the turn. The answer comes back with the next land as `answered`, with `answeredBy` and `answeredAt`: those are the `--by` and `--at` for `hybrid.js approve`.

## Say

After any reply in the comment thread, the same line in the agent's chat: `node S/state.js {client} {job-id} say --as <seat> [--item <step>] --text "..."`, then push. The page cannot read the thread.

## Rules

`${CLAUDE_PLUGIN_ROOT}/lite/docs/SHARED-RULES.md` applies.

1. Push before ending any turn.
2. Land before deciding anything on a resume or a bell.
3. Silence is not approval. `pull --gate` waits; it never assumes.

## Failure modes

| Failure | Fix |
|---|---|
| Acknowledging a batch the tool rejected | Only after every batch committed |
| Pull finds no decision | Land first; then wait |
| Pull refuses a changed file | Present the step again; the person signs off again |
| ArtifactData unavailable | Say so; take decisions in chat and record them with `--by "<role> (chat)"` |
