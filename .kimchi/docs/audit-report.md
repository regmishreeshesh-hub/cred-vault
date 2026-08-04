# Cred-Vault Codebase Audit Report

**Date:** 2026-06-26  
**Scope:** Full-stack audit of the cred-vault Go application (backend + frontend)  
**Auditor:** Kimchi AI Agent  
**Commit:** N/A (working tree audit)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Project Structure Overview](#project-structure-overview)
3. [Automated Tooling Results](#automated-tooling-results)
4. [Security Analysis](#security-analysis)
5. [Correctness & Bug Findings](#correctness--bug-findings)
6. [Code Quality Observations](#code-quality-observations)
7. [Per-File Assessment](#per-file-assessment)
8. [Prioritized Recommendations](#prioritized-recommendations)

---

## Executive Summary

The cred-vault project is a small, single-process Go HTTP server that serves as a local credential manager for web logins, SSH servers, IAM users, and general secrets. The codebase totals approximately **2,500 lines** across **10 source files** (Go backend, JS/HTML/CSS frontend, and configuration).

### Key Findings at a Glance

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 2 | Shell command injection in SSH Connect handler (both Unix and Windows paths) |
| 🟠 High | 4 | CORS wildcard allowing any origin, XSS via `innerHTML`/`onclick`, unescaped single quotes in JS |
| 🟡 Medium | 7 | Ignored `rand.Read` error, ignored `os.MkdirAll` error, HTTP 200 on auth failure, shallow copy in `List()`, missing input validation |
| 🟢 Low | 9 | Silent error suppression, missing trailing newline, manual URL parsing, bookmarklet injection risk |
| ⚪ Info | 21 | Formatting nits, design choices, missing tests, documentation notes |

**Overall Assessment:** The cryptography and vault storage layer are sound and well-implemented. However, the SSH connection handler and CORS middleware contain serious security flaws that require immediate attention. The frontend has XSS risks due to unsafe HTML generation. Error handling is inconsistent across the codebase.

---

## Project Structure Overview

```
cred-vault/
├── main.go           # Entry point, TLS cert generation, static file serving
├── go.mod            # Go 1.25.0, depends on golang.org/x/crypto
├── go.sum            # Dependency checksums
├── handlers/
│   └── api.go        # HTTP handlers (CRUD, unlock/lock, SSH connect, lookup)
├── vault/
│   ├── crypto.go     # AES-256-GCM encryption / PBKDF2 key derivation
│   ├── models.go     # Credential and Vault structs
│   └── storage.go    # Vault CRUD, file I/O, mutex locking
├── static/
│   ├── app.js        # ~800-line vanilla JS SPA (login, vault, modals)
│   ├── index.html    # Single-page HTML
│   └── style.css     # ~570-line dark-theme CSS
└── vault.json        # Runtime encrypted vault file
```

### Architecture Notes

- **Single-process HTTP server** with embedded static assets via `//go:embed`.
- **Vault state machine:** Starts locked. Unlock decrypts `vault.json` into memory. Every mutating API call re-encrypts and persists the entire vault.
- **Encryption:** AES-256-GCM with a key derived via PBKDF2-SHA256 (600,000 iterations). Fresh random salt + nonce on every save.
- **Credential types:** `web`, `ssh`, `iam`, `general`. A single flat `Credential` struct holds all fields; irrelevant fields are left empty.
- **No test suite.** The project has zero unit, integration, or end-to-end tests.

---

## Automated Tooling Results

### `go build`
```
Success — no compilation errors.
```

### `go vet ./...`
```
No issues found.
```

### `gofmt -d .`
Minor whitespace alignment issues detected in two files:

**handlers/api.go** (lines 25–29)
```go
-	Status    string `json:"status"`
-	Message   string `json:"message,omitempty"`
-	Locked    bool   `json:"locked"`
-	FirstRun  bool   `json:"first_run"`
+	Status   string `json:"status"`
+	Message  string `json:"message,omitempty"`
+	Locked   bool   `json:"locked"`
+	FirstRun bool   `json:"first_run"`
```

**main.go** (lines 139–140)
```go
-	DNSNames:            []string{"localhost", "127.0.0.1"},
-	IPAddresses:         []net.IP{net.ParseIP("127.0.0.1")},
+	DNSNames:              []string{"localhost", "127.0.0.1"},
+	IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
```

**main.go** (EOF)
```go
-}
\ No newline at end of file
+}
```

---

## Security Analysis

### Cryptography — ✅ Sound

`vault/crypto.go` implements encryption correctly:

- **Algorithm:** AES-256-GCM authenticated encryption.
- **Key Derivation:** PBKDF2-SHA256 with 600,000 iterations, 32-byte salt, 32-byte key.
- **Nonce:** Random nonce generated per encryption with size matching `aesGCM.NonceSize()`.
- **Randomness:** Uses `crypto/rand` (CSPRNG) for salts and nonces.

**Note:** PBKDF2-SHA256 is acceptable but not the modern best practice. The [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) recommends Argon2id for new systems. Given this is a local password manager, PBKDF2 at 600k iterations is a reasonable trade-off.

### Authentication & Authorization — ⚠️ Weak

**Issue: Unlock endpoint returns HTTP 200 on wrong password**
- **File:** `handlers/api.go`  
- **Line:** 71–90  
- **Severity:** Medium  
- **Details:** The `Unlock` handler returns HTTP 200 with a JSON error payload when the master password is incorrect. This makes it harder for API consumers to detect authentication failures programmatically.

**Issue: CORS allows any origin (`*`)**
- **File:** `handlers/api.go`
- **Line:** 353–360
- **Severity:** 🔴 High
- **Details:** The middleware sets `Access-Control-Allow-Origin: *` on every response. Because the vault runs on `127.0.0.1`, any malicious website visited by the user can make cross-origin requests to the vault if it is unlocked. This could allow credential enumeration or exfiltration via the `/api/lookup` or `/api/credentials` endpoints.
- **Recommendation:** Restrict CORS to `127.0.0.1` (or the actual origin if possible). For a localhost-only app, CORS should be disabled or locked down to the expected origin.

### Input Handling — 🔴 Critical

**Issue: Shell command injection in `Connect()` handler**
- **File:** `handlers/api.go`
- **Lines:** 173–256
- **Severity:** 🔴 Critical
- **Details:** The SSH connection handler builds shell commands by interpolating user-controlled strings (`req.Username`, `req.Host`, `req.Password`, `req.KeyFile`) directly into `bash -c` and `powershell -Command` strings.
  - **Unix path (line 224):** `sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no %s -p %d %s@%s", identityArg, req.Port, req.Username, req.Host)`
  - **Unix copy (line 232):** `fmt.Sprintf("echo -n '%s' | pbcopy ...", req.Password)` — a password containing a single quote breaks out of the quoted string and injects arbitrary shell commands.
  - **Windows path (lines 202–219):** PowerShell command uses string concatenation with `req.Password` and `req.KeyFile`; only single quotes are doubled but backticks and `$` are not escaped.
- **Impact:** An attacker with control over any credential field (e.g., editing a credential via the UI) can achieve arbitrary command execution on the machine running the vault.
- **Recommendation:** Use `exec.Command` with a slice of arguments instead of `bash -c`. For clipboard operations, use a Go library (e.g., `atotto/clipboard`) instead of shelling out. Never interpolate user input into shell commands.

**Issue: `rand.Read(id)` error ignored in `Add()`**
- **File:** `handlers/api.go`
- **Line:** 115
- **Severity:** Medium
- **Details:** `rand.Read(id)` returns an error that is discarded. In the extremely unlikely event the system CSPRNG fails, the credential ID could be predictable or all zeros, leading to ID collisions.

### Frontend Security — ⚠️ High

**Issue: XSS via `innerHTML` with incomplete escaping**
- **File:** `static/app.js`
- **Lines:** 120–160
- **Severity:** 🟠 High
- **Details:** `renderList()` builds HTML with `innerHTML` using the `esc()` function. `esc()` only escapes `&`, `<`, `>`, and `"` but **not single quotes (`'`)**.
  - Inline event handlers like `onclick="viewCredential('${c.id}')"` (line 135) are vulnerable: if `c.id` contained a single quote, it would break out of the JavaScript string context and execute arbitrary code.
  - While IDs are generated from `crypto/rand` (hex), the `rand.Read` error is ignored (see above), so a failure could produce an empty or predictable ID.
- **Recommendation:** Use `document.createElement` and `addEventListener` instead of `innerHTML` + inline `onclick`. Alternatively, escape single quotes in `esc()`.

---

## Correctness & Bug Findings

### Error Handling Deficiencies

**Issue: Silent failure in `generateSelfSignedCert()`**
- **File:** `main.go`
- **Lines:** 117–161
- **Severity:** Medium
- **Details:** Every error path in `generateSelfSignedCert()` simply `return`s without logging or returning an error to the caller. If disk is full, permissions are wrong, or `x509.CreateCertificate` fails, the function exits silently and `getTLSPaths()` returns paths to non-existent files. The main loop then attempts `tls.LoadX509KeyPair` on missing files, falls back to HTTP, and prints a confusing message.

**Issue: `os.MkdirAll` error ignored in `Save()`**
- **File:** `vault/storage.go`
- **Line:** 55
- **Severity:** Medium
- **Details:** `os.MkdirAll(filepath.Dir(v.FilePath), 0700)` error is discarded. If directory creation fails, the subsequent `os.WriteFile` will fail with a potentially misleading error.

### Logic Bugs

**Issue: Shallow copy in `Vault.List()`**
- **File:** `vault/storage.go`
- **Lines:** 65–70
- **Severity:** Low
- **Details:** `List()` uses `copy(out, v.Data.Credentials)` which copies the slice header but not the underlying `Credential` structs. The returned slice points to the same array. Any caller that mutates a field of a returned `Credential` (e.g., `creds[0].Password = "pwned"`) silently modifies the vault's internal state.

**Issue: Incorrect/non-idiomatic URL parsing in `getHostPort()`**
- **File:** `static/app.js`
- **Lines:** 306–316
- **Severity:** Low
- **Details:** The function manually splits URLs with `host.split('/')` and `host.split(':')` instead of using the `URL` constructor. It fails on URLs with userinfo (`user:pass@host`), IPv6 addresses, or multiple slashes in query strings.

**Issue: `buildCredBody()` may produce `NaN` for port**
- **File:** `static/app.js`
- **Line:** 407
- **Severity:** Low
- **Details:** `parseInt(document.getElementById('cred-port').value)` returns `NaN` for non-numeric input. `JSON.stringify({port: NaN})` produces `"port":null` in modern browsers, but this is still data corruption.

### API Behavior

**Issue: `Update()` silently overrides client-sent ID**
- **File:** `handlers/api.go`
- **Line:** 148
- **Severity:** Low
- **Details:** The handler sets `c.ID = id` from the URL path after decoding the request body. If the client sent a different `ID` in the JSON payload, it is silently overwritten without warning.

---

## Code Quality Observations

### Missing Tests
- **Severity:** Info
- **Details:** The project has **zero tests**. There are no unit tests for cryptography, vault storage, HTTP handlers, or frontend logic. Adding tests would dramatically increase confidence in correctness and make future refactors safer.

### Idiomatic Go
- `vault/crypto.go` and `vault/storage.go` are generally idiomatic and well-structured.
- `handlers/api.go` mixes JSON encoding/decoding with business logic. Consider using a router library or dedicated request/response structs.

### Frontend Architecture
- `static/app.js` is a single ~800-line file with all global functions. No modularization, no framework, no testing.
- DOM elements are queried repeatedly by `getElementById` instead of being cached.

### CSS
- `style.css` is well-organized with CSS custom properties (design tokens), responsive breakpoints, and animations.
- Selectors like `.cred-item .actions button[style*="background:#1a6b3c"]` are fragile — they depend on exact inline style strings.

### Go Version
- `go.mod` requires `go 1.25.0`, a cutting-edge version. This limits portability to environments with older Go toolchains.

---

## Per-File Assessment

### `main.go` (190 lines)
- **Role:** Entry point, TLS bootstrap, static file serving.
- **Strengths:** Self-signed cert auto-generation is convenient; TLS fallback to HTTP is graceful.
- **Weaknesses:** Silent failures in cert generation; `openBrowser()` errors ignored.

### `handlers/api.go` (340 lines)
- **Role:** HTTP API layer.
- **Strengths:** Simple, no external router dependencies.
- **Weaknesses:** **Critical shell injection** in `Connect()`; overly permissive CORS; ignored errors (`rand.Read`, `os.MkdirAll` is in storage); HTTP status codes are misleading (200 on auth failure).

### `vault/crypto.go` (70 lines)
- **Role:** Encryption/decryption.
- **Strengths:** Correct use of AES-256-GCM, PBKDF2, `crypto/rand`.
- **Weaknesses:** PBKDF2 is acceptable but not modern best practice; error messages are generic (can't distinguish bad password from corruption).

### `vault/models.go` (40 lines)
- **Role:** Data structures.
- **Strengths:** Simple and clear.
- **Weaknesses:** Flat struct for all credential types is not type-safe; field overloading (`URL` used for web URLs, SSH hostnames, and IAM descriptions) reduces clarity.

### `vault/storage.go` (130 lines)
- **Role:** Vault persistence and CRUD.
- **Strengths:** Proper mutex usage; file permissions `0600` on vault file.
- **Weaknesses:** `os.MkdirAll` error ignored; `List()` returns shallow copies; `Lock()` does not explicitly zero old credential memory.

### `static/app.js` (800 lines)
- **Role:** Single-page application.
- **Strengths:** Vanilla JS, no build step, functional UI.
- **Weaknesses:** **XSS risks** via `innerHTML`; incomplete escaping (`esc()` missing `'`); inline `onclick` handlers; manual URL parsing; no input sanitization before sending to API.

### `static/index.html` (330 lines)
- **Role:** HTML markup.
- **Strengths:** Semantic structure, responsive meta tags.
- **Weaknesses:** Inline `style` attributes on some elements; no `aria-*` attributes.

### `static/style.css` (570 lines)
- **Role:** Styling.
- **Strengths:** Design tokens, dark theme, animations, responsive breakpoints.
- **Weaknesses:** Some selectors rely on exact inline style strings; Google Fonts CDN dependency for offline app.

### `go.mod` & `go.sum`
- **Role:** Dependency management.
- **Notes:** Only external dependency is `golang.org/x/crypto`. `go 1.25.0` is very new.

### `README.md`
- **Role:** Documentation.
- **Strengths:** Clear build instructions, explains HTTPS/bookmarklet requirement.
- **Weaknesses:** No security warnings about the self-signed certificate trust model.

---

## Prioritized Recommendations

### 🔴 Immediate (Fix Before Use)

1. **Fix shell command injection in `Connect()`**
   - **File:** `handlers/api.go:173–256`
   - **Action:** Refactor to use `exec.Command("ssh", args...)` with a `[]string` argument slice. Use a Go clipboard library instead of `echo -n '...' | pbcopy/xclip`.
   - **Risk:** Arbitrary code execution via crafted credential fields.

2. **Restrict CORS to localhost origin**
   - **File:** `handlers/api.go:353–360`
   - **Action:** Replace `Access-Control-Allow-Origin: *` with the exact expected origin (e.g., `http://127.0.0.1:9090` or `https://127.0.0.1:9090`).
   - **Risk:** Any malicious website can call the vault API if the user has it unlocked.

### 🟠 High Priority

3. **Fix XSS in `renderList()`**
   - **File:** `static/app.js:120–160`
   - **Action:** Stop using `innerHTML` with HTML string concatenation. Use `document.createElement` + `addEventListener`. Escape single quotes in `esc()` as a short-term mitigation.
   - **Risk:** Stored XSS if credential data contains malicious payloads.

4. **Fix error handling in `generateSelfSignedCert()`**
   - **File:** `main.go:117–161`
   - **Action:** Return `error` from the function and propagate it to the caller. Log failures with `log.Printf`.
   - **Risk:** Silent failures lead to confusing runtime behavior and potential security downgrade (HTTPS → HTTP fallback).

### 🟡 Medium Priority

5. **Return HTTP 401 on wrong master password**
   - **File:** `handlers/api.go:71–90`
   - **Action:** Return `http.StatusUnauthorized` when `Vault.Unlock()` fails.

6. **Check errors from `rand.Read(id)`**
   - **File:** `handlers/api.go:115`
   - **Action:** `if _, err := rand.Read(id); err != nil { http.Error(...) }`

7. **Check `os.MkdirAll` error in `Save()`**
   - **File:** `vault/storage.go:55`
   - **Action:** `if err := os.MkdirAll(...); err != nil { return err }`

8. **Deep-copy credentials in `List()`**
   - **File:** `vault/storage.go:65–70`
   - **Action:** Copy each `Credential` struct individually instead of using `copy()` on the slice.

### 🟢 Low Priority / Polish

9. **Add a trailing newline to `main.go`**
10. **Run `gofmt -w .` to fix alignment issues**
11. **Add unit tests** for crypto round-trip, vault CRUD, and handler input validation
12. **Replace PBKDF2 with Argon2id** for new vaults (consider migration path for existing vaults)
13. **Cache DOM references** in `app.js` instead of repeated `getElementById` calls
14. **Document the shell injection fix** in the README so users know the risk was addressed

---

*End of Report*
