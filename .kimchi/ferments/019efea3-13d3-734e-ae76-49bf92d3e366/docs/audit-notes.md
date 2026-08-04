# Cred-Vault Codebase Audit — Transient Notes

---

## 1. main.go

### Security
- **HIGH** `generateSelfSignedCert()` (lines 117–161): All error paths silently return without propagating the failure. If cert/key generation fails (disk full, permission denied), the caller (`getTLSPaths()`) proceeds to return non-existent paths, causing a confusing runtime failure later.
- **MEDIUM** `generateSelfSignedCert()`: RSA key size is 2048 bits. Acceptable but 3072+ is recommended for long-lived certs (10 years here).
- **MEDIUM** `generateSelfSignedCert()`: `os.MkdirAll` uses `0700` but the `os.Create`/`os.OpenFile` calls that follow do not verify the actual file permissions if a pre-existing file has broader permissions.
- **LOW** `openBrowser()`: Errors from `exec.Command(...).Start()` are silently ignored. Not a security issue per se but masks failures.

### Correctness
- **MEDIUM** `generateSelfSignedCert()`: `certOut, err := os.Create(certPath)` — if creation succeeds but `pem.Encode` or `certOut.Close()` fails, the partial/corrupt cert file remains on disk.
- **LOW** `openBrowser()`: `exec.Command` arguments are not validated/sanitized.
- **INFO** Missing trailing newline at EOF (line 172).

### Code Quality
- **INFO** `DNSNames` and `IPAddresses` struct fields are misaligned compared to adjacent fields (gofmt flagged).

---

## 2. handlers/api.go

### Security
- **CRITICAL** `Connect()` (lines 173–256): Shell command injection via `req.Username`, `req.Host`, `req.Password`, `req.KeyFile`.
  - Line 224: `sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no %s -p %d %s@%s", identityArg, req.Port, req.Username, req.Host)` — `%s` values are interpolated directly into the shell command executed via `bash -c`.
  - Line 229: `termCmd := fmt.Sprintf("x-terminal-emulator -e bash -c '%s; exec bash'", sshCmd)` — single-quoted interpolation is fragile. A single quote in `req.Username` breaks quoting and allows arbitrary command execution.
  - Line 232: `copyCmd = fmt.Sprintf("echo -n '%s' | pbcopy 2>/dev/null || echo -n '%s' | xclip -selection clipboard 2>/dev/null; ", req.Password, req.Password)` — single quotes in the password will terminate the quoted string and inject arbitrary shell commands.
  - The `identityArg` (line 216) embeds a key file path inside double quotes: `fmt.Sprintf("-i \"%s\"", req.KeyFile)`. If the key file path contains a backslash or double quote, it could corrupt the command.
- **CRITICAL** `Connect()` Windows path (lines 202–219): PowerShell command construction uses string concatenation with user-controlled values (`req.Password`, `req.KeyFile`). `req.Password` single quotes are doubled (`strings.ReplaceAll(req.Password, "'", "''")`) but other PowerShell metacharacters (backticks, `$`) are not escaped, enabling command injection in PowerShell.
- **HIGH** `Middleware()` CORS (lines 353–360): `Access-Control-Allow-Origin: *` allows any origin to call the API. Because the vault runs on localhost and stores credentials, a malicious website could use XHR/fetch to enumerate or exfiltrate credentials via the `/api/lookup` or `/api/credentials` endpoints if the user has the vault unlocked and visits the malicious site in the same browser session.
- **MEDIUM** `Add()` (lines 106–122): `rand.Read(id)` error is ignored. If the system CSPRNG fails, the ID could be all zeros/predictable, leading to credential ID collisions.
- **MEDIUM** `Unlock()` (lines 71–90): On wrong password, returns HTTP 200 with a JSON error body. Should return HTTP 401 Unauthorized to aid clients and security monitoring.
- **MEDIUM** `Middleware()` locked response: Returns JSON-encoded lock response but does not set `Content-Type: application/json`.
- **LOW** `Lookup()` (lines 282–306): Domain matching uses `strings.HasSuffix(domain, "."+credDomain)` which could cause unexpected matches (e.g., `credDomain = "com"` would match any `.com` domain). Not exploitable with normal data but is a logic quirk.

