# Cipherkeep

Offline, local-first desktop app for cybersecurity learning notes: command reference, concepts,
lab/CTF log, projects, learning log, cheat sheets. No telemetry, no accounts, no network calls.

**Status:** M5 (storage, API, importers/exporters, all content UIs, study engine, dashboard).. See `docs/` as it grows.

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
npm run dev          # API on :5174 (data in .dev-data/) + web on http://localhost:5173
npm test
npm run lint && npm run typecheck
npm run fixtures:generate   # rebuild the synthetic Notion export
```

In dev the Vite server proxies `/api` to the API and adds the bearer token; in the packaged app the
Electron preload passes a random per-launch token and port instead.

A pre-commit hook and CI run `npm run guard`, which fails if anything resembling a personal Notion
export is staged outside `fixtures/synthetic/` or `starter-pack/`.

## License

MIT
