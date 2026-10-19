# Notion import

Cipherkeep imports a Notion "Markdown & CSV" export (zip or extracted folder) without any network access.
`POST /api/v1/import/preview` parses and returns a plan (no writes); `POST /api/v1/import/commit` applies it;
`POST /api/v1/import/undo/:id` reverts it. Every commit takes a `pre-import` backup and writes
`imports/<id>/{manifest,report}.json` (plus the original zip).

## What the importer handles (verified against a real export)

| Quirk                                                                                      | Handling                                                                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| UTF-8 BOM on every CSV                                                                     | stripped before header detection                                                                                  |
| `*_all.csv` duplicate next to each database CSV                                            | deduplicated                                                                                                      |
| Emoji / `U+FE0F` in names, 32-hex id suffixes, folders without ids                         | `splitNotionName`, NFC-normalised paths                                                                           |
| Relation cells `Title (url-encoded/path.md)`; `../` relative paths in page property blocks | parsed by link target, resolved by page id, then title; unresolved → warning                                      |
| `Key: value` property block under `# Title` (database row pages only)                      | parsed and stripped; unmapped keys kept in `extras.notionProperties`                                              |
| Header-less tables exported with the first data row as header                              | header detected by vocabulary (`Option`, `Command`, `Meaning`, …); otherwise all rows are data                    |
| Table cells containing newlines                                                            | repaired (outside code fences only)                                                                               |
| Options table headed `🔧 Commands` (key bindings) or non-flag rows                         | still mapped to `options[]`; heading recorded in `extras.optionsHeading`                                          |
| Template hint lines such as `(Inputs the command takes.)`                                  | dropped from fields, recorded in `extras.droppedTemplateHints`                                                    |
| `cmd = "desc"` examples                                                                    | split on the first `= "`; GFM example tables are also read; the CSV `Example` becomes the primary (first) example |
| `\[flags\]` escapes                                                                        | unescaped in structured fields and outside code; code spans are never rewritten                                   |
| `<aside>` callouts, `<details>` toggles                                                    | `> [!TIP]` style callouts and `> **▸ summary**` blockquotes                                                       |
| `[[:alpha:]]`-style glob classes                                                           | never treated as wiki-links or placeholders                                                                       |
| Template pages (database has no row for them; empty databases have no CSV at all)          | saved to `config/templates/<collection>.json`; folder name decides the collection                                 |
| Hub/dashboard page linking to the CSVs                                                     | skipped by default (override with `include`)                                                                      |
| Loose pages                                                                                | notes (folder hierarchy kept) or snippets when >60% code; reclassify per page in preview                          |
| Local images/files referenced by pages                                                     | copied to `attachments/<hash>/` and relinked as `ck://attachments/…`                                              |
| Page-to-page links                                                                         | converted to `[[wiki links]]`                                                                                     |

## Strategies

`update-empty-only` (default) fills only empty fields and unions tags/links, so edits you made are never
overwritten; `skip`; `overwrite`; `keep-both`. Identity is `importRef` (Notion page id, or
`csv:<collection>:<title>`) then normalised title. Re-importing the same export changes nothing.

## Known limits

- The export does not carry select-option colours, so categories are seeded without colours.
- Database schemas of _empty_ databases (no CSV) cannot be recovered; Labs options come from `config/categories.json`.
- Concept sections named differently from the template are kept as extra sections, never dropped.
