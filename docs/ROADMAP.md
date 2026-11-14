# Open Workers — Development Roadmap

This document outlines the phased evolution of **Open Workers**, organized around our **six core product modules**.

---

## 1. Evolution Timeline

```
[Phase 1: Licensing Core]  -->  [Phase 2: Registry & Standards]  -->  [Phase 3: Community PRs & Branding]
         COMPLETED                           COMPLETED                             COMPLETED
                                                                                          |
                                                                                          v
[Phase 4: Security Module]     -->  [Phase 5: Documentation]     -->  [Phase 6: PR & Issue Management]
         COMPLETED                           COMPLETED                             COMPLETED
                                                                                          |
                                                                                          v
[Phase 7: Production Cutover]   <--  [Phase 6b: Repository Automation] <------------------+
          PLANNED                                  COMPLETED
```

---

## 2. Completed Milestones

### Phase 1: Licensing Core (Completed)
- 12 OSI-approved SPDX license catalog with full legal texts, permissions, and conditions.
- Deterministic 4-question licensing recommendation engine.
- Interactive Explorer, Comparator, and Questionnaire frontend pages.
- Public repository license analyzer auditing root files, notices, manifests, and badges.
- Automated Pull Request flow via GitHub App creating `chore/add-license-<spdx>` branches.
- Webhook HMAC SHA-256 verification and delivery deduplication.
- Apache-2.0 license adoption with attribution preservation in `NOTICE`.

### Phase 2: Capability Registry & Initial Standards (Completed)
- Capability registry (`src/core/capabilities/registry.js`) establishing clear service boundaries across the six core product modules.
- Initial community document generators: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 3.0), `SECURITY.md`, `SUPPORT.md`.
- Shared PR and branch infrastructure (`src/core/pullRequests/`).
- Initial community web UI (`public/community.html`).

### Phase 3: Community Module Completion & Repository Rename (Completed)
- **Repository Rename:** Renamed GitHub repository from `ayushcmd/license-advisor` to `ayushcmd/open-workers` and updated git remotes.
- **Issue Templates Generator:** Structured GitHub issue forms (`bug_report.md`, `feature_request.md`, `documentation.md`) under `.github/ISSUE_TEMPLATE/` with YAML front matter validation.
- **PR Template Generator:** Pull request template (`.github/PULL_REQUEST_TEMPLATE.md`) with contributor checklists and testing guidelines.
- **Community Health Audit:** Deep inspection across root, `.github/`, and `docs/` directories for 6 standard files with health scoring (`POST /api/community/analyze`).
- **Consolidated Community PRs:** Multi-document selection, conflict preview (`POST /api/community/preview-pr`), caller authorization check, and single-PR deployment via GitHub App (`POST /api/community/trigger-pr`).
- **Branding Implementation:** Official Open Workers logo, favicon suite, banner, social card, and updated architecture diagrams.

### Phase 4: Security Module & Configuration Automation (Completed)
- **Repository Security Audit:** Non-destructive inspection of `SECURITY.md`, `.github/dependabot.yml`, `.github/workflows/codeql.yml`, branch protection, and secret scanning settings with transparent hygiene scoring (`POST /api/security/analyze`).
- **Dependabot Configuration Generator:** Schema-compliant `.github/dependabot.yml` generator supporting npm, pip, actions, docker, maven, gradle, bundler, and cargo.
- **CodeQL Workflow Generator:** Modern GitHub Actions CodeQL Action v3 workflow generator (`.github/workflows/codeql.yml`) supporting multi-language matrix builds.
- **Security PR Previews & Automation:** Conflict detection (`POST /api/security/preview-pr`) and automated PR creation (`POST /api/security/trigger-pr`) with dedicated branch isolation, caller authorization, and explicit `workflows: write` permission safety checks.
- **Test Suite:** 103 passing tests across 19 test suites with zero failures.

### Phase 5: Documentation Module & Quality Automation (Completed)
- **Repository README Completeness & Structure Audit:** Non-destructive inspection of README format, essential sections, dedicated `docs/` folder, and changelog (`POST /api/documentation/analyze`).
- **README Generator & Improvement Assistant:** Generates clean initial scaffolds or non-destructively injects missing sections into existing READMEs while strictly preserving license notices and existing text (`POST /api/documentation/generate`).
- **Conventional Commits Changelog Generator:** Inspects commit histories, categorizes commits into semantic Conventional Commits groups, and prepends to `CHANGELOG.md` (`POST /api/documentation/generate`).
- **Shields.io Status Badge Generator:** Deterministic badge Markdown generator supporting License, Workflow, Release, Stars, Issues, Contributors, and Node.js badges (`POST /api/documentation/generate`).
- **Markdown Broken Link Checker:** Validates relative repository paths and external URLs with SSRF protection blocking private IP, loopback, and cloud metadata targets (`POST /api/documentation/check-links`).
- **Documentation PR Automation:** Pre-commit preview (`POST /api/documentation/preview-pr`) and automated PR creation on `chore/improve-docs` (`POST /api/documentation/trigger-pr`) with caller in-memory write authorization.
- **Test Suite:** 127 passing tests across 26 test suites with zero failures.

