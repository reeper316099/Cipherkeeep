# Performance

Target: stay responsive with 10,000 notes and 5,000 commands on a normal laptop.

Reproduce with `npm run bench`. It generates a synthetic library in a temp folder, starts the server
and prints timings. Nothing leaves your machine.

## Measured (10k notes + 5k commands, Apple-silicon laptop)

| Measurement                          | Result               |
| ------------------------------------ | -------------------- |
| Startup (load + index + watch)       | ~5.8 s (was 10.5 s)  |
| `GET /notes?limit=500&omit=markdown` | 144 KB (was 1183 KB) |
| Search (keyword, operators)          | 1–13 ms              |
| `GET /stats/overview`                | 39 ms (was 129 ms)   |
| `GET /notes/:id`                     | 0.3 ms               |
| `PATCH` one note                     | ~12 ms               |

## What changed

- **Parallel note scan**: Markdown files are read with a bounded pool (48 at a time) instead of one by one.
- **Bounded watcher start-up**: the file watcher's "ready" wait is capped at 1.5 s.
- **Background launch backup**: the on-launch zip backup runs 3 s after start and is streamed
  (`yazl`) to a temp file, then renamed, so it never blocks the event loop.
- **Lean list responses**: list endpoints accept `omit=markdown,sections,...`. The web app omits
  note bodies from lists and fetches the full note only when you open it.
- **Skill-map scoring** precomputes per-entity domains once instead of per skill.

## Known limits

- Start-up is dominated by reading and indexing every note once. It scales roughly linearly.
- Everything is held in memory (about 270 MB heap at 10k notes + 5k commands).
