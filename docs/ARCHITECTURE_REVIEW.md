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
│   ├── js/                     # Client ES6 modules (community.js, security.js, documentation.js, issues.js, automation.js, etc.)
│   ├── index.html              # Home page
│   ├── community.html          # Community standards, audit, and PR workflow
│   ├── security.html           # Security configuration audit, generators, and PR workflow
│   ├── documentation.html       # Documentation audit, README tools, changelog, badges, link checker
│   ├── issues.html             # PR & Issue management: categorization, quality checks, welcome, duplicates, release notes
│   ├── automation.html         # Repository automation: setup audits, CI generators, workflow inspector, code quality
│   ├── analyzer.html           # Repository license inspector
│   ├── explorer.html           # SPDX license catalog explorer
│   ├── questionnaire.html      # Deterministic licensing recommendation engine
│   ├── compare.html            # Side-by-side license comparison tool
│   └── app-install.html        # GitHub App installation and license PR guide
├── src/
│   ├── config/                 # Environment variables and GitHub App config
│   ├── core/                   # Shared infrastructure across all modules
│   │   ├── capabilities/       # Capability registry (registry.js)
│   │   ├── dashboard/          # Cross-module coordinator & findings normalizer (coordinator.js, findings.js)
│   │   ├── events/             # Webhook event dispatcher and idempotency markers (dispatcher.js, idempotency.js)
│   │   ├── github/             # GitHub authentication and caller authorization (authorize.js)
│   │   ├── pullRequests/       # Reusable branch creation and multi-file commits (branches.js, files.js)
│   │   └── repository/         # Repository specifier parsing and tree inspection
│   ├── data/                   # SPDX license database (licenses.json)
│   ├── modules/                # Feature modules
│   │   ├── community/          # Community module (engine.js, communityService.js, templates/)
│   │   ├── security/           # Security module (engine.js, securityService.js)
│   │   ├── documentation/      # Documentation module (engine.js, documentationService.js)
│   │   ├── issues/             # PR & Issue management (engine.js, issueService.js, pullRequestService.js, automationService.js)
│   │   └── automation/         # Repository automation (engine.js, automationService.js)
│   ├── routes/                 # Express route handlers (api.js, webhooks.js)
│   ├── services/               # Licensing services (licenseService.js, prService.js, readmeService.js)
│   └── server.js               # Express application bootstrap and server
├── tests/                      # Native node:test suite (220 tests across 42 suites)
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

---

## 5. Event-Driven Webhook Architecture & Idempotency Model

For reactive automation responding to GitHub webhook events (`issues`, `pull_request`), Open Workers implements a dedicated event architecture:

```
+--------------------------------------------------------------------------------+
| GitHub Webhook Payload (POST /api/webhooks)                                    |
+--------------------------------------------------------------------------------+
                                      |
                                      v
+--------------------------------------------------------------------------------+
| Webhook Verification Layer                                                     |
|  - Validates HMAC SHA-256 signature (X-Hub-Signature-256)                      |
|  - Deduplicates events using in-memory LRU Delivery Tracker (X-GitHub-Delivery) |
|  - Ignores bot-generated payloads (prevents infinite webhook reply loops)     |
+--------------------------------------------------------------------------------+
                                      | Verified Event
                                      v
+--------------------------------------------------------------------------------+
| Pluggable EventDispatcher (src/core/events/dispatcher.js)                      |
|  - Routes events to registered domain handlers with per-handler error isolation|
|  - Checks repository `.github/open-workers.yml` for explicit opt-in            |
|  - Skips execution when opt-in is absent, unparseable, or disabled             |
+--------------------------------------------------------------------------------+
                                      | Opt-in Verified
                                      v
+--------------------------------------------------------------------------------+
| Automation Actions & Idempotency Guards (src/core/events/idempotency.js)       |
|  - Checks for HTML idempotency comment markers (e.g. <!-- open-workers:welcome -->)|
|  - Atomic label management (removes previous size/* before adding new size/*)  |
|  - Graceful diagnostic mapping if GitHub App lacks `issues: write` permission  |
+--------------------------------------------------------------------------------+
```

