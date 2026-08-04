# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Download dependencies
go mod download

# Build for current platform
go build -o cred-vault .

# Build Linux AMD64 binary
GOOS=linux GOARCH=amd64 go build -o cred-vault-linux .

# Run (opens browser at https://127.0.0.1:9090)
./cred-vault

# Run on a custom port or vault file
./cred-vault -port 8080 -vault /path/to/vault.json
```

There are no tests in this project.

## Architecture

The app is a single-process Go HTTP server. Static frontend files are embedded into the binary at compile time via `//go:embed static/*` in `main.go`.

**TLS**: On startup the server looks for a cert/key at `~/.cred-vault/{cert,key}.pem`, generating a 10-year self-signed cert on first run if absent, and serves over HTTPS. If binding TLS fails, it falls back to plain HTTP on the same port. HTTPS is required for the bookmarklet (see below) since browsers block mixed-content requests from HTTPS login pages to `http://127.0.0.1`; accept the self-signed cert warning once in-browser.

**Vault state machine**: The vault starts locked. Calling `POST /api/unlock` decrypts `vault.json` into memory and stores the master password in `Handler.MasterPass`. All mutating API calls re-encrypt and persist the entire `vault.json` on each write. Calling `POST /api/lock` wipes the in-memory data and clears the master password.

**Encryption** ([vault/crypto.go](vault/crypto.go)): AES-256-GCM with a key derived via PBKDF2-SHA256 (600,000 iterations). Each save generates a fresh random salt and nonce, so the ciphertext changes on every write even with the same data.

**vault.json** format ([vault/models.go](vault/models.go)): `{ salt, nonce, ciphertext }` — all base64-encoded bytes. The decrypted payload is a `VaultData` object (`{ "credentials": [...] }`) holding an array of `Credential` objects.

**Packages**:
- `vault/` — `Vault` struct with a `sync.Mutex`; all CRUD methods acquire the lock. `VaultExists`, `Unlock`, `Lock`, `Save`, `List`, `Add`, `Update`, `Delete`.
- `handlers/` — thin HTTP layer over `vault.Vault`. `Middleware` enforces the locked check (only `/api/status` and `/api/unlock` pass through when locked). The `Connect` handler launches a platform-appropriate terminal emulator for SSH credentials.
- `static/` — vanilla JS/HTML/CSS; no build step. `app.js` talks to the API and manages two screens (login, vault). Auto-lock timeout and clipboard-clear duration are persisted in `localStorage`.

**Credential types**: `web`, `ssh`, `iam`, `general`. The same `Credential` struct holds all types; irrelevant fields are left empty. The `url` field is overloaded — it holds the URL for web, hostname for SSH, and a description for IAM.

**Bookmarklet** (`/api/lookup`): Matches a domain against stored `web` credentials using subdomain-aware comparison after stripping `www.` prefixes, then the bookmarklet fills login form fields on the active page.