### Correctness
- **MEDIUM** `Update()` (lines 138–154): `c.ID = id` is set inside the handler but the client-sent `c.ID` could already contain a different value — the handler overrides it silently.
- **LOW** `Middleware()` (line 357): `Access-Control-Allow-Private-Network: true` is only set on `OPTIONS` requests. Per spec, it should also be set on the actual request response.
- **LOW** `List()` (lines 97–100): Returns the credential slice directly — if the caller mutates it, the in-memory vault is not protected because `copy(out, v.Data.Credentials)` creates a shallow copy of the slice header but does not deep-copy the underlying `Credential` structs. Mutations to fields of returned credentials would affect the vault data.

### Code Quality
- **INFO** `statusResponse` struct tag alignment is off (gofmt flagged lines 26–29).
- **INFO** No input validation on `Credential` fields in `Add()` or `Update()` — empty title, type, URL are all accepted.
- **INFO** `rand.Read(id)` error ignored (line 115).

---

## 3. vault/crypto.go

### Security
- **INFO** PBKDF2 with 600,000 iterations and SHA-256 is a reasonable but not state-of-the-art choice. Modern guidance often recommends Argon2id. However, for a local password manager, PBKDF2-SHA256 with 600k is acceptable.
- **INFO** Salt size is 32 bytes, which is more than sufficient.
- **INFO** AES-256-GCM with random nonces is correct and safe.

### Correctness
- **INFO** `DecryptVault()` returns generic error "wrong master password or corrupted vault" which makes it impossible to distinguish between a bad password and actual file corruption.

### Code Quality
- **INFO** Clean, idiomatic Go. Proper use of standard library crypto packages.

---

## 4. vault/models.go

### Code Quality
- **INFO** `Credential` is a flat struct with fields for all credential types. This is simple but not type-safe — there's no compile-time enforcement that a `web` credential only has web-relevant fields populated.
- **INFO** Fields like `URL` are overloaded for different types (web URL, SSH hostname, IAM description). This reduces clarity.

---

## 5. vault/storage.go

### Security
- **MEDIUM** `Save()` (lines 48–63): `os.MkdirAll(filepath.Dir(v.FilePath), 0700)` error is ignored. If directory creation fails (e.g., permission denied), the subsequent `os.WriteFile` may fail with a confusing error or write to an unintended location.
- **LOW** `Save()`: `os.WriteFile` uses permission `0600`, which is good.

### Correctness
- **MEDIUM** `Lock()` (lines 41–46): Sets `v.Data = &VaultData{Credentials: []Credential{}}`. This allocates a new empty struct. The old struct with credentials is eligible for GC but may linger in memory depending on Go's GC behavior. For a security-sensitive app, explicitly zeroing old memory would be better (though not trivial in Go).
- **LOW** `List()` (lines 65–70): Shallow copy issue (see handlers/api.go note) — the copied slice points to the same underlying array as `v.Data.Credentials`. Callers can mutate credential fields in the returned slice, affecting the vault's internal state.

### Code Quality
- **INFO** `VaultExists()` uses `os.Stat` and checks `err == nil`. Could also check `!os.IsNotExist(err)` to distinguish "does not exist" from permission errors.

---

## 6. static/app.js

### Security
- **HIGH** `renderList()` (lines 120–160): HTML is built with string concatenation using `innerHTML`. While `esc()` escapes `& < > "`, it does NOT escape single quotes (`'`). If a credential field contains a single quote and is placed inside an HTML attribute context (e.g., `onclick="viewCredential('${c.id}')"`), it could break out of the attribute. In practice, IDs are hex strings, but if the ID generation fails (see `rand.Read` error ignored), or if other fields are used in attribute contexts, this is a risk.
- **HIGH** `renderList()`: `onclick` handlers are attached inline via string templates: `onclick="viewCredential('${c.id}')"`. If `c.id` is attacker-controlled (e.g., via a malicious credential import or ID collision), this is an XSS vector.
- **MEDIUM** `showBookmarkletModal()` (lines 310–340): The bookmarklet is built via string concatenation in JS and injected as an `href`. The bookmarklet itself uses `eval`-like behavior via JavaScript URLs. This is inherently risky but mitigated by the fact it only runs on user action.
- **LOW** `api()` (lines 78–90): If `data.locked` is true, it calls `showLogin()` but the fetch already completed. This could lead to TOCTOU issues if the vault locks between API calls.

