# Architecture

```
apps/desktop    Electron shell: window, menu, security policy, installers
apps/web        React + Vite UI (served by the local server inside the app)
packages/server Fastify API on 127.0.0.1, repositories, search, study, import/export, vault
packages/jsonstore  standalone storage engine (atomic writes, watcher, backups, codec) - no app code
packages/shared Zod schemas, constants, pure logic (study engine, Notion parsing, wiki links)
starter-pack/   original MIT content that can be loaded on first run
e2e/            Playwright tests that drive the real Electron app
```

## Process model

The desktop main process starts `startServer` (packages/server) on an ephemeral loopback port with a per-launch bearer
token and opens a sandboxed window that loads the UI from that server. The preload script exposes only the port and
token plus a few folder helpers. There is no remote content.

`startServer` owns one listening socket and swaps between two apps: the **open** app (full API) and, for an
encrypted library that has no key yet, a **locked** app (UI shell, `/vault/unlock`, and `423` for everything else).
Unlocking builds a context with the keyed codec and swaps in the full app; locking swaps back and drops the key.

## Storage

- `JsonStore` / `JsonFile`: validated, versioned, atomically written shards with a keyed mutex per file, a watcher
  for hand edits, quarantine plus restore-from-backup for corrupt files, and multi-file transactions with rollback.
- A `Codec` sits between memory and disk. The default is the identity; the AES-GCM codec encrypts each file. Anything
  that reads or writes outside the store (templates, attachments, import records, logs, notes) goes through the same
  codec.
- `Repo` objects (`JsonRepo`, `NoteRepo`) keep entities in memory and emit change events; search, links and the SSE
  stream listen to those events. Search (MiniSearch) and the link graph are rebuilt in memory at start-up.

## Import and export

Importers build a **plan** (pure, no writes): Notion export, Notion API (reads the workspace into a virtual export,
then the same planner), CSV, Markdown folder, JSON backup. `commitPlan` applies a plan after taking a backup and
writes a manifest so `undoImport` can reverse it. Imports are idempotent through stable `importRef`s.

## UI

React Router (hash routes), TanStack Query for server state, Zustand for UI state. Lists virtualise; note bodies are
fetched on open (list responses omit them). A `VaultGate` shows the unlock screen on `423`.

## Testing

Vitest runs node tests (storage, API, importers, study engine, vault, starter pack) and jsdom tests (UI). Playwright
launches the built Electron app for the end-to-end flows, including an axe accessibility audit of every page in both
themes.
