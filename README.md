<div align="center">
  <img src="./public/assets/open-workers-logo.png" alt="Open Workers Logo" width="160">

  # Open Workers

  **One GitHub App. Multiple Capabilities.**

  [![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-Open%20Workers-2DA44E?style=flat-square&logo=github&logoColor=white)](https://github.com/marketplace/open-workers)
  [![Live Web App](https://img.shields.io/badge/Live%20App-open--workers.onrender.com-24292F?style=flat-square&logo=render&logoColor=white)](https://open-workers.onrender.com)
  [![GitHub App](https://img.shields.io/badge/GitHub%20App-open--license--advisor-0969DA?style=flat-square&logo=github&logoColor=white)](https://github.com/apps/open-license-advisor)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](./LICENSE)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933.svg?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
  [![Tests](https://img.shields.io/badge/Tests-77%20Passing-2DA44E.svg?style=flat-square&logo=githubactions&logoColor=white)](./tests)

  <p align="center">
    <a href="https://open-workers.onrender.com"><strong>Launch Web App</strong></a> &bull;
    <a href="https://github.com/marketplace/open-workers"><strong>Marketplace Listing</strong></a> &bull;
    <a href="https://github.com/apps/open-license-advisor"><strong>Install GitHub App</strong></a> &bull;
    <a href="#quick-start"><strong>Quick Start</strong></a> &bull;
    <a href="#api-overview"><strong>API Overview</strong></a> &bull;
    <a href="./docs/ARCHITECTURE_REVIEW.md"><strong>Architecture</strong></a>
  </p>
</div>

---

## About Open Workers

> **Open Workers** is a multi-purpose GitHub automation platform designed to help developers maintain, improve, and organize their repositories through one GitHub App.

Instead of installing dozens of disconnected single-purpose bots, Open Workers provides a unified, least-privilege automation suite built around six core repository disciplines: **Licensing**, **Community Standards**, **Security**, **Documentation**, **PR & Issue Management**, and **Repository Automation**.

### Operational Principles: Inspect &rarr; Recommend &rarr; Act

Open Workers strictly adheres to a three-stage operational model:

```
+------------------+         +----------------------+         +-----------------------+
|  1. INSPECT      |  ====>  |  2. RECOMMEND        |  ====>  |  3. ACT               |
|  Scan repository |         |  Evaluate health &   |         |  Create reviewable    |
|  files & headers |         |  deterministic rules |         |  pull requests (PRs)  |
+------------------+         +----------------------+         +-----------------------+
```

1. **Inspect:** Examine public repository metadata, default branches, root files, and `.github/` trees on demand via the GitHub REST API without retaining repository code or secrets.
2. **Recommend:** Evaluate findings against transparent, deterministic policy engines and industry standards, providing clear health scores and plain-language recommendations.
3. **Act:** Propose authorized, verified changes through reviewable Pull Requests on isolated feature branches (`chore/*`). The repository default branch is never modified directly.

---

## Six Core Capabilities

Open Workers is architected around six modular capability areas, all fully implemented and available in production:

```
                  +-----------------------------------------+
                  |               OPEN WORKERS              |
                  |   One GitHub App. Multiple Capabilities |
                  +-----------------------------------------+
                                       |
       +-------------------------------+-------------------------------+
       |                                                               |
  [GOVERNANCE & COMMUNITY]                                        [WORKFLOW & QUALITY]
  1. Licensing                                                    4. Documentation
  2. Community Standards                                          5. PR & Issue Management
  3. Security                                                     6. Repository Automation
```

### 1. Licensing &mdash; Available

A complete open-source licensing toolkit designed to remove legal ambiguity and enforce repository attribution:

- **SPDX License Explorer:** Curated catalog of 12 OSI-approved and FSF-libre licenses (`MIT`, `Apache-2.0`, `GPL-3.0-only`, `AGPL-3.0-only`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `LGPL-3.0-only`, `MPL-2.0`, `EPL-2.0`, `The Unlicense`, `CC0-1.0`) with permissions, conditions, and limitations breakdown.
- **Deterministic Policy Questionnaire:** 4-question policy evaluation (commercial use, patent grants, copyleft boundaries, network triggers) providing ranked recommendations independent of programming language.
- **Side-by-Side Comparison:** Compare up to 4 licenses simultaneously with customizable copyright year and holder parameters.
- **License Compatibility Matrix:** Dependency license audit identifying copyleft conflicts (e.g., Apache-2.0 dependency compatibility with GPL-2.0 vs GPL-3.0).
- **Repository License Analyzer:** Live on-demand scanning for existing `LICENSE`, `NOTICE`, README badges, and dependency manifests across public repositories.
- **Automated Pull Requests:** Submits verified `LICENSE` files and README badge insertions on dedicated `chore/add-license-<spdx>` branches with replacement conflict guards.

*Explore:* [`/explorer.html`](https://open-workers.onrender.com/explorer.html) &bull; [`/questionnaire.html`](https://open-workers.onrender.com/questionnaire.html) &bull; [`/compare.html`](https://open-workers.onrender.com/compare.html) &bull; [`/analyzer.html`](https://open-workers.onrender.com/analyzer.html)

### 2. Community Standards &mdash; Available

Automate community governance, contributor expectations, and issue reporting standards:

- **Standard Document Generator:** Deterministic, schema-validated generation for:
  - `CONTRIBUTING.md` &mdash; Contribution guidelines, branch workflows, setup, and testing steps.
  - `CODE_OF_CONDUCT.md` &mdash; Contributor Covenant 3.0 with strict private enforcement contact validation.
  - `SECURITY.md` &mdash; Coordinated vulnerability disclosure and private reporting policies.
  - `SUPPORT.md` &mdash; Support channels, discussion forums, and documentation links.
- **Issue Templates Generator:** Structured GitHub issue forms under `.github/ISSUE_TEMPLATE/`:
  - `bug_report.md` &mdash; Steps to reproduce, expected behavior, and environment details.
  - `feature_request.md` &mdash; Problem statement, proposed solutions, and alternatives considered.
  - `documentation.md` &mdash; Affected documentation links and suggested corrections.
- **Pull Request Template Generator:** `.github/PULL_REQUEST_TEMPLATE.md` with summary sections, issue linking, testing verification, and contributor checklists.
- **Community Health Audit:** Deep inspection across repository `root`, `.github/`, and `docs/` directories for 6 standard community standards with an overall health score (0–100%) and actionable advice.
- **Consolidated Community PRs:** Pre-commit conflict preview (`POST /api/community/preview-pr`) and authorized multi-file deployment (`POST /api/community/trigger-pr`) with in-memory caller write authorization.

*Explore:* [`/community.html`](https://open-workers.onrender.com/community.html)

### 3. Security &mdash; Available

Repository security configuration inspection, automated security configurations, and pull requests:

- **Security Configuration Audit:** Non-destructive inspection of `SECURITY.md`, `.github/dependabot.yml`, `.github/workflows/codeql.yml`, default branch protection, and secret scanning settings (`POST /api/security/analyze`).
- **Dependabot Configuration Generator:** Schema-compliant `.github/dependabot.yml` generator supporting 8 package ecosystems (`npm`, `pip`, `GitHub Actions`, `docker`, `maven`, `gradle`, `bundler`, `cargo`) with customizable update schedules, directories, and PR limits.
- **CodeQL Workflow Generator:** Modern GitHub Actions CodeQL Action v3 workflow generator (`.github/workflows/codeql.yml`) supporting multi-language matrix builds (`javascript-typescript`, `python`, `go`, `java-kotlin`, `c-cpp`, `csharp`, `ruby`, `rust`), push/PR triggers, and scheduled cron jobs.
- **Security Configuration Health Reporting:** Transparent hygiene scoring based strictly on verified configuration checks. Unverified administrative checks do not count as failures. *(Note: evaluates configuration hygiene, not active vulnerability scanning).*
- **Consolidated Security PRs:** Dedicated feature branch (`chore/configure-security`), conflict preview (`POST /api/security/preview-pr`), caller authorization, and automated pull requests (`POST /api/security/trigger-pr`) with explicit `workflows: write` permission safety checks.

*Explore:* [`/security.html`](https://open-workers.onrender.com/security.html)

### 4. Documentation &mdash; Available

Tools to keep project documentation clear, comprehensive, and up-to-date:

- **README Completeness Audit:** Analyzes repository READMEs for essential developer sections (Title, Description, Installation, Usage, Contributing, License, Documentation, Architecture) with transparent completeness scoring and actionable advice (`POST /api/documentation/analyze`).
- **README Generator & Improvement Assistant:** Generates new clean README templates or non-destructively augments existing READMEs with missing sections while strictly preserving existing license notices and content (`POST /api/documentation/generate`).
- **Automated Changelog Generation:** Compiles Conventional Commits into structured, chronological `CHANGELOG.md` updates grouped by semantic category (Features, Bug Fixes, Breaking Changes, Performance, Documentation, etc.) and prepends cleanly to existing changelogs (`POST /api/documentation/generate`).
- **Shields.io Badge Generator:** Live badge configurations for build status, license identifiers, versioning, GitHub stars, open issues, contributors, and Node.js versions (`POST /api/documentation/generate`).
- **Markdown Broken-Link Checker:** Scans project documentation for broken internal repository paths and validates external hyperlinks with SSRF-hardened protection against private IP, loopback, and cloud metadata requests (`POST /api/documentation/check-links`).
- **Consolidated Documentation PRs:** Pre-commit conflict preview (`POST /api/documentation/preview-pr`), caller authorization verification, and multi-file automated pull requests (`POST /api/documentation/trigger-pr`) creating dedicated feature branches (`chore/improve-docs`).

*Explore:* [`/documentation.html`](https://open-workers.onrender.com/documentation.html)

### 5. PR & Issue Management &mdash; Available

Intelligent triage, quality inspection, and collaboration automation for maintainers:

- **Rule-Based Issue Categorization:** Deterministic classification of incoming issues across 8 standard categories (Bug, Feature, Documentation, Question, Enhancement, Performance, Maintenance, Security) with explainable reasoning and private disclosure warnings for sensitive security reports (`POST /api/issues/analyze`).
- **Pull Request Quality Checker & Size Classification:** Evaluates PRs against contribution standards (meaningful description, linked issue references, testing instructions, breaking changes, checklist completeness, Conventional Commit titles, draft status) and automatically classifies size from `size/XS` to `size/XL` (`POST /api/pulls/analyze`, `POST /api/pulls/size`).
- **Duplicate Issue Suggestions:** Fast, explainable text similarity analysis across open issues with matching keyword summaries, strictly preventing automated or speculative closures (`POST /api/issues/duplicates`).
- **Stale Issue Inspector:** On-demand detection of inactive issues based on configurable day thresholds, with strict exemption protections for security issues, pinned topics, and protected labels (`POST /api/issues/stale`).
- **First-Time Contributor Welcome:** Formats customizable greetings linking to community standards with idempotent comment markers (`<!-- open-workers:welcome -->`) preventing duplicate messages.
- **Release Notes Drafter:** Automatically compiles merged pull requests into organized Conventional Commits release notes drafts with interactive markdown preview, copy, and download (`POST /api/pulls/release-notes`).
- **Opt-In Webhook Automation:** Event dispatcher routing verified `issues` and `pull_request` deliveries to automated handlers strictly when opted in via `.github/open-workers.yml`, with built-in bot loop guards and least-privilege permission enforcement.

*Explore:* [`/issues.html`](https://open-workers.onrender.com/issues.html)

### 6. Repository Automation &mdash; Available

Continuous maintenance and developer workflow automation:

- **Repository Setup Audit:** Non-destructive inspection of CI workflows, code quality configurations, and discovery metadata with transparent health scoring (`POST /api/automation/analyze`).
- **GitHub Actions CI Generators:** Tailored, deterministic workflow generators with official actions (v4/v5), minimal token permissions, and bounded matrices for Node.js, Python, Multi-Platform Matrix, PR Validation, and Scheduled Maintenance (`POST /api/automation/generate`).
- **Workflow Health Inspector:** Scans existing `.github/workflows/*.yml` files for unpinned third-party actions, deprecated action references, missing job timeouts, broad permissions (`write-all`), and dangerous triggers (`pull_request_target` with head checkout) (`POST /api/automation/inspect-workflows`).
- **Code Quality Generators:** Generates standard `.editorconfig`, `.prettierrc.json`, modern flat `eslint.config.js`, `.gitattributes`, and starter `.gitignore` with clean non-destructive merging.
- **Consolidated Automation PRs:** Single-PR multi-file deployment on dedicated feature branches with in-memory caller write authorization, conflict detection, and strict enforcement of the GitHub App's `workflows: write` permission boundary (`POST /api/automation/preview-pr`, `POST /api/automation/trigger-pr`).

*Explore:* [`/automation.html`](https://open-workers.onrender.com/automation.html)

---

## Capability Status Summary

| Capability Module | Status | Category | Scope & Endpoints |
| :--- | :---: | :--- | :--- |
| **Licensing** | **Available** | Governance | Full catalog, questionnaire, comparator, analyzer, PR generator (`/api/*`) |
| **Community** | **Available** | Community | Guidelines, conduct, security, support, issue & PR templates, audit, consolidated PRs (`/api/community/*`) |
| **Security** | **Available** | Security | Security audit, Dependabot & CodeQL generators, PR automation (`/api/security/*`) |
| **Documentation** | **Available** | Documentation | README audits & improvements, changelog generation, badge tools, link validation, PR automation (`/api/documentation/*`) |
| **PR & Issue Management** | **Available** | Workflow | Issue triage, PR quality & size, duplicate detection, stale inspection, release notes, opt-in webhooks (`/api/issues/*`, `/api/pulls/*`) |
| **Repository Automation** | **Available** | Workflow | Setup audits, CI generators, workflow inspector, code quality configs, consolidated PRs (`/api/automation/*`) |

---

## How It Works

<div align="center">
  <img src="./public/assets/workflow.svg" alt="Open Workers Platform Architecture & Workflow" width="100%">
</div>

1. **Connect or Browse:** Open [open-workers.onrender.com](https://open-workers.onrender.com) or call the public REST API.
2. **Select Capability:** Choose a task across Licensing or Community standards.
3. **Inspect Repository:** Enter a public or installed repository (`owner/repo`) to inspect default-branch files and health scores.
4. **Customize & Preview:** Review generated Markdown and issue forms directly in the browser; check conflict status for files that already exist on the default branch.
5. **Caller Authorization:** When requesting repository modification, provide a GitHub Personal Access Token (`Authorization: Bearer <token>`). Open Workers verifies in-memory that the authenticated user holds write permissions on the target repository.
6. **Isolated Mutation:** The GitHub App client (`@octokit/app`) creates an isolated feature branch (`chore/*`), commits verified files, and opens a transparent Pull Request.
7. **Merge on GitHub:** Maintainers review the Pull Request on GitHub and merge at their own discretion.

---

## Technology Stack

Open Workers is intentionally built with a clean, standard, database-free architecture:

- **Runtime:** Node.js `>=20.0.0` (developed and tested on Node.js v24 LTS)
- **HTTP Server:** Express.js 5 with Helmet security headers and strict CSP
- **JavaScript Standard:** Modern ES6 Modules (`import`/`export`)
- **Frontend:** Vanilla HTML5, CSS3, and ES6 JavaScript (Primer-inspired, responsive, zero frontend framework overhead)
- **GitHub API Integration:** `@octokit/rest`, `@octokit/app`, and `@octokit/webhooks`
- **Authentication:** In-memory user token verification + GitHub App installation tokens
- **Testing:** Native Node.js `node:test` runner and strict assertions (`node:assert/strict`)
- **Hosting:** Render Cloud Platform
- **Storage:** **Stateless (Zero Database)** &mdash; Tokens and customer source code are never stored.

---

## Repository Structure

```
open-workers/
├── public/                     # Static frontend web application
│   ├── assets/                 # SVGs, icons, and official branding assets
│   ├── css/                    # Modular Primer-inspired CSS (base.css, components.css)
│   ├── js/                     # Client ES6 modules (community.js, analyzer.js, etc.)
│   ├── index.html              # Open Workers home page & capability showcase
│   ├── community.html          # Community standards generator, audit, and PR UI
│   ├── analyzer.html           # Repository license analyzer
│   ├── explorer.html           # SPDX license catalog explorer
│   ├── questionnaire.html      # Deterministic licensing recommendation wizard
│   ├── compare.html            # Side-by-side license comparison tool
│   ├── app-install.html        # GitHub App installation and license PR guide
│   ├── privacy.html            # Zero-persistence privacy policy
│   └── support.html            # Support guidelines and troubleshooting
├── src/
│   ├── config/                 # Environment loader and GitHub App configuration
│   ├── core/                   # Shared infrastructure across all modules
│   │   ├── capabilities/       # Capability registry (registry.js)
│   │   ├── github/             # In-memory caller authorization (authorize.js)
│   │   ├── pullRequests/       # Isolated branch creation & multi-file commits (branches.js, files.js)
│   │   └── repository/         # Repository specifier parsing and tree inspection
│   ├── data/                   # 12 OSI-approved SPDX license database (licenses.json)
│   ├── modules/                # Feature modules
│   │   └── community/          # Community module engine, templates, and PR service
│   ├── routes/                 # Express route handlers (api.js, webhooks.js)
│   ├── services/               # Licensing services (licenseService.js, prService.js, readmeService.js)
│   └── server.js               # Application bootstrap and server entry point
├── tests/                      # Built-in node:test test suite (77 tests)
└── docs/                       # Project status, feature matrix, roadmap, and architecture docs
```

---

## Quick Start

### Prerequisites

- **Node.js `>=20.0.0`** (Node.js v24 LTS recommended)
- **npm** (included with Node.js)
- **Git**

### Local Setup

```bash
# 1. Clone repository
git clone https://github.com/ayushcmd/open-workers.git
cd open-workers

# 2. Install dependencies cleanly
npm ci

# 3. Configure environment
cp .env.example .env

# 4. Run tests and syntax verification
npm test
npm run lint:syntax

# 5. Start development server with file watching
npm run dev
```

Visit **[http://localhost:3000](http://localhost:3000)** in your browser.

> **Note:** Open Workers degrades gracefully when GitHub App keys are omitted in `.env`. All web pages, license exploration, recommendation questionnaires, comparison tools, community document generation, issue/PR template builders, and public repository analysis work immediately without credentials. Automated Pull Request creation activates once GitHub App credentials are provided.

### Available Scripts

- `npm start` &mdash; Run the production server (`node src/server.js`)
- `npm run dev` &mdash; Run with Node's native file-watch mode (`node --watch src/server.js`)
- `npm test` &mdash; Execute the native `node:test` suite (`77 tests`, zero dependencies)
- `npm run lint:syntax` &mdash; Verify syntax across all JavaScript files with `node --check`

---

## GitHub App Integration

Open Workers operates as a least-privilege GitHub App (`open-license-advisor[bot]`).

### Scoped Permissions

Open Workers requires only the minimum repository permissions necessary to inspect files and open reviewable pull requests:

| Permission | Scope | Rationale |
| :--- | :---: | :--- |
| **Repository Contents** | `write` | Required to commit license and community files to dedicated feature branches. |
| **Pull Requests** | `write` | Required to open and manage Pull Requests against the repository default branch. |
| **Repository Metadata** | `read` | Automatically granted by GitHub to read public repository configuration. |

### Two-Layer Security Model

1. **User Identity Verification:** When invoking PR endpoints (`POST /api/trigger-pr` or `POST /api/community/trigger-pr`), callers supply a GitHub Personal Access Token in the `Authorization: Bearer <token>` header.
2. **Permission Check:** The server verifies that the caller possesses `admin`, `maintain`, or `write` collaborator permissions on the target repository.
3. **App Execution:** The GitHub App installation client acquires a short-lived token to perform mutations on dedicated `chore/*` branches.
4. **Safety Conflict Guards:** Operations fail closed with `HTTP 409 Conflict` if target files already exist, requiring explicit `replaceExisting: true` opt-in.

---

## API Overview

All endpoints return JSON and adhere to standard HTTP status codes:

### Core & Capabilities

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/health` | `GET` | Health status, mode (`database-free`), and catalog readiness |
| `/api/config` | `GET` | Public App configuration, permissions, and installation URL |
| `/api/capabilities` | `GET` | List all 6 Open Workers product capabilities and statuses |
| `/api/capabilities/:id` | `GET` | Retrieve details for a specific capability module |

### Licensing Endpoints

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/licenses` | `GET` | List all 12 curated OSI-approved SPDX licenses |
| `/api/licenses/:id` | `GET` | Retrieve full license metadata and official legal text |
| `/api/recommend` | `POST` | Deterministic policy recommendation based on 4 criteria |
| `/api/compare` | `POST` | Side-by-side comparison matrix for up to 4 licenses |
| `/api/analyze` | `POST` | Inspect default branch of `owner/repo` for license files |
| `/api/trigger-pr` | `POST` | Open automated `LICENSE` PR (requires write authorization) |

### Community Endpoints

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/community/templates` | `GET` | List community document and issue/PR templates |
| `/api/community/generate` | `POST` | Deterministically generate Markdown or issue template YAML |
| `/api/community/analyze` | `POST` | Audit repository community health across 6 standard files |
| `/api/community/preview-pr`| `POST` | Preview proposed PR files and check existing-file conflicts |
| `/api/community/trigger-pr`| `POST` | Open consolidated Community PR (requires write authorization) |

### Webhook Handling

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/webhooks` | `POST` | HMAC SHA-256 verified GitHub App webhook handler with delivery deduplication |

### Example API Request

```bash
# Analyze repository community health
curl -s -X POST https://open-workers.onrender.com/api/community/analyze \
  -H "Content-Type: application/json" \
  -d '{"repo":"ayushcmd/open-workers"}'
```

---

## Security & Privacy

Open Workers is designed from the ground up with a privacy-preserving, zero-retention posture:

- **Zero Code Persistence:** Open Workers does not operate a database and never caches, stores, or analyzes customer source code beyond requested configuration files (`LICENSE`, community standards).
- **Stateless Authentication:** User tokens provided for PR authorization are held only in volatile process memory for the duration of the request and are never written to disk or logs.
- **HMAC SHA-256 Webhooks:** All incoming GitHub webhooks are cryptographically validated against `GITHUB_WEBHOOK_SECRET` before processing.
- **Reviewable Mutations:** Open Workers never modifies default branches directly. Every action is delivered as an atomic commit on an isolated feature branch (`chore/*`) for maintainer review.
- **Vulnerability Disclosure:** Please report security issues privately to [ayush_24a12res897@iitp.ac.in](mailto:ayush_24a12res897@iitp.ac.in). Review our full [Security Policy](./docs/SECURITY.md) for details.

---

## Official Links

- **Production Web Application:** [https://open-workers.onrender.com](https://open-workers.onrender.com)
- **GitHub Marketplace Listing:** [https://github.com/marketplace/open-workers](https://github.com/marketplace/open-workers)
- **GitHub Repository:** [https://github.com/ayushcmd/open-workers](https://github.com/ayushcmd/open-workers)
- **GitHub App Installation:** [https://github.com/apps/open-license-advisor](https://github.com/apps/open-license-advisor)
- **Documentation Index:** [docs/](file:///c:/Projects/AYUSHCMD-GITHUB/open-workers/docs/)
  - [Project Status](./docs/PROJECT_STATUS.md)
  - [Feature Matrix](./docs/FEATURE_MATRIX.md)
  - [Development Roadmap](./docs/ROADMAP.md)
  - [Architecture Review](./docs/ARCHITECTURE_REVIEW.md)
  - [Local Development Guide](./docs/DEVELOPMENT.md)

---

## License & Attribution

Open Workers is open source software licensed under the **[Apache License 2.0](./LICENSE)**.

```
Open Workers
Copyright 2026 Ayush Raj (https://github.com/ayushcmd)
Developed by Ayush Raj (ayush_24a12res897@iitp.ac.in).
Downstream distributions and derivative works must retain this attribution notice.
```

- **Attribution Requirement:** In accordance with Section 4 of the Apache License 2.0, derivative distributions and forks must retain copyright notices and attribution to Ayush Raj (`@ayushcmd`) as specified in the root **[NOTICE](./NOTICE)** file.
- **Disclaimer:** Open Workers provides technical summaries and automated repository guidance. It does not constitute formal legal counsel; consult qualified legal counsel for complex compliance inquiries.