### Correctness
- **MEDIUM** `unlock()` (lines 99–115): `confirmEl.style.display !== 'none'` is used to detect first-run mode. If the CSS or initial state changes, this logic could break.
- **LOW** `getHostPort()` (lines 306–316): Parses URL-like strings manually using `split('/')` and `split(':')` instead of the URL API. `host.includes('://') host.split('/')[2]` assumes a specific URL format and may mis-parse URLs with auth info or unusual schemes.
- **LOW** `buildCredBody()` (lines 390–430): `parseInt(document.getElementById('cred-port').value)` could return `NaN` if the input is non-numeric, resulting in `base.port = NaN` which serializes to JSON as `null`/`NaN` depending on JSON.stringify behavior.
- **LOW** `normalizeURL()` (lines 177–181): Only checks for `://` at the start after `[a-zA-Z][a-zA-Z0-9+-.]*://`, but `URL` constructor is not used. The regex does not handle all valid schemes correctly.

### Code Quality
- **INFO** Large file (~800 lines) with no modular structure, all global functions.
- **INFO** `esc()` does not escape single quotes (`'`), which is a common XSS gap.
- **INFO** Repeated `document.getElementById` lookups; no caching of DOM references.

---

## 7. static/index.html

### Security
- **LOW** The bookmarklet URL is dynamically set via JS string concatenation; the `href` starts as `#` but is replaced with dynamically generated JavaScript. If the JS generation is compromised, the bookmarklet becomes a persistent XSS vector in the user's bookmarks.

### Code Quality
- **INFO** Well-structured, semantic HTML with good accessibility attributes (`aria-*` not used but labels are clear).
- **INFO** `meta` tags for charset and viewport are present.

---

## 8. static/style.css

### Code Quality
- **INFO** Well-organized with CSS custom properties (design tokens), responsive breakpoints, and smooth transitions.
- **INFO** Heavy use of `!important` in some button variants (e.g., `.pw-toggle`, `.btn-secondary`). This is not a bug but could make future overrides difficult.
- **INFO** `@import` via Google Fonts CDN — if this is a local-only app, the fonts require an internet connection on first load.

---

## 9. go.mod

### Code Quality
- **INFO** `go 1.25.0` requires a cutting-edge Go version. This may prevent building on systems with older Go installations.

---

## 10. README.md

### Code Quality
- **INFO** Build instructions include both PowerShell and cross-compilation steps. Adequate for the project's scope.
- **INFO** Notes correctly explain the self-signed HTTPS requirement for the bookmarklet.

---

## Summary Matrix

| File | Critical | High | Medium | Low | Info |
|------|----------|------|--------|-----|------|
| main.go | 0 | 0 | 1 | 2 | 2 |
| handlers/api.go | 2 | 2 | 3 | 2 | 3 |
| vault/crypto.go | 0 | 0 | 0 | 0 | 3 |
| vault/models.go | 0 | 0 | 0 | 0 | 2 |
| vault/storage.go | 0 | 0 | 2 | 1 | 1 |
| static/app.js | 0 | 2 | 1 | 2 | 3 |
| static/index.html | 0 | 0 | 0 | 1 | 2 |
| static/style.css | 0 | 0 | 0 | 0 | 3 |
| go.mod | 0 | 0 | 0 | 0 | 1 |
| README.md | 0 | 0 | 0 | 0 | 1 |

**Total: 2 Critical, 4 High, 7 Medium, 9 Low, 21 Info**
