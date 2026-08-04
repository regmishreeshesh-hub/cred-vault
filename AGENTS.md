# AGENTS.md

## Build & Run

```bash
go build -o cred-vault .          # build (no tests exist)
GOOS=linux GOARCH=amd64 go build -o cred-vault-linux .  # cross-compile
./cred-vault                       # https://127.0.0.1:9090 (auto-generates TLS cert)
./cred-vault -port 8080 -vault /path/to/vault.json      # custom config
```

No test, lint, or typecheck commands exist. Verify changes with `go build` only.

## Architecture Gotchas

- **Static files are embedded.** Frontend in `static/` is baked into the binary via `//go:embed` in `main.go`. You must rebuild the binary after editing any frontend file; there is no hot-reload.
- **Every write re-encrypts the whole vault.** All mutating API calls (`Add`, `Update`, `Delete`) call `vault.Save()` which re-encrypts and overwrites `vault.json` entirely.
- **TLS cert path is `~/.cred-vault/{cert,key}.pem`.** Generated on first run (10-year self-signed). If TLS binding fails, server falls back to plain HTTP on the same port.
- **Middleware blocks when locked.** Only `/api/status` and `/api/unlock` are accessible when the vault is locked. All other routes return `{ "status": "locked" }`.
- **`MasterPass` lives in memory** on `Handler` after unlock — passed to `vault.Save()` on every write. Locking wipes it.
- **`url` field is overloaded** on `Credential`: it's a URL for `web` type, a hostname for `ssh`, and a description for `iam`. Don't assume it's always a URL.
- **Domain lookup strips `www.`** and does subdomain-aware matching. The `/api/lookup` endpoint is used by a bookmarklet.

## Two Packages

- `vault/` — data model, encryption (AES-256-GCM + PBKDF2), file I/O, CRUD with mutex
- `handlers/` — HTTP handlers and middleware over `vault.Vault`
- `static/` — vanilla JS/HTML/CSS, no build step

## Credential Types

`web`, `ssh`, `iam`, `general`. The same `Credential` struct holds all types; unused fields are empty strings.

## CLAUDE.md

See [CLAUDE.md](./CLAUDE.md) for fuller architecture docs.
