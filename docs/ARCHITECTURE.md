# Architecture Overview

GitHub License Advisor is designed around a **lightweight, stateless, database-free architecture** pairing a zero-build static frontend with a focused Node.js Express + Octokit backend.

## 1. Design Principles

1. **Zero Database Persistence:** No PostgreSQL, MongoDB, SQLite, Redis, or Prisma. Repository details are queried on demand from GitHub REST APIs, and static SPDX license definitions reside in version-controlled JavaScript modules.
2. **Single Source of Truth (Shared ES6 Modules):** The browser frontend and Node.js backend both import the exact same pure ES6 modules from `public/js/` (`catalog-data.js`, `engine.js`, `generator.js`, `analyzer.js`). Recommendation logic, compatibility rules, and license text formatting never drift between client and server.
3. **Policy-First Licensing Evaluation:** The recommendation engine never guesses licenses from programming languages. It evaluates permissions, distribution obligations, copyleft boundaries, explicit patent grants/retaliation, non-endorsement clauses, network-use triggers, and inbound dependency compatibility.
4. **Least-Privilege GitHub App Automation:** Automated repository mutations occur exclusively on dedicated feature branches (`chore/add-license-<spdx>`) via reviewable Pull Requests. The server refuses (`409 Conflict`) to overwrite any existing `LICENSE` or `LICENSE.md` file.

## 2. System Components

```text
+-------------------------------------------------------------------+
| Browser Client (public/*.html + public/css/* + public/js/app.js)  |
| - Explorer, Policy Wizard, Comparison Matrix, Repo Analyzer, App  |
+---------------------------+---------------------------------------+
                            | HTTPS / JSON (CSP enforced)
                            v
+-------------------------------------------------------------------+
| Express Server (src/server.js)                                    |
| - Helmet CSP + CORS                                               |
| - Raw Body Middleware -> /api/webhooks (src/routes/webhooks.js)   |
| - JSON Body Middleware -> /api/* (src/routes/api.js)              |
| - Static File Hosting -> public/                                  |
+-------------+---------------------------------+-------------------+
              |                                 |
              v                                 v
+---------------------------+     +---------------------------------+
| Shared Policy Core        |     | GitHub App Runtime              |
| - catalog-data.js (12 SPDX)|    | - src/config/github.js          |
| - engine.js               |     |   (@octokit/app + @octokit/rest)|
| - generator.js            |     | - src/services/licenseService.js|
| - analyzer.js             |     | - src/services/prService.js     |
+---------------------------+     +----------------+----------------+
                                                   |
                                                   v
                                      GitHub REST API & Webhooks
```

## 3. Shared ES6 Module Layer (`public/js/`)

| Module | Responsibility | Consumed By |
| :--- | :--- | :--- |
| `catalog-data.js` | Verified metadata, flags, glossary, and official texts for 12 OSI-approved SPDX licenses | Browser UI, `engine.js`, `api.js`, `licenseService.js` |
| `engine.js` | Deterministic policy evaluation (`recommendLicenses`), dependency compatibility (`checkCompatibility`, `auditCompatibility`), `explainLicense`, `compareLicenses` | Browser UI, `licenseService.js`, `tests/engine.test.js` |
| `generator.js` | Validated year/holder template replacement (`generateLicenseText`, `generateFileHeader`, `generateLicensePackage`) | Browser UI, `licenseService.js`, `tests/engine.test.js` |
| `analyzer.js` | Repo specifier parsing (`parseRepoInput`), root tree inspection (`inspectRootEntries`), audit builder (`buildAuditReport`), browser REST client (`analyzePublicRepository`) | Browser UI, `licenseService.js`, `prService.js`, `tests/analyzer.test.js` |
| `app.js` | DOM controller using `textContent`/DOM nodes and URL validation (zero `innerHTML` interpolation) | All HTML pages in `public/` |

## 4. Backend & GitHub App Lifecycle (`src/`)

### Request Routing Order (`src/server.js`)
1. `helmet` attaches Content Security Policy (`script-src 'self'`, `connect-src 'self' https://api.github.com`, `object-src 'none'`, `frame-ancestors 'none'`) and security headers.
2. `cors` enforces `ALLOWED_ORIGINS`.
3. `POST /api/webhooks` runs `express.raw({ type: '*/*', limit: '1mb' })` **before** `express.json()` so `@octokit/webhooks` hashes exact unparsed payload bytes against `X-Hub-Signature-256`.
4. `express.json()` parses standard API calls (`/api/recommend`, `/api/analyze`, `/api/trigger-pr`).
5. Static assets from `public/` are served with clean `.html` extension resolution.

### Automated Pull Request Flow (`src/services/prService.js`)
1. `validatePrRequest()` parses `owner/repo`, resolves the SPDX license, and formats `LICENSE` strictly (requiring a copyright holder for `MIT`, `ISC`, `BSD-2-Clause`, and `BSD-3-Clause`).
2. `githubContext.resolveRepoInstallation(owner, repo)` checks `@octokit/app` installation status and verifies `contents: write` and `pull_requests: write` permissions.
3. `detectExistingLicenseOnBranch()` inspects the default branch root tree and `/license` endpoint; any existing license file triggers `409 Conflict` (`LICENSE_EXISTS`).
4. `git.getRef` resolves the default branch SHA, and `git.createRef` creates `chore/add-license-<spdx>` (never mutating the default branch directly).
5. `repos.createOrUpdateFileContents` commits `LICENSE` to the feature branch.
6. `pulls.create` opens a Pull Request detailing permissions, conditions, limitations, copyleft scope, patent terms, network-use triggers, and official SPDX links.

