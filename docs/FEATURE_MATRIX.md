# Open Workers — Feature Matrix

This matrix documents the capability status, API endpoints, user interfaces, required permissions, and test coverage across all Open Workers modules.

---

## 1. Module Overview

| Module ID | Display Name | Category | Status | API Base | UI Page |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `licensing` | Open Source Licensing | Governance | **Available** | `/api/*` | `/explorer.html`, `/questionnaire.html`, `/compare.html`, `/app-install.html`, `/analyzer.html` |
| `community` | Community Standards | Community | **Available** | `/api/community/*` | `/community.html` |
| `workflows` | Workflow Automation | CI/CD | *Upcoming* | `/api/workflows/*` | *(Planned)* |
| `releases` | Release Management | Delivery | *Upcoming* | `/api/releases/*` | *(Planned)* |
| `quality` | Code Quality & Standards | Quality | *Upcoming* | `/api/quality/*` | *(Planned)* |
| `security` | Security & Dependencies | Security | *Upcoming* | `/api/security/*` | *(Planned)* |

---

## 2. Detailed Feature Breakdown

### A. Licensing Module (`licensing`)

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SPDX Catalog** | 12 OSI-approved licenses with metadata and full texts | `GET /api/licenses`, `GET /api/licenses/:id` | None (Public) | Production | `tests/catalog.test.js` |
| **Policy Questionnaire** | 4-question policy recommendation engine | `POST /api/recommend` | None (Public) | Production | `tests/recommendation.test.js` |
| **License Comparison** | Side-by-side comparison of up to 4 licenses | `POST /api/compare` | None (Public) | Production | `tests/comparison.test.js` |
| **Repository Analyzer** | On-demand scan for LICENSE, NOTICE, manifests, badges | `POST /api/analyze` | None (Public API / App) | Production | `tests/analyzer.test.js` |
| **Automated License PR** | Dedicated branch creation, license file commit, isolated PR | `POST /api/trigger-pr` | `contents: write`, `pull_requests: write` | Production | `tests/pr-service.test.js`, `tests/http-integration.test.js` |
| **README License Badges** | Automated insertion/replacement of license badges in README | Internal service | `contents: write` | Production | `tests/readme.test.js` |

### B. Community Standards Module (`community`)

| Feature | Description | Endpoints | Permissions | Status | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Template Discovery** | List community templates with category filtering | `GET /api/community/templates` | None (Public) | Production | `tests/community.test.js` |
| **Document Generator** | Generate CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT | `POST /api/community/generate` | None (Public) | Production | `tests/community.test.js` |
| **Issue Template Generator** | Bug report, feature request, docs improvement under `.github/ISSUE_TEMPLATE/` | `POST /api/community/generate` | None (Public) | Production | `tests/community.test.js` |
| **PR Template Generator** | Pull request template with checklists (`.github/PULL_REQUEST_TEMPLATE.md`) | `POST /api/community/generate` | None (Public) | Production | `tests/community.test.js` |
| **Community Health Audit** | Audit root, `.github/`, `docs/` for 6 standard files; score repository | `POST /api/community/analyze` | None (Public / App token) | Production | `tests/community.test.js` |
| **PR Conflict Preview** | Preview multi-file PR, branch name, and check existing file conflicts | `POST /api/community/preview-pr` | None (Public / App token) | Production | `tests/community.test.js` |
| **Consolidated Community PR** | Commit multi-file changes and open single PR via GitHub App | `POST /api/community/trigger-pr` | User PAT (write) + App (`contents: write`, `pull_requests: write`) | Production | `tests/community.test.js` |

### C. Upcoming Modules (Roadmap)

| Module | Planned Features | Target Phase |
| :--- | :--- | :--- |
| **`workflows`** | GitHub Actions CI templates, Action health audit, automated workflow linting | Phase 4 |
| **`releases`** | Semantic versioning calculator, changelog generator, release notes PR automation | Phase 5 |
| **`quality`** | EditorConfig, Prettier, ESLint configuration templates, branch protection guidance | Phase 6 |
| **`security`** | Dependabot configuration generator, security advisories scanner, secret scanning guide | Phase 6 |

---

## 3. Security & Permission Model

All mutation operations enforce a strict two-layer security barrier:
1. **User Authorization Layer:** Callers must pass a valid personal access token in the `Authorization: Bearer <token>` header. Open Workers resolves the authenticated user in-memory via `@octokit/rest` and verifies that the user holds `admin`, `maintain`, or `write` permission on the target repository.
2. **Execution Layer:** If caller authorization passes, the GitHub App installation token is used to create feature branches, commit verified files, and open pull requests.
3. **Conflict Protection:** Default branches are never mutated directly. Changes occur on isolated feature branches (`chore/*`). If target files already exist, operations fail with `HTTP 409 Conflict` unless explicit `replaceExisting: true` opt-in is supplied.