### Safety Principles for Issue & PR Automation:
1. **Strict Opt-In:** Webhook automation never performs mutations unless the repository owner explicitly maintains `.github/open-workers.yml` with `features.issue_triage.enabled: true` or `features.pr_triage.enabled: true`.
2. **Infinite Loop Prevention:** Events originating from senders matching `[bot]` or type `Bot` are discarded immediately prior to processing.
3. **Comment Idempotency Markers:** Automated comments include invisible HTML markers (`<!-- open-workers:welcome -->`). The system scans existing comments for the marker before posting to ensure first-time contributors are never spammed.
4. **Non-Destructive Issue Suggestions:** Duplicate detection and stale triage surfaces actionable recommendations without closing issues or pull requests.
5. **Caller Write Authorization:** API endpoints performing mutations (`POST /api/issues/apply-labels`, `POST /api/pulls/actions/execute`) verify caller write permissions via personal access tokens in-memory without persistence.
6. **Diagnostic Permission Hints:** If the GitHub App receives HTTP 403 on label or comment mutations, diagnostic guidance directs administrators to enable `Issues: Read and write` on `github.com/settings/apps`.


---

## 6. Repository Automation & Workflow Permission Boundary

The Repository Automation module enforces strict least-privilege boundaries and safety guarantees for CI/CD configuration files:

```
+--------------------------------------------------------------------------------+
| Proposed Automation Changes (Workflows + Quality Configs)                      |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| Permission & File Type Partitioning                                            |
|  - Workflow files (.github/workflows/*) -> Require `workflows: write`          |
|  - Standard quality configs (.editorconfig, .prettierrc, etc.) -> `contents: write`|
+--------------------------------------------------------------------------------+
                                       |
                   +-------------------+-------------------+
                   |                                       |
                   v                                       v
  [App Has workflows: write]               [App Lacks workflows: write]
  - Commits both workflows and configs     - Allows preview, copy, download
  - Submits single consolidated PR         - Refuses workflow mutations (HTTP 403)
                                           - Permits quality configs independently
```

### Safety & Guardrails:
1. **No Autonomous Code Execution:** Open Workers never runs repository build or test scripts on the server. Workflows are generated deterministically as inert text and executed solely in the user's GitHub Actions environment.
2. **Command Injection Defenses:** Command inputs (e.g. test, lint, and build commands) are strictly sanitized, rejecting shell chaining operators (`&&`, `||`, `;`) and expression interpolations (`${{ ... }}`).
3. **Bounded Matrix Dimensions:** CI matrix configurations enforce a strict ceiling (maximum 9 combinations) to prevent accidental creation of large, expensive job matrices.
4. **Official & Pinned Actions:** Generated workflows reference current, supported official actions (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`) with minimal permissions (`permissions: contents: read`) and explicit job timeouts.

---

## 7. Cross-Module Orchestration & Coordinator Architecture

The Unified Repository Dashboard introduces an orchestration and presentation layer on top of all six capabilities without mutating or duplicating underlying module logic:

```
+--------------------------------------------------------------------------------+
| Client Request: POST /api/dashboard/analyze ({ repo: "owner/repo" })           |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| Privacy Guard & Access Check (coordinator.js)                                  |
|  - If repository is private:                                                   |
|    - Verify `Authorization: Bearer <token>` (HTTP 401 on missing/malformed)    |
|    - Verify user has collaborator access (HTTP 403 on denied)                  |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| Parallel Audits via Promise.allSettled                                         |
|  +---------------------------+       +---------------------------+             |
|  | 1. Licensing Audit        |       | 2. Community Standards    |             |
|  +---------------------------+       +---------------------------+             |
|  | 3. Security Config Audit  |       | 4. Documentation Analysis |             |
|  +---------------------------+       +---------------------------+             |
|  | 5. PR & Issue Dormancy    |       | 6. Repository Setup CI    |             |
|  +---------------------------+       +---------------------------+             |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| Normalization & Aggregation Layer (findings.js)                                |
|  - Error Isolation: Failed module audit -> status: 'failed', others complete   |
|  - Normalizes findings into standard schema: { module, status, summary, score }|
|  - Compiles actionable recommendations deduplicated & ranked: High > Med > Low |
|  - Injects target URL pre-fills: `?repo=owner%2Frepo`                          |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| Actionable Health Report (JSON) -> Rendered in /dashboard.html                 |
+--------------------------------------------------------------------------------+
```

### Coordinator Design Guarantees:
1. **Bounded Concurrency & Fault Tolerance:** Promise execution via `Promise.allSettled` ensures that network timeouts, rate limit events, or unexpected exceptions in one capability audit do not abort or compromise the overall repository overview.
2. **Stateless Privacy Boundary:** Private repository access is strictly authenticated before exposing metadata, file structures, or findings. No repository content, findings, or user tokens are cached or persisted to disk.
3. **Transparent Non-Averaged Scoring:** Capability scores remain domain-specific (e.g., Community completeness, Security health, Documentation score). The dashboard does not artificially average disparate metrics into a misleading single percentage, instead highlighting actionable priority items.
