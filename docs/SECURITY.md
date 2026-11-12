# Security Policy & Architecture Controls

## 1. Security Model Overview

GitHub License Advisor operates with **zero persistent databases** and **zero client-side secret storage**. Every privileged GitHub mutation runs on the Node.js backend using short-lived installation access tokens minted on demand via `@octokit/app`.

## 2. Webhook Verification & Replay Protection (`src/routes/webhooks.js`)

1. **Raw Body Hashing:** `src/server.js` mounts `express.raw({ type: '*/*', limit: '1mb' })` on `/api/webhooks` **before** `express.json()`. `@octokit/webhooks` computes HMAC SHA-256 over the exact unparsed UTF-8 payload bytes against `X-Hub-Signature-256`.
2. **Fail-Closed Behavior:** If `GITHUB_WEBHOOK_SECRET` is unset, `POST /api/webhooks` returns `503 Service Unavailable`. Missing signatures or tampered payloads return `401 Unauthorized`. Missing `X-GitHub-Event` or `X-GitHub-Delivery` headers return `400 Bad Request`.
3. **Post-Auth Deduplication:** Duplicate delivery protection (`X-GitHub-Delivery` bounded `Set` capped at `1000` entries) executes **only after** HMAC verification passes. An unauthenticated sender cannot poison delivery IDs or block authentic retries.

## 3. Private Key & Credential Handling (`src/config/github.js`)

- `.gitignore` strictly excludes `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `*.p12`, `*.crt`, `private-key*`, and `github-app-key*`.
- `loadPrivateKey()` validates PEM envelope headers (`-----BEGIN ... PRIVATE KEY-----`) from either `GITHUB_PRIVATE_KEY` (inline escaped `\n`) or `GITHUB_PRIVATE_KEY_PATH`.
- `GET /api/config` and `GET /api/health` return only public non-secret metadata (`appSlug`, `installUrl`, boolean readiness flags, and permission scopes).

## 4. Branch & Repository Mutation Safeguards (`src/services/prService.js`)

- **No Direct Default-Branch Writes:** Commits are written exclusively to an isolated feature branch (`chore/add-license-<spdx>`).
- **Non-Overwrite Guarantee:** Before branching or committing, `detectExistingLicenseOnBranch()` inspects the default branch root tree and `/license` endpoint; if any license file exists, the service aborts with `409 Conflict` (`LICENSE_EXISTS`).
- **Permission Verification:** Installation tokens are checked for `contents: write` and `pull_requests: write`; missing permissions return `403 Forbidden` cleanly.
- **Input Sanitization:** `parseRepoInput()` restricts owners/repos to `[A-Za-z0-9_.-]+` and blocks `.` / `..` traversal or non-`github.com` hosts. `normalizeGeneratorOptions()` strips control characters/newlines from copyright holder fields and validates `YYYY` / `YYYY-YYYY` year formats.

## 5. Browser & HTTP Hardening (`src/server.js`, `public/js/app.js`)

- **Helmet CSP:** `script-src 'self'` (zero inline `<script>` tags across all 8 HTML5 pages), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and `connect-src 'self' https://api.github.com`.
- **CORS Allowlist:** Configured via `ALLOWED_ORIGINS` (defaults to `APP_URL`).
- **XSS Prevention:** Client UI builds DOM nodes via `document.createElement` and `textContent` rather than injecting repository metadata or query parameters into `innerHTML`. External links are verified against `https:` / `http:` protocols via `isSafeHttpUrl()`.

## 6. Reporting a Vulnerability

Please do not open public issues for suspected security vulnerabilities or leaked credentials. Contact the maintainer directly at **ayush_24a12res897@iitp.ac.in**.

