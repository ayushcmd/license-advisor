# Open Workers — Architecture Overview

Open Workers is designed around a **lightweight, stateless, database-free architecture** pairing a zero-build static frontend with a focused Node.js Express + Octokit backend.

---

## 1. Design Principles

1. **Zero Database Persistence:** No PostgreSQL, MongoDB, SQLite, Redis, or Prisma. Repository state and file trees are inspected on demand from GitHub REST APIs, and customer source code or tokens are never stored on disk.
2. **Inspect &rarr; Recommend &rarr; Act:** All workflows follow a consistent, non-destructive cycle:
   - *Inspect:* Scan default branches and configuration files on demand.
   - *Recommend:* Provide deterministic health scores and plain-language guidance.
   - *Act:* Submit verified, isolated Pull Requests on dedicated feature branches (`chore/*`).
3. **Single Source of Truth (Shared ES6 Modules):** The browser frontend and Node.js backend both import pure ES6 modules from `public/js/` (`catalog-data.js`, `capabilities.js`, `engine.js`, `generator.js`, `analyzer.js`). Recommendation logic, compatibility rules, and templates never drift between client and server.
4. **Least-Privilege GitHub App Automation:** Repository mutations occur exclusively on dedicated feature branches via reviewable Pull Requests. The server refuses (`409 Conflict`) to overwrite existing files on default branches without explicit `replaceExisting: true` opt-in.
5. **In-Memory Caller Authorization:** Privileged endpoints verify caller write permissions via personal access tokens evaluated in memory only.

---

## 2. System Architecture

```text
+-------------------------------------------------------------------------------+
| Browser Client (public/*.html + public/css/* + public/js/*)                   |
| - Home, Community Standards, Explorer, Wizard, Comparator, Analyzer, Setup    |
+---------------------------------------+---------------------------------------+
                                        | HTTPS / JSON (CSP enforced)
                                        v
+-------------------------------------------------------------------------------+
| Express Server (src/server.js)                                                |
| - Helmet CSP + CORS                                                           |
| - Raw Body Middleware -> /api/webhooks (src/routes/webhooks.js)               |
| - JSON Body Middleware -> /api/* (src/routes/api.js)                          |
| - Static File Hosting -> public/                                              |
+-------------------+-----------------------------------+-----------------------+
                    |                                   |
                    v                                   v
+-----------------------------------+   +---------------------------------------+
| Capability Modules & Core Engine  |   | GitHub App Runtime & Shared Services  |
| - Licensing Module (engine, data) |   | - src/config/github.js (@octokit/app) |
| - Community Module (engine, docs) |   | - src/core/github/authorize.js        |
| - Capability Registry (6 modules) |   | - src/core/pullRequests/ (branches,   |
| - Repository Service (analyzer)   |   |   files commit engine)                |
+-----------------------------------+   +-------------------+-------------------+
                                                            |
                                                            v
                                                GitHub REST API & Webhooks
```

---

## 3. Core Modules & Directory Layout

| Directory / File | Responsibility |
| :--- | :--- |
| `public/` | Static HTML5 pages, modular CSS design tokens, browser controllers, and official branding SVGs/PNGs |
| `public/js/capabilities.js` | Single source of truth for the six product capabilities and statuses |
| `src/config/github.js` | GitHub App credential loading, PEM private key parsing, and Octokit client initialization |
| `src/core/capabilities/` | Capability discovery and module metadata re-exports |
| `src/core/github/authorize.js` | In-memory caller token identity verification and repository write permission check |
| `src/core/pullRequests/` | Shared isolated branch creation (`branches.js`) and multi-file commit engine (`files.js`) |
| `src/core/repository/` | Repository specifier parsing and root tree inspection service |
| `src/modules/community/` | Document generation engine, issue & PR templates, and community PR service |
| `src/services/` | Licensing recommendation engine, comparator, analyzer, and license PR service |
| `src/routes/` | Public REST API (`api.js`) and HMAC-verified webhook receiver (`webhooks.js`) |

---

## 4. Backend & GitHub App Lifecycle (`src/`)

### Request Routing Order (`src/server.js`)
1. `helmet` attaches Content Security Policy (`script-src 'self'`, `connect-src 'self' https://api.github.com`, `object-src 'none'`, `frame-ancestors 'none'`) and security headers.
2. `cors` enforces `ALLOWED_ORIGINS` (defaults to `APP_URL`).
3. `POST /api/webhooks` runs `express.raw({ type: '*/*', limit: '1mb' })` **before** `express.json()` so `@octokit/webhooks` hashes exact unparsed payload bytes against `X-Hub-Signature-256`.
4. `express.json()` parses standard API calls (`/api/recommend`, `/api/analyze`, `/api/trigger-pr`, `/api/community/*`).
5. Static assets from `public/` are served with clean `.html` extension resolution.
