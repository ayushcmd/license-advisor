# Security Policy & Architecture Controls

## 1. Security Model Overview

**Open Workers** operates with **zero persistent databases** and **zero client-side secret storage**. Every privileged GitHub mutation runs on the Node.js backend using short-lived installation access tokens minted on demand via `@octokit/app`.

---

## 2. Webhook Verification & Replay Protection (`src/routes/webhooks.js`)

1. **Raw Body Hashing:** `src/server.js` mounts `express.raw({ type: '*/*', limit: '1mb' })` on `/api/webhooks` **before** `express.json()`. `@octokit/webhooks` computes HMAC SHA-256 over the exact unparsed UTF-8 payload bytes against `X-Hub-Signature-256`.
2. **Fail-Closed Behavior:** If `GITHUB_WEBHOOK_SECRET` is unset, `POST /api/webhooks` returns `503 Service Unavailable`. Missing signatures or tampered payloads return `401 Unauthorized`. Missing `X-GitHub-Event` or `X-GitHub-Delivery` headers return `400 Bad Request`.
3. **Post-Auth Deduplication:** Duplicate delivery protection (`X-GitHub-Delivery` bounded `Set` capped at `1000` entries) executes **only after** HMAC verification passes. An unauthenticated sender cannot poison delivery IDs or block authentic retries.

---

## 3. Caller In-Memory Authorization (`src/core/github/authorize.js`)

- Mutation endpoints (`POST /api/trigger-pr`, `POST /api/community/trigger-pr`) require caller authorization.
- The caller passes a Personal Access Token in the `Authorization: Bearer <token>` header.
- The server checks the caller's collaborator permissions on the target repository (`admin`, `maintain`, or `write`).
- Tokens are held strictly in memory for the duration of the request and are never logged, cached, or saved to disk.

---

## 4. Private Key & Credential Handling (`src/config/github.js`)

- `.gitignore` strictly excludes `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `*.p12`, `*.crt`, `private-key*`, and `github-app-key*`.
- `loadPrivateKey()` validates PEM envelope headers (`-----BEGIN ... PRIVATE KEY-----`) from either `GITHUB_PRIVATE_KEY` (inline escaped `\n`) or `GITHUB_PRIVATE_KEY_PATH`.
- `GET /api/config` and `GET /api/health` return only public non-secret metadata (`appSlug`, `installUrl`, boolean readiness flags, and permission scopes).

---

## 5. Branch & Repository Mutation Safeguards

- **No Direct Default-Branch Writes:** Commits are written exclusively to an isolated feature branch (`chore/add-license-<spdx>` or `chore/add-community-files-*`).
- **Non-Overwrite Guarantee:** Before branching or committing, services inspect the default branch tree. If target files already exist, operations fail with `409 Conflict` unless explicit `replaceExisting: true` opt-in is provided.
- **Permission Verification:** Installation tokens are checked for `contents: write` and `pull_requests: write`; missing permissions return `403 Forbidden` cleanly.
- **Input Sanitization:** `parseRepoInput()` restricts owners/repos to `[A-Za-z0-9_.-]+` and blocks `.` / `..` traversal or non-`github.com` hosts. Form text is sanitized and length-capped.

---

## 6. Browser & HTTP Hardening (`src/server.js`, `public/js/app.js`)

- **Helmet CSP:** `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and `connect-src 'self' https://api.github.com`.
- **CORS Allowlist:** Configured via `ALLOWED_ORIGINS` (defaults to `APP_URL`).
- **XSS Prevention:** Client UI builds DOM nodes via `document.createElement` and `textContent` rather than injecting repository metadata into `innerHTML`. External links are verified against safe `https:` / `http:` protocols.

---

## 7. Reporting a Vulnerability

Please do not open public issues for suspected security vulnerabilities or leaked credentials. Contact the maintainer directly at **ayush_24a12res897@iitp.ac.in**.
