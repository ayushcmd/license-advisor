# Open Workers — Architecture Review & Security Model

This document outlines the architectural patterns, shared infrastructure, security model, and engineering decisions implemented across **Open Workers**.

---

## 1. Architectural Principles

Open Workers is built around strict operational and architectural guidelines:

1. **Database-Free & Stateless:**
   - The application does not maintain an internal database.
   - All state is derived directly from GitHub via the GitHub REST API (`@octokit/rest` and `@octokit/app`).
   - User tokens and private keys are never stored on disk or logged.
2. **Standard Modern Stack:**
   - **Runtime:** Node.js 20+ (ES6 modules exclusively).
   - **Framework:** Express.js 5 with Helmet security headers and strict CSP.
   - **Client:** Vanilla HTML5, CSS3, and ES6 JavaScript (Primer-inspired, zero heavyweight frontend frameworks).
   - **Testing:** Node.js native `node:test` and `node:assert/strict` (zero external test runner dependencies).
3. **Least-Privilege Isolation:**
   - GitHub App requires only two repository permissions: `contents: write` and `pull_requests: write`.
   - All mutations take place on dedicated, isolated feature branches (`chore/*`). The default branch is never modified directly.
   - Conflict detection prevents silent overwrites; explicit replacement opt-in (`replaceExisting: true`) is required.

---

## 2. Directory Layout & Core Modules

```
open-workers/
├── public/                     # Static frontend assets
│   ├── assets/                 # SVGs (logo.svg, workflow.svg, etc.)
│   ├── css/                    # Modular CSS (base.css, components.css)
│   ├── js/                     # Client ES6 modules (community.js, security.js, documentation.js, etc.)
│   ├── index.html              # Home page
│   ├── community.html          # Community standards, audit, and PR workflow
│   ├── security.html           # Security configuration audit, generators, and PR workflow
│   ├── documentation.html       # Documentation audit, README tools, changelog, badges, link checker
│   ├── analyzer.html           # Repository license inspector
│   ├── explorer.html           # SPDX license catalog explorer
│   ├── questionnaire.html      # Deterministic licensing recommendation engine
│   ├── compare.html            # Side-by-side license comparison tool
│   └── app-install.html        # GitHub App installation and license PR guide
├── src/
│   ├── config/                 # Environment variables and GitHub App config
│   ├── core/                   # Shared infrastructure across all modules
│   │   ├── capabilities/       # Capability registry (registry.js)
│   │   ├── github/             # GitHub authentication and caller authorization (authorize.js)
│   │   ├── pullRequests/       # Reusable branch creation and multi-file commits (branches.js, files.js)
│   │   └── repository/         # Repository specifier parsing and tree inspection
│   ├── data/                   # SPDX license database (licenses.json)
│   ├── modules/                # Feature modules
│   │   ├── community/          # Community module (engine.js, communityService.js, templates/)
│   │   ├── security/           # Security module (engine.js, securityService.js)
│   │   └── documentation/      # Documentation module (engine.js, documentationService.js)
│   ├── routes/                 # Express route handlers (api.js, webhooks.js)
│   ├── services/               # Licensing services (licenseService.js, prService.js, readmeService.js)
│   └── server.js               # Express application bootstrap and server
├── tests/                      # Native node:test suite (127 tests across 26 suites)
└── docs/                       # Architecture, development, and operational guides
```

---

## 3. Two-Layer Security & Authorization Model

```
+--------------------------------------------------------------------------------+
| Client Request (POST /api/community/trigger-pr or POST /api/trigger-pr)        |
+--------------------------------------------------------------------------------+
                                      |
                                      v
+--------------------------------------------------------------------------------+
| Layer 1: In-Memory Caller Verification (authorize.js)                         |
|  - Reads `Authorization: Bearer <token>`                                       |
|  - Resolves authenticated GitHub user identity                                |
|  - Verifies user holds write, admin, or maintain permission on owner/repo      |
|  - Tokens are never persisted, cached, or logged                              |
+--------------------------------------------------------------------------------+
                                      | Caller Verified (HTTP 401/403 on failure)
                                      v
+--------------------------------------------------------------------------------+
| Layer 2: Least-Privilege App Execution (communityService.js / prService.js)   |
|  - Verifies GitHub App is installed on target repository                      |
|  - Acquires scoped installation token via @octokit/app                        |
|  - Resolves repository default branch and checks for existing files           |
|  - If files exist and replaceExisting is false -> Abort with HTTP 409 Conflict|
|  - Creates isolated feature branch (chore/add-community-files-*)              |
|  - Commits verified, sanitized files with SHA tracking                        |
|  - Opens GitHub Pull Request against default branch                           |
+--------------------------------------------------------------------------------+
```

---

## 4. Conflict Protection & Mutation Safety

1. **Pre-mutation Verification:** All files to be created or updated are verified before creating any Git branches or committing blobs.
2. **Branch Isolation:** A new branch is created using the default branch's latest commit SHA as reference. If a branch already exists, a collision-resistant timestamp suffix is appended.
3. **SHA Tracking:** When replacing existing files, the exact Git blob SHA on the default branch is retrieved and passed to GitHub's Contents API to guarantee optimistic concurrency and prevent overwriting concurrent commits.
4. **Zero Code Retention:** No repository code is stored on the server or logged. Only metadata (repository name, default branch name, file paths) is inspected during processing.
