# Open Workers — Development Roadmap

This document outlines the phased evolution of **Open Workers** from a standalone license advisor into a multi-purpose repository automation suite.

---

## Evolution Timeline

```
[Phase 1: Licensing Core]  -->  [Phase 2: Registry & Standards]  -->  [Phase 3: Community PRs & Rename]
         COMPLETED                           COMPLETED                             COMPLETED (Current)
                                                                                          |
                                                                                          v
[Phase 4: Workflow Automation]  <--  [Phase 5: Release Automation]  <--  [Phase 6: Quality & Security]
            PLANNED                             PLANNED                             PLANNED
                                                                                          |
                                                                                          v
                                                                        [Phase 7: Production Rebranding]
                                                                                   PLANNED
```

---

## Phase Breakdown

### Phase 1: Licensing Core (Completed)
- Deterministic 4-question licensing recommendation engine.
- 12 OSI-approved SPDX license catalog with full legal texts.
- Interactive Explorer, Comparator, and Questionnaire frontend pages.
- Public repository analyzer auditing `LICENSE`, `NOTICE`, manifests, and README badges.
- Automated Pull Request flow via GitHub App creating `chore/add-license-<spdx>` branches.
- HMAC SHA-256 webhook verification with duplicate delivery protection.
- Apache-2.0 repository license with attribution requirements.

### Phase 2: Capability Registry & Initial Standards (Completed)
- Capability registry (`src/core/capabilities/registry.js`) establishing clear service boundaries across 6 modules.
- Initial community document generators: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 3.0), `SECURITY.md`, `SUPPORT.md`.
- Shared PR and branch infrastructure (`src/core/pullRequests/`).
- Initial community web UI (`public/community.html`).

### Phase 3: Community Module Completion & Repository Rename (Completed — Current)
- **Repository Rename:** Renamed GitHub repository from `ayushcmd/license-advisor` to `ayushcmd/open-workers` and updated local git remote.
- **Issue Templates Generator:** Structured GitHub issue forms (`bug_report.md`, `feature_request.md`, `documentation.md`) under `.github/ISSUE_TEMPLATE/` with YAML front matter validation.
- **PR Template Generator:** Pull request template (`.github/PULL_REQUEST_TEMPLATE.md`) with contributor checklists and testing guidelines.
- **Community Health Audit:** Comprehensive inspection across root, `.github/`, and `docs/` directories with health scoring and actionable findings (`POST /api/community/analyze`).
- **Consolidated Community PRs:** Multi-document selection, conflict preview (`POST /api/community/preview-pr`), caller authorization check, and single-PR deployment via GitHub App (`POST /api/community/trigger-pr`).
- **Comprehensive Test Suite:** 77 passing tests across 14 test suites with zero failures.

---

## Upcoming Phases

### Phase 4: Workflow Automation Module (`workflows`)
- **Objective:** Streamline CI/CD pipeline configuration and Action health management.
- **Key Features:**
  - Automated generation of starter GitHub Actions workflows:
    - Node.js test & build workflow (`.github/workflows/ci.yml`).
    - Multi-platform matrix testing workflow.
    - Automated pull request labeling and size checks.
  - Action Health Inspector: Audit repository `.github/workflows/` for deprecated actions, unpinned third-party actions, and missing timeout settings.
  - Consolidated Workflow PR: Submit selected GitHub Actions workflows directly via GitHub App.

### Phase 5: Release Management Module (`releases`)
- **Objective:** Automate release preparation, semantic versioning, and changelogs.
- **Key Features:**
  - Conventional Commits analyzer to calculate the next semantic version (`major`, `minor`, `patch`).
  - Automated `CHANGELOG.md` generator categorizing features, fixes, and breaking changes.
  - Automated Release Preparation PR: Bumps package versions, updates changelogs, and drafts GitHub Releases.

### Phase 6: Code Quality & Security Standards (`quality` & `security`)
- **Objective:** Enforce coding consistency and security defaults.
- **Key Features:**
  - Generator for code style configs: `.editorconfig`, `.prettierrc`, ESLint configs.
  - Dependabot configuration generator (`.github/dependabot.yml`) with scheduled dependency updates.
  - Security advisory and vulnerability scanning guidance.

### Phase 7: Production App & Marketplace Rebranding
- **Objective:** Final cutover of external production integrations.
- **Key Features:**
  - Rename GitHub App from `open-license-advisor` to `open-workers` on `github.com/settings/apps`.
  - Update GitHub Marketplace listing title, description, and icons to **Open Workers**.
  - Migrate production Render domain from `license-advisor.onrender.com` to `open-workers.onrender.com` with 301 redirects.
  - Update environment variables (`GITHUB_APP_SLUG`, etc.) across deployment environments.
