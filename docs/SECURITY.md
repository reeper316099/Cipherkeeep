# Security and privacy

Cipherkeep is a local-first desktop app. This page says what it protects, what it does not, and how to check.

## What stays on your computer

- Everything: notes, commands, progress, settings, backups. There are no accounts, no telemetry, no update pings.
- The desktop window talks only to a small server inside the app on `127.0.0.1`. Every request needs a random token
  that is created at launch and handed to the window directly (never written to disk). Requests whose `Host` is not
  a loopback name are refused (DNS-rebinding guard).
- The window is sandboxed with context isolation. Any request to a non-loopback address is cancelled and all
  permission prompts (camera, location, …) are denied. Links open in your browser only after you click them.
- Markdown is sanitised before it is shown; remote images are not loaded.

## The one optional network feature

**Import from the Notion API** is off by default (Settings → Privacy). When on, and only while an import is running,
the server (not the window) calls `https://api.notion.com/v1/…` with the integration token you paste.

- The token is kept in memory for the length of the job. It is never written to disk, logged, put in a URL, or
  returned by the API. A test asserts it appears nowhere in the data folder.
- Requests are paced to Notion's average limit and retry politely. Files and images hosted by Notion are **not**
  downloaded, so no other host is contacted.
- The result goes through the same preview, merge strategies and undo as a Notion export.

## Encryption at rest (optional)

Settings → Security → Encrypt my library.

- **What is encrypted:** every file Cipherkeep writes in the data folder except `meta.json` (app name and version),
  `vault.json` (salts and wrapped keys) and the `exports/` and `logs/` folders: all JSON shards, settings, notes,
  attachments, study and activity logs, import records and backups. Note file names are replaced by their id
  (`data/notes/_enc/<id>.md`) so titles and folders are hidden too.
- **How:** a random 256-bit master key encrypts each file separately with AES-256-GCM (a fresh random IV every
  write, so identical content never looks identical, and any tampering is detected). The master key is stored
  wrapped under two independent keys derived with scrypt (N=2^15, r=8, p=1): one from your passphrase and one from a
  generated recovery key. Changing the passphrase re-wraps the key; no data is rewritten.
- **Lost passphrase:** there is no account and no reset. Without the passphrase **or** the recovery key the data
  cannot be recovered. The recovery key is shown once when you turn encryption on (or make a new one).
- **Locked state:** the app starts locked and the API answers `423 Locked` until you unlock. Wrong guesses are
  slowed down after five tries. "Lock now" closes the library and drops the key from memory.
- **Backups:** backups made while encryption is on are encrypted. Older plaintext backups are deleted when you turn
  it on (a checkbox, on by default). Backups made while encrypted need the passphrase to restore, even if you later
  turn encryption off.
- **Not covered:** a running, unlocked app (the key and the decrypted data are in memory); files you export on
  purpose (they are plain); the operating system's own copies (swap, clipboard history, indexing); an attacker who
  already controls your account while the app is unlocked. File names under `attachments/` and the shard layout
  reveal roughly how much you have, not what it says.
- **Integrity:** files are individually authenticated, but an attacker with write access could swap or delete whole
  files. This protects confidentiality, not against a hostile file system.

## Stored scripts and flags

Version 1 never executes anything you store. Lab flags are not stored unless you turn that on, and are left out of
search and exports.

## Sensitive values while you work

Placeholder values you mark sensitive stay in memory only. **Blur mode** (Ctrl/Cmd+Shift+B) blurs note bodies,
writeups, snippet code and placeholder values for screen sharing; hover or focus reveals a field.

## The public repository

`private-fixtures/` is ignored from the first commit and a guard (`npm run guard`, also a pre-commit hook and CI step)
blocks accidental commits of private material. Test fixtures are invented.

## Reporting a problem

Open an issue on the repository without including real notes, tokens or recovery keys.
