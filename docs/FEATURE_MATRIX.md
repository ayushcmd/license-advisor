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
| `issues` | **PR & Issue Management** | Workflow | **Available** | `/api/issues/*`, `/api/pulls/*` | `/issues.html` |
| `automation` | **Repository Automation** | Workflow | **Available** | `/api/automation/*` | `/automation.html` |

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

### E. PR & Issue Management Module (`issues`) — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Issue Capabilities** | Discover issue/PR features, checks, and supported categories | `GET /api/issues/capabilities` | None (Public) | Production | `tests/issues.test.js` |
| **Issue Categorization** | Deterministic rule-based categorization with security vulnerability flags | `POST /api/issues/analyze` | None (Public / App) | Production | `tests/issues.test.js` |
| **Duplicate Issue Suggestions** | Vocabulary & title similarity search over candidate issues | `POST /api/issues/duplicates` | None (Public / App) | Production | `tests/issues.test.js` |
| **Stale Issue Inspector** | Inactivity threshold detection with security and pinned exemptions | `POST /api/issues/stale` | None (Public / App) | Production | `tests/issues.test.js` |
| **Label Modification Preview** | Preview new vs existing vs missing repository labels | `POST /api/issues/preview-labels` | None (Public / App) | Production | `tests/issues.test.js` |
| **Authorized Label Application** | Apply approved labels to issues without overwriting existing labels | `POST /api/issues/apply-labels` | User PAT (write) + App (`issues: write`) | Production | `tests/issues.test.js` |
| **PR Quality & Checklist Audit** | Evaluates description, linked issues, tests, checklist tasks, draft status | `POST /api/pulls/analyze` | None (Public / App) | Production | `tests/issues.test.js` |
| **PR Size Classification** | Classifies size (XS to XL) and flags lockfile inflation | `POST /api/pulls/size` | None (Public / App) | Production | `tests/issues.test.js` |
| **Release Notes Preparation** | Compiles merged PRs into Conventional Commits release notes | `POST /api/pulls/release-notes` | None (Public / App) | Production | `tests/issues.test.js` |
| **PR Action Preview** | Preview managed size label update or first-timer welcome comment | `POST /api/pulls/preview-action` | None (Public / App) | Production | `tests/issues.test.js` |
| **Authorized PR Action** | Apply managed size label or post welcome comment with marker | `POST /api/pulls/execute-action` | User PAT (write) + App (`issues: write`, `pull_requests: write`) | Production | `tests/issues.test.js` |
| **Opt-In Webhook Automation** | Event dispatcher routing `issues` and `pull_request` events via `.github/open-workers.yml` | Webhook Receiver | App Webhook Secret + App Scopes | Production | `tests/issues.test.js` |

### F. Repository Automation Module (`automation`) — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Setup & Check Discovery** | List supported repository checks and automation templates | `GET /api/automation/checks`, `GET /api/automation/templates` | None (Public) | Production | `tests/automation.test.js` |
| **Repository Setup Audit** | Non-destructive inspection of CI workflows, linters, formatters, and repo discovery metadata | `POST /api/automation/analyze` | None (Public / App) | Production | `tests/automation.test.js` |
| **Workflow Health Inspector** | Audits workflows for unpinned actions, deprecated runners, missing timeouts, and trigger safety | `POST /api/automation/inspect-workflows` | None (Public / App) | Production | `tests/automation.test.js` |
| **CI Workflow Generators** | Generates tailored Node.js, Python, Multi-Platform Matrix, PR Validation, and Maintenance CI workflows | `POST /api/automation/generate` | None (Public) | Production | `tests/automation.test.js` |
| **Code Quality Generators** | Generates standard `.editorconfig`, `.prettierrc.json`, flat `eslint.config.js`, `.gitattributes`, and `.gitignore` | `POST /api/automation/generate` | None (Public) | Production | `tests/automation.test.js` |
| **PR Preview & Conflict Guard** | Previews generated workflows/configs, detects conflicts, and checks `workflows: write` permissions | `POST /api/automation/preview-pr` | None (Public / App) | Production | `tests/automation.test.js` |
| **Consolidated Automation PR** | Multi-file deployment on dedicated feature branch with caller PAT authorization and SHA tracking | `POST /api/automation/trigger-pr` | User PAT (write) + App (`contents: write`, `pull_requests: write`, plus `workflows: write` for workflows) | Production | `tests/automation.test.js` |

### G. Unified Repository Dashboard — Status: Available

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cross-Module Inspection** | Orchestrates 6-module analysis with error isolation via `Promise.allSettled` | `POST /api/dashboard/analyze` | None (Public repos) / User PAT (Private repos) | Production | `tests/dashboard.test.js` |
| **Action Item Prioritization** | Aggregates findings and normalizes recommendations sorted by severity (High, Medium, Low) | `POST /api/dashboard/analyze` | None (Public) | Production | `tests/dashboard.test.js` |
| **Unified UI Overview** | Primer-inspired interface presenting repository metadata, 6 capability cards, and action pills | `/dashboard.html` | None (Browser) | Production | `tests/dashboard.test.js` |
| **Direct Tool Navigation** | Pre-fills query parameters (`?repo=owner%2Frepo`) linking directly to specialized capability tools | Client Navigation | None (Browser) | Production | `tests/dashboard.test.js` |
| **Private Repo Privacy Guard** | Rejects unauthenticated private repo audits (401) and verifies collaborator access (403) | `POST /api/dashboard/analyze` | `Authorization: Bearer <token>` | Production | `tests/dashboard.test.js` |

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
