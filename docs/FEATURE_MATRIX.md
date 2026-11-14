# Open Workers — Feature Matrix

This matrix documents the capability status, API endpoints, user interfaces, required permissions, and test coverage across the **six core Open Workers product modules**.

---

## 1. Six Core Product Modules Overview

| Module ID | Display Name | Category | Status | API Base | UI Page |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `licensing` | **Licensing** | Governance | **Available** | `/api/*` | `/explorer.html`, `/questionnaire.html`, `/compare.html`, `/analyzer.html`, `/app-install.html` |
| `community` | **Community** | Community | **Available** | `/api/community/*` | `/community.html` |
| `security` | **Security** | Security | **Available** | `/api/security/*` | `/security.html` |
| `documentation` | **Documentation** | Documentation | **Available** | `/api/documentation/*` | `/documentation.html` |
| `issues` | **PR & Issue Management** | Workflow | *Upcoming* | `/api/issues/*` | *(Planned)* |
| `automation` | **Repository Automation** | Workflow | *Upcoming* | `/api/automation/*` | *(Planned)* |

---

## 2. Detailed Feature Breakdown

### A. Licensing Module (`licensing`) — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SPDX Catalog** | 12 OSI-approved licenses with metadata and full texts | `GET /api/licenses`, `GET /api/licenses/:id` | None (Public) | Production | `tests/catalog.test.js` |
| **Policy Questionnaire** | 4-question policy recommendation engine | `POST /api/recommend` | None (Public) | Production | `tests/recommendation.test.js` |
| **License Comparison** | Side-by-side comparison of candidate licenses | `POST /api/compare` | None (Public) | Production | `tests/comparison.test.js` |
| **Repository Analyzer** | On-demand scan for LICENSE, NOTICE, manifests, badges | `POST /api/analyze` | None (Public API / App) | Production | `tests/analyzer.test.js` |
| **Automated License PR** | Dedicated branch creation, license file commit, isolated PR | `POST /api/trigger-pr` | `contents: write`, `pull_requests: write` | Production | `tests/pr-service.test.js`, `tests/http-integration.test.js` |
| **README License Badges** | Automated insertion/replacement of license badges in README | Internal service | `contents: write` | Production | `tests/readme.test.js` |

### B. Community Module (`community`) — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Template Discovery** | List community templates with category filtering | `GET /api/community/templates` | None (Public) | Production | `tests/community.test.js` |
| **Document Generator** | Generate CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT | `POST /api/community/generate` | None (Public) | Production | `tests/community.test.js` |
| **Issue Template Generator** | Bug report, feature request, docs improvement under `.github/ISSUE_TEMPLATE/` | `POST /api/community/generate` | None (Public) | Production | `tests/community.test.js` |
| **PR Template Generator** | Pull request template with checklists (`.github/PULL_REQUEST_TEMPLATE.md`) | `POST /api/community/generate` | None (Public) | Production | `tests/community.test.js` |
| **Community Health Audit** | Audit root, `.github/`, `docs/` for 6 standard files; score repository | `POST /api/community/analyze` | None (Public / App token) | Production | `tests/community.test.js` |
| **PR Conflict Preview** | Preview multi-file PR, branch name, and check existing file conflicts | `POST /api/community/preview-pr` | None (Public / App token) | Production | `tests/community.test.js` |
| **Consolidated Community PR** | Commit multi-file changes and open single PR via GitHub App | `POST /api/community/trigger-pr` | User PAT (write) + App (`contents: write`, `pull_requests: write`) | Production | `tests/community.test.js` |