### Phase 6b: Repository Automation Module (Completed)
- **Repository Setup & Metadata Audit:** Non-destructive remote audit of CI workflows, code quality configurations (.editorconfig, Prettier, ESLint, .gitattributes, .gitignore), and discovery metadata with transparent 0–100% health scoring (`POST /api/automation/analyze`).
- **Tailored CI Workflow Generators:** Valid, deterministic YAML workflow generation for Node.js CI, Python CI, Multi-Platform Matrix CI, PR Validation, and Scheduled Maintenance using official actions (v4/v5), minimal token permissions (`contents: read`), explicit timeouts (`timeout-minutes: 15-20`), bounded matrices, and injection defenses (`POST /api/automation/generate`).
- **Workflow Health Inspector:** Scans existing `.github/workflows/*.yml` files for unpinned third-party actions, deprecated action references, missing explicit permissions, broad `write-all` permissions, missing timeouts, and dangerous `pull_request_target` triggers (`POST /api/automation/inspect-workflows`).
- **Code Quality Configuration Generators:** Standardized configurations for `.editorconfig`, `.prettierrc.json`, modern flat `eslint.config.js`, `.gitattributes`, and `.gitignore` with safe non-destructive merging.
- **Consolidated Automation Pull Requests:** Multi-file pre-commit preview (`POST /api/automation/preview-pr`) and automated PR creation on dedicated `ci/*` or `chore/*` branches (`POST /api/automation/trigger-pr`) with in-memory caller write PAT verification and strict enforcement of the GitHub App's `workflows: write` permission boundary.
- **Test Suite:** 205 passing tests across 39 test suites with zero failures.

---

### Phase 6: PR & Issue Management Module (Completed)
- **Deterministic Issue Categorization & Labeling:** Keyword-based classification across 8 core categories (`bug`, `feature`, `documentation`, `question`, `enhancement`, `performance`, `maintenance`, `security`) with transparent score explanations, preview labeling, and confidential security advisory routing.
- **Pull Request Quality & Size Checks:** Comprehensive review checklist inspector (description length, open tasks, issue references, tests, breaking changes, Conventional Commits titles, draft status) and line-based size classification (`size/XS` through `size/XL`) with lockfile inflation warnings and mutual-exclusion managed size label replacement.
- **Contributor Welcome & Duplicate Suggestions:** Automated first-time contributor greetings using idempotency comment markers (`<!-- open-workers:welcome -->`); duplicate issue discovery using token and title similarity without auto-closing.
- **Stale Issue & Inactive PR Triage:** Non-destructive stale inspection flagging dormant items against configurable inactivity thresholds with security and exempt label protections.
- **Semantic Release Notes Compiler:** Conventional Commits aggregation of merged pull requests with Markdown preview, copy, and download.
- **Opt-In Webhook Automation Engine:** Verified GitHub webhook event dispatcher (`src/core/events/dispatcher.js`) routing `issues` and `pull_request` events with bot loop prevention and strict opt-in gating via repository `.github/open-workers.yml` configuration.
- **Test Suite:** 169 passing tests across 34 test suites with zero failures.

---

## 3. Phased Roadmap (Six Core Modules)

### Phase 4: Security Module (`security`) — Completed
- **Objective:** Provide actionable repository security audits, automated security configurations, and vulnerability guidance.
- **Deliverables:**
  - Dependabot configuration generator (`.github/dependabot.yml`) supporting npm, GitHub Actions, pip, etc.
  - CodeQL static analysis starter workflow.
  - Branch protection rule recommendations and audit.
  - Security configuration health scorecard.
  - Integration with GitHub App to open security configuration Pull Requests (`chore/configure-security`).

### Phase 5: Documentation Module (`documentation`) — Completed
- **Objective:** Help developers maintain accurate, complete, and engaging project documentation.
- **Deliverables:**
  - Repository README analysis: completeness score, missing sections detector (Installation, Usage, Contributing, License).
  - Automated `CHANGELOG.md` generator based on Conventional Commits history.
  - Shields.io badge generator for licenses, build status, versioning, and documentation.
  - Markdown broken-link auditor for repository documentation with SSRF protection.
  - Pull Request workflow to deploy documentation enhancements (`chore/improve-docs`).

### Phase 6: PR & Issue Management (`issues`) — Completed
- **Objective:** Streamline everyday maintenance workflows, issue triage, and collaboration quality.
- **Deliverables:**
  - Automated rule-based labeling for incoming issues and pull requests with preview and mutation safety.
  - First-time contributor welcome bot with customizable community links and idempotency markers.
  - Pull request checklist verification and quality status assessment.
  - Size classification (`size/XS` to `size/XL`) with lockfile detection.
  - Stale issue and inactive PR triage inspection without destructive auto-closing.
  - Release notes compilation from merged PR labels and Conventional Commits.
  - Opt-in GitHub webhook event dispatching gated by `.github/open-workers.yml`.

### Phase 6b: Repository Automation (`automation`) — Completed
- **Objective:** Automated repository health maintenance and CI/CD workflow generation.
- **Repository Automation Deliverables:**
  - GitHub Actions CI starter workflow generator (Node.js, Python, multi-platform matrix).
  - Action Health Inspector: detects unpinned 3rd-party actions, deprecated runners, and missing timeout settings.
  - Code style configuration generator (`.editorconfig`, `.prettierrc`, ESLint).
  - Opt-in scheduled maintenance tasks.

### Phase 7: Production App & Marketplace Rebranding Cutover
- **Objective:** Final cutover of external production integrations.
- **Deliverables:**
  - Rename production GitHub App from `open-license-advisor` to `open-workers` on `github.com/settings/apps`.
  - Update GitHub Marketplace listing title, description, and icons to **Open Workers**.
  - Migrate production Render domain from `license-advisor.onrender.com` to `open-workers.onrender.com` with 301 redirects.
  - Update environment variables (`GITHUB_APP_SLUG`, etc.) across deployment environments.
