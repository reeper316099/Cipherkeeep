# Data format

Everything is plain files in one folder (default: your OS's application-data folder for the app, or
`CIPHERKEEP_DATA_DIR`). You can open them in any editor, back them up by copying the folder, and the app notices
hand edits (an invalid edit is ignored and reported, never applied).

```
meta.json                      app name, data version
vault.json                     only when encryption is on: salts + wrapped keys
config/settings.json           preferences
config/categories.json         taxonomy per collection
config/skills.json             skill-map definitions
config/templates/<coll>.json   page templates (optional overrides)
data/commands/<category>.json  one shard per category
data/concepts/<category>.json
data/labs/<platform>.json
data/log/<yyyy-mm>.json
data/projects/projects.json   data/snippets/snippets.json
data/notes/<folder>/<slug>.md  real Markdown files with YAML frontmatter
study/srs-state.json           review schedule per card
study/sessions/<yyyy-mm>.jsonl append-only review log
activity/<yyyy-mm>.jsonl       append-only "what changed" log (ids only, never content)
attachments/<hash8>/<file>     pasted/imported images
imports/<id>/                  manifest.json + report.json (+ the source zip) for undo
backups/<stamp>-<reason>.zip   rolling backups (the newest 20)
.quarantine/                   corrupt files moved aside (never deleted)
```

## JSON shards

```json
{ "schemaVersion": 1, "data": { "items": [ … ] } }
```

Keys are sorted and files are pretty-printed with a trailing newline, so diffs are small. Writes are atomic
(temp file → fsync → rename). A newer `schemaVersion` than the app understands is refused, not downgraded; older ones
are migrated after taking a backup.

## Notes

```markdown
---
id: 01J…
title: SSH quick guide
tags: [ssh, networking]
createdAt: 2026-03-24T10:00:00.000Z
updatedAt: 2026-03-24T10:00:00.000Z
---

# body in Markdown, with [[wiki links]] and [[cmd:ls]]
```

The folder and slug come from the path. When encryption is on, notes live at `data/notes/_enc/<id>.md` and the
folder and slug move into the encrypted frontmatter.

## Encrypted files

`CKENC1B\0` (8 bytes) · IV (12) · GCM tag (16) · ciphertext. Append-only logs are encrypted per line:
`CKENC1:` + base64(IV · tag · ciphertext). Turning encryption off restores the layout above.

## Export

Settings → Import / Export writes an Obsidian-compatible Markdown vault (re-importable), CSV per collection, or a
full JSON backup. Exports are plain files by design. Lab flags and private writeups are left out unless you ask.
