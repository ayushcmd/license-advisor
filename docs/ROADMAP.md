# Open Workers — Development Roadmap

This document outlines the phased evolution of **Open Workers**, organized around our **six core product modules**.

---

## 1. Evolution Timeline

```
[Phase 1: Licensing Core]  -->  [Phase 2: Registry & Standards]  -->  [Phase 3: Community PRs & Branding]
         COMPLETED                           COMPLETED                             COMPLETED
                                                                                          |
                                                                                          v
[Phase 4: Security Module]     -->  [Phase 5: Documentation]     -->  [Phase 6: PR, Issues & Automation]
         COMPLETED                           COMPLETED                             PLANNED
                                                                                          |
                                                                                          v
                                                                      [Phase 7: Production Rebranding Cutover]
                                                                                   PLANNED
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
  - Pull Request workflow to deploy documentation enhancements (`chore/improve-docs`).

### Phase 6: PR & Issue Management (`issues`) and Repository Automation (`automation`)
- **Objective:** Streamline everyday maintenance workflows, issue triage, and continuous integration.
- **PR & Issue Management Deliverables:**
  - Automated rule-based labeling for incoming issues and pull requests.
  - First-time contributor welcome bot with customizable responses.
  - Pull request checklist verification.
  - Stale issue and inactive PR triage rules.
  - Release notes compilation from merged PR labels and milestone data.
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
