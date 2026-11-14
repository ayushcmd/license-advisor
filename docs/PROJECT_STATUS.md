# Open Workers — Project Status

**Last Updated:** November 2026  
**Current Version:** `1.2.0`  
**Repository:** `https://github.com/ayushcmd/open-workers`  
**Live Application:** `https://open-workers.onrender.com`  
**GitHub Marketplace:** `https://github.com/marketplace/open-workers`  
**License:** Apache-2.0 (`SPDX-License-Identifier: Apache-2.0`)

---

## 1. Executive Summary

**Open Workers** is a multi-purpose GitHub automation platform and least-privilege GitHub App engineered to help developers maintain, improve, and govern repositories across six core capabilities.

The platform operates on a three-stage principle: **Inspect → Recommend → Act**. Repositories are inspected on demand without persisting code or credentials; deterministic guidance is generated; and verified changes are submitted as isolated, reviewable Pull Requests (`chore/*`) on dedicated feature branches.

Following the repository rename from `license-advisor` to `open-workers` and completion of Phase 3, the official Open Workers visual identity has been implemented across the application, website, and documentation.

---

## 2. Infrastructure & Environment Status

| Component | Identifier / URL | Current Status | Notes |
| :--- | :--- | :--- | :--- |
| **GitHub Repository** | [`ayushcmd/open-workers`](https://github.com/ayushcmd/open-workers) | **Active** | Remote origin tracking `origin/main`. |
| **Production Web App** | [`open-workers.onrender.com`](https://open-workers.onrender.com) | **Active** | Render cloud hosting with keep-alive health check. |
| **GitHub Marketplace** | [`marketplace/open-workers`](https://github.com/marketplace/open-workers) | **Active** | Free tier developer tool listing. |
| **GitHub App (Production)** | `open-license-advisor[bot]` | **Active** | Configured with least-privilege scopes (`contents: write`, `pull_requests: write`). App slug in `.env.example`. |
| **Database Architecture** | *Stateless (Zero-Database)* | **Active** | No persistent storage; caller tokens verified in-memory. |

---

## 3. Capability Status Overview

Open Workers is structured around **six core product modules**:

| # | Capability Module | Category | Implementation Status | Primary Routes |
| :-: | :--- | :--- | :-: | :--- |
| **1** | **Licensing** | Governance | **Available** (Production) | `/explorer.html`, `/questionnaire.html`, `/compare.html`, `/app-install.html`, `/analyzer.html`, `/api/recommend`, `/api/trigger-pr` |
| **2** | **Community** | Community | **Available** (Production) | `/community.html`, `/api/community/templates`, `/api/community/generate`, `/api/community/analyze`, `/api/community/preview-pr`, `/api/community/trigger-pr` |
| **3** | **Security** | Security | **Available** (Production) | `/security.html`, `/api/security/checks`, `/api/security/templates`, `/api/security/generate`, `/api/security/analyze`, `/api/security/preview-pr`, `/api/security/trigger-pr` |
| **4** | **Documentation** | Documentation | **Available** (Production) | `/documentation.html`, `/api/documentation/checks`, `/api/documentation/templates`, `/api/documentation/generate`, `/api/documentation/analyze`, `/api/documentation/check-links`, `/api/documentation/preview-pr`, `/api/documentation/trigger-pr` |
| **5** | **PR & Issue Management** | Workflow | **Available** (Production) | `/issues.html`, `/api/issues/*`, `/api/pulls/*` |
| **6** | **Repository Automation** | Workflow | **Available** (Production) | `/automation.html`, `/api/automation/*` |

---

## 4. Detailed Module Verification

### 1. Licensing — Status: Available
- **SPDX License Catalog:** 12 OSI-approved and FSF-libre licenses with complete legal texts, permissions, conditions, and limitations (`src/data/licenses.json`).
- **Policy Questionnaire:** 4-point deterministic recommendation engine evaluating commercial distribution, patent grants, copyleft scope, and network SaaS obligations (`src/services/recommendationEngine.js`).
- **Interactive Explorer & Comparator:** Side-by-side comparison of candidate licenses with copyright customization (`public/explorer.html`, `public/compare.html`).
- **Repository License Analyzer:** Remote inspection of default branch for existing `LICENSE`, `NOTICE`, manifests, and badges (`public/analyzer.html`, `POST /api/analyze`).
- **Automated Pull Requests:** Dedicated feature branch (`chore/add-license-<spdx>`), personalized license generation, conflict detection, and optional README badge injection (`src/services/prService.js`, `POST /api/trigger-pr`).

### 2. Community — Status: Available
- **Standard Document Generator:** Deterministic generation for `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 3.0), `SECURITY.md`, and `SUPPORT.md` with in-browser preview, copy, and download (`src/modules/community/engine.js`).
- **Issue Templates:** Structured issue forms under `.github/ISSUE_TEMPLATE/` (`bug_report.md`, `feature_request.md`, `documentation.md`) with YAML front matter validation.
- **Pull Request Template:** Standard `.github/PULL_REQUEST_TEMPLATE.md` with reviewer checklists and testing instructions.
- **Community Health Audit:** Deep inspection across root, `.github/`, and `docs/` directories for 6 standard community files, providing a 0–100% health score and actionable recommendations (`POST /api/community/analyze`).
- **Consolidated Community PRs:** Pre-commit conflict preview (`POST /api/community/preview-pr`) and multi-file commit & PR creation (`POST /api/community/trigger-pr`) with caller in-memory write authorization and `replaceExisting` conflict guards.

### 3. Security — Status: Available
- **Repository Security Configuration Audit:** Non-destructive inspection of `SECURITY.md`, `.github/dependabot.yml`, `.github/workflows/codeql.yml`, default branch protection, and secret scanning settings (`POST /api/security/analyze`).
- **Dependabot Configuration Generator:** Schema-compliant, deterministic `.github/dependabot.yml` generator supporting npm, pip, github-actions, docker, maven, gradle, bundler, and cargo with customizable update schedules, directories, PR limits, and labels (`src/modules/security/engine.js`).
- **CodeQL Workflow Generator:** Modern GitHub Actions CodeQL Action v3 workflow generator (`.github/workflows/codeql.yml`) supporting multi-language matrix builds (`javascript-typescript`, `python`, `go`, `java-kotlin`, `c-cpp`, `csharp`, `ruby`, `rust`), push/PR triggers, and scheduled cron jobs.
- **Transparent Security Configuration Health Score:** Calculates percentage purely over verified checks (excluding unverified administrative checks from failure penalty) with clear configuration hygiene disclaimers.
- **Consolidated Security PRs:** Pre-commit preview (`POST /api/security/preview-pr`) and automated PR creation (`POST /api/security/trigger-pr`) with dedicated branch isolation, conflict guards, and explicit `workflows: write` permission safety enforcement.

### 4. Documentation — Status: Available
- **README Completeness & Structure Audit:** Non-destructive remote inspection of README existence, Markdown formatting, key developer sections (Title, Description, Installation, Usage, Contributing, License, Documentation, Architecture), dedicated `docs/` folder, and changelog (`POST /api/documentation/analyze`).
- **README Generator & Improvement Assistant:** Generates clean initial README scaffolds or non-destructively augments existing repository READMEs with missing sections while preserving existing content and License positioning (`src/modules/documentation/engine.js`, `POST /api/documentation/generate`).
- **Conventional Commits Changelog Generator:** Inspects commit history, categorizes commits into standard semantic groups (Breaking Changes, Features, Bug Fixes, Performance, Refactoring, Documentation, Tests, Build/CI, Chores), and cleanly prepends to existing `CHANGELOG.md` (`POST /api/documentation/generate`).
- **Shields.io Status Badge Generator:** Deterministic badge Markdown generator supporting License, GitHub Workflow, Latest Release, GitHub Stars, Open Issues, Contributors, Node.js version, and custom badge parameters (`POST /api/documentation/generate`).
- **Markdown Broken Link Checker:** Inspects Markdown content, validates relative repository paths against the tree, and checks external URLs with strict SSRF defenses against loopback, private RFC 1918/3927 IPs, and cloud metadata endpoints (`POST /api/documentation/check-links`).
- **Consolidated Documentation PRs:** Pre-commit conflict preview (`POST /api/documentation/preview-pr`) and automated multi-file pull requests on isolated `chore/improve-docs` branches (`POST /api/documentation/trigger-pr`) using caller in-memory write authorization and least-privilege GitHub App credentials.

### 5. PR & Issue Management — Status: Available
- **Deterministic Issue Categorization:** Evaluates issue title and body against keyword dictionaries for 8 categories (`bug`, `feature`, `documentation`, `question`, `enhancement`, `performance`, `maintenance`, `security`) with transparent score breakdowns and confidential security vulnerability reporting guidance (`src/modules/issues/engine.js`, `POST /api/issues/analyze`).
- **Rule-Based Issue Labeling:** Non-destructive label preview (`POST /api/issues/preview-labels`) and mutation (`POST /api/issues/apply-labels`) with color consistency, caller in-memory write authorization, and diagnostic error handling for `issues: write` GitHub App permission requirements.
- **Pull Request Quality Checker:** Analyzes PR description length, markdown checklist completion status, issue reference linkage (`Fixes #123`), test plan inclusion, breaking changes declarations, Conventional Commits title formatting, and draft status (`POST /api/pulls/analyze`).
- **Pull Request Size Classification:** Computes net changed lines excluding generated lockfiles, assigns mutually exclusive size labels (`size/XS`, `size/S`, `size/M`, `size/L`, `size/XL`), warns on lockfile inflation, and atomically manages size labels (`POST /api/pulls/classify`, `POST /api/pulls/actions/execute`).
- **First-Time Contributor Experience:** Generates welcoming greetings with customizable community links (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`), using idempotency markers (`<!-- open-workers:welcome -->`) to prevent duplicate bot comments (`POST /api/pulls/actions/preview`, `POST /api/pulls/actions/execute`).
- **Duplicate Issue Suggestions & Stale Triage:** Identifies duplicate issue candidates using title and keyword token similarity without destructive auto-closing (`POST /api/issues/duplicates`); inspects dormant issues against configurable inactivity thresholds with security and exempt label protections (`POST /api/issues/stale`).
- **Semantic Release Notes Compiler:** Groups merged pull requests into Conventional Commits categories (Breaking Changes, Features, Fixes, Maintenance, Other) with contributor shoutouts, in-browser markdown preview, copy, and download (`POST /api/pulls/release-notes`).
- **Opt-In Webhook Automation Engine:** Verified GitHub webhook event dispatcher (`src/core/events/dispatcher.js`) routing `issues` and `pull_request` events with bot loop prevention and strict opt-in gating via repository `.github/open-workers.yml` configuration.

### 6. Repository Automation — Status: Available
- **Repository Setup & Metadata Audit:** Non-destructive remote audit of CI workflows, code quality configurations (.editorconfig, Prettier, ESLint, .gitattributes, .gitignore), and discovery metadata with transparent 0–100% health scoring (`src/modules/automation/engine.js`, `POST /api/automation/analyze`).
- **Tailored CI Workflow Generators:** Generates verified, valid YAML workflows for Node.js CI, Python CI, Multi-Platform Matrix CI, PR Validation, and Scheduled Maintenance using official actions (v4/v5), minimal token permissions (`contents: read`), explicit timeouts (`timeout-minutes: 15-20`), bounded matrices, and injection defenses (`POST /api/automation/generate`).
- **Workflow Health Inspector:** Analyzes existing `.github/workflows/*.yml` files for unpinned third-party actions, deprecated action references, missing explicit permissions, broad `write-all` permissions, missing timeouts, and dangerous `pull_request_target` triggers (`POST /api/automation/inspect-workflows`).
- **Code Quality Configuration Generators:** Generates standardized configurations for `.editorconfig`, `.prettierrc.json`, modern flat `eslint.config.js`, `.gitattributes`, and `.gitignore` with safe non-destructive merging.
- **Cross-Module Maintenance Integration:** Seamlessly correlates setup audit findings with Security (Dependabot, CodeQL), Community (Security policy, contributing guidelines), and Documentation (README).
- **Consolidated Automation Pull Requests:** Multi-file pre-commit preview (`POST /api/automation/preview-pr`) and automated PR creation on dedicated `ci/*` or `chore/*` branches (`POST /api/automation/trigger-pr`) with in-memory caller write PAT verification and strict enforcement of the GitHub App's `workflows: write` permission boundary.

---

## 5. Verification & Quality Control

- **Test Suite:** Built-in Node.js runner (`node:test`) and strict assertions (`node:assert/strict`). Zero external test runner dependencies.
- **Test Results:** **205 passing tests** across 39 test suites with **0 failures**.
- **Syntax Check:** `npm run lint:syntax` validates all 50 ES module JavaScript files using `node --check`.
