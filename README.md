# Cipherkeep

An offline, local-first desktop app for cybersecurity learning notes: a command reference you can copy
from, concepts, a lab/CTF log, projects, a learning log, cheat sheets and snippets. It also helps you
remember what you learn, with spaced-repetition review, a skill map and a dashboard.

**No accounts, no telemetry, no AI.** Your data is plain JSON and Markdown files in a folder on your
computer. The only optional thing that uses the internet is the Notion API import, and it is off by
default.

## What it does

- **Command library**: instant search (dash flags like `-la` and `--color=auto` work), copy with one key,
  fill in `<placeholders>` once and every example updates. Values you mark sensitive are never stored.
- **Concepts, labs, projects, learning log, notes, snippets**: editors with relations, `[[wiki links]]`,
  backlinks and a graph. Notes are real `.md` files with frontmatter.
- **Study**: spaced-repetition review, a skill map computed from your practice, recommendations that say
  why, a streak and heatmap, and a threat-level banner on the dashboard.
- **Import and export**: import a Notion export (zip), CSV, a Markdown folder or a JSON backup, with a
  preview first, merge strategies and one-click undo. Export an Obsidian-compatible Markdown vault, CSV or
  JSON.
- **Starter pack**: original, MIT-licensed content (commands, concepts, guides, practice labs) you can load
  on first run. It never overwrites what you wrote and can be undone.
- **Privacy tools**: blur mode for screen sharing (Ctrl/Cmd+Shift+B), lab flags not stored by default, and
  optional encryption at rest.
- **Optional encryption at rest**: AES-256 with a passphrase and a recovery key. If you lose both, the data
  cannot be recovered. See [docs/SECURITY.md](docs/SECURITY.md).
- **Optional Notion API import**: read a Notion workspace directly with an integration token (used for the
  import only, never saved).
- **Accessible**: keyboard-friendly, a skip link, dark and light themes, and an automated axe audit of every
  page.
- **Fast**: tested with 10,000 notes and 5,000 commands. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

The app never runs commands or scripts you store.

## Install

Installers are built by `npm run desktop:dist` for your OS (into `./release`), and a `v*` tag builds all
three in CI. Builds are **unsigned**, so macOS and Windows warn about an unidentified developer on first
launch. See [docs/PACKAGING.md](docs/PACKAGING.md) for how to open them and how to add signing.

Your data lives in the OS app-data folder (change it in Settings, or set `CIPHERKEEP_DATA_DIR`). Back it up
by copying the folder. See [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).

## Develop

```bash
npm install
npm run desktop:start        # build and run the desktop app
npm run dev                  # API on :5174 (data in .dev-data/) + web on http://localhost:5173
npm test                     # unit and API tests (Vitest)
npm run e2e                  # build the desktop app and drive it with Playwright
npm run lint && npm run typecheck
npm run bench                # 10k-note performance benchmark
npm run fixtures:generate    # rebuild the synthetic Notion export
```

In dev the Vite server proxies `/api` to the API and adds the bearer token; in the packaged app the
Electron preload passes a random per-launch token and port instead.

## Layout

| Path                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `packages/shared`    | `APP_NAME`, Zod schemas, study engine, Notion parsing            |
| `packages/jsonstore` | Standalone, reusable JSON storage engine (atomic writes, codecs) |
| `packages/server`    | Fastify API, importers/exporters, search, study, encryption      |
| `apps/web`           | React frontend                                                   |
| `apps/desktop`       | Electron main process and preload                                |
| `starter-pack/`      | Original MIT starter content                                     |
| `fixtures/synthetic` | Generated fake Notion-style export used by tests                 |
| `e2e/`               | Playwright tests against the built desktop app                   |
| `private-fixtures/`  | Your real export. **Gitignored; never commit.**                  |

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Data format](docs/DATA_FORMAT.md)
- [Security and privacy](docs/SECURITY.md)
- [Notion import](docs/NOTION_IMPORT.md)
- [Study engine](docs/STUDY_ENGINE.md)
- [Performance](docs/PERFORMANCE.md)
- [Packaging](docs/PACKAGING.md)

## Keeping the public repo clean

A pre-commit hook and CI run `npm run guard`. It fails if anything resembling a personal Notion export is
staged outside `fixtures/synthetic/` or `starter-pack/`, or if a file looks like it contains an API key or
private key. Never put real notes, lab details or tokens in code, tests, docs or commit messages.

## License

MIT
