# Cipherkeep

Offline, local-first desktop app for cybersecurity learning notes: command reference, concepts,
lab/CTF log, projects, learning log, cheat sheets. No telemetry, no accounts, no network calls.

**Status:** M0 (scaffold). See `docs/` as it grows.

## Layout

| Path                 | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `packages/shared`    | `APP_NAME`, Zod schemas, types                  |
| `packages/jsonstore` | Standalone, reusable JSON storage engine        |
| `packages/server`    | Fastify API, importers/exporters, search (M1+)  |
| `apps/desktop`       | Electron main + preload (M6)                    |
| `apps/web`           | React frontend (M3+)                            |
| `starter-pack/`      | Original MIT starter content                    |
| `fixtures/synthetic` | Generated fake Notion-style export              |
| `private-fixtures/`  | Your real export. **Gitignored; never commit.** |

## Develop

```bash
npm install
npm test
npm run lint && npm run typecheck
```

A pre-commit hook and CI run `npm run guard`, which fails if anything resembling a personal Notion
export is staged outside `fixtures/synthetic/` or `starter-pack/`.

## License

MIT
