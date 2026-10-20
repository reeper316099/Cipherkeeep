# Cipherkeep starter pack

Original, MIT-licensed starter content: 45 commands, 10 concepts (using the 13-section concept template),
4 cheat sheets / guides and 3 example labs. Nothing here is copied from books, man pages or anyone's notes.

| File            | Contents                                                      |
| --------------- | ------------------------------------------------------------- |
| `commands.json` | Each command: syntax, flags, examples with descriptions, risk |
| `concepts.json` | Concepts with `relatedCommands` / `relatedConcepts` by name   |
| `notes.json`    | Markdown cheat sheets and guides                              |
| `labs.json`     | Practice labs you can do on your own machine                  |

Cipherkeep loads it from first run (or Import → Starter pack) through the normal importer: it is
idempotent, never overwrites what you have written, and can be undone. `npm test` checks every entry
against the app's schemas and runs the shell examples through `bash -n` (syntax only, nothing executed).

Examples use the reserved documentation addresses 192.0.2.0/24 and 198.51.100.0/24 and the `.test` TLD.
Flags are the common GNU/Linux and macOS ones; where they differ the entry says so.