### C. Security Module (`security`) — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Security Checks & Discovery** | List supported security checks and configuration templates | `GET /api/security/checks`, `GET /api/security/templates` | None (Public) | Production | `tests/security.test.js` |
| **Security Configuration Audit** | Non-destructive inspection of policy, Dependabot, CodeQL, branch protection, secret scanning | `POST /api/security/analyze` | None (Public / App token) | Production | `tests/security.test.js` |
| **Dependabot Generator** | Valid YAML generator supporting npm, pip, actions, docker, maven, gradle, bundler, cargo | `POST /api/security/generate` | None (Public) | Production | `tests/security.test.js` |
| **CodeQL Workflow Generator** | GitHub Actions CodeQL Action v3 workflow generator with multi-language matrix and build modes | `POST /api/security/generate` | None (Public) | Production | `tests/security.test.js` |
| **PR Preview & Conflict Check** | Check existing file conflicts and verify workflow permission requirements | `POST /api/security/preview-pr` | None (Public / App token) | Production | `tests/security.test.js` |
| **Consolidated Security PR** | Deploy configurations on dedicated branch via GitHub App with safety checks | `POST /api/security/trigger-pr` | User PAT (write) + App (`contents: write`, `pull_requests: write`, plus `workflows: write` for workflows) | Production | `tests/security.test.js` |

### D. Documentation Module (`documentation`) — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Docs Checks & Discovery** | List supported documentation checks and generation templates | `GET /api/documentation/checks`, `GET /api/documentation/templates` | None (Public) | Production | `tests/documentation.test.js` |
| **README Completeness Audit** | Audit README format, key developer sections, docs/ folder, changelog | `POST /api/documentation/analyze` | None (Public / App token) | Production | `tests/documentation.test.js` |
| **README Generator & Assistant** | Generate new README or non-destructively improve existing content | `POST /api/documentation/generate` | None (Public) | Production | `tests/documentation.test.js` |
| **Changelog Generator** | Generate Conventional Commits changelog, prepend to existing file | `POST /api/documentation/generate` | None (Public) | Production | `tests/documentation.test.js` |
| **Badge Generator** | Generate Shields.io Markdown badges (license, workflow, release, stars, etc.) | `POST /api/documentation/generate` | None (Public) | Production | `tests/documentation.test.js` |
| **Markdown Link Checker** | Validate relative repo paths and safe external URLs with SSRF protection | `POST /api/documentation/check-links` | None (Public / App token) | Production | `tests/documentation.test.js` |
| **PR Conflict Preview** | Preview documentation PR files, branch name, and check existing file conflicts | `POST /api/documentation/preview-pr` | None (Public / App token) | Production | `tests/documentation.test.js` |
| **Consolidated Documentation PR** | Multi-file documentation pull request on `chore/improve-docs` via GitHub App | `POST /api/documentation/trigger-pr` | User PAT (write) + App (`contents: write`, `pull_requests: write`) | Production | `tests/documentation.test.js` |

### E. Upcoming Modules (Roadmap)

| Module | Planned Capabilities & Subfeatures | Target Scope |
| :--- | :--- | :--- |
| **`issues`** | &bull; Rule-based issue and pull request automated labeling<br>&bull; PR classification and contributor welcome automation<br>&bull; PR checklist completeness enforcement<br>&bull; Inactive issue and pull request triage<br>&bull; Release notes compilation from merged pull requests | Upcoming |
| **`automation`** | &bull; GitHub Actions CI/CD starter workflow generation (build, test, lint, matrix)<br>&bull; Workflow Health Inspector (unpinned actions, deprecated runners, missing timeouts)<br>&bull; Code style config generation (`.editorconfig`, `.prettierrc`, ESLint configs)<br>&bull; Scheduled repository maintenance tasks | Upcoming |

---

## 3. Two-Layer Permission & Security Architecture

1. **User Identity & Write Permission Layer:**
   - Callers initiating mutation requests pass a GitHub token in the `Authorization: Bearer <token>` header.
   - The token is verified in-memory against the GitHub REST API (`@octokit/rest`).
   - The caller must hold `admin`, `maintain`, or `write` collaborator permissions on the target repository.
   - Tokens are never stored on disk, cached in memory, or logged.
2. **Execution Layer:**
   - Once authorized, mutations are executed using the GitHub App's scoped installation credentials.
   - Permissions are strictly least-privilege: `contents: write` and `pull_requests: write`.
3. **Branch Isolation & Conflict Guards:**
   - Changes are committed exclusively to isolated feature branches (`chore/*`).
   - The repository's default branch is never modified directly.
   - Pre-commit conflict checks prevent overwriting existing files unless explicit `replaceExisting: true` opt-in is provided.
