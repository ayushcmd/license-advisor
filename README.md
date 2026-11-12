# GitHub License Advisor

A lightweight, database-free web application and least-privilege GitHub App that helps developers choose, compare, generate, and add verified SPDX open-source licenses to their repositories via automated pull requests.

## Core Features

- **Policy-First Recommendations:** Never guesses licenses from programming languages. Evaluates permissions, distribution obligations, copyleft scope, explicit patent grants/retaliation, non-endorsement clauses, network-use triggers (`AGPL-3.0-only`), and inbound dependency compatibility.
- **12 Verified OSI-Approved SPDX Licenses:** Complete official texts, permissions, conditions, limitations, and plain-language guides for `MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `MPL-2.0`, `EPL-2.0`, `LGPL-3.0-only`, `GPL-2.0-only`, `GPL-3.0-only`, `AGPL-3.0-only`, and `Unlicense`.
- **Side-by-Side Comparison & Compatibility Checker:** Compare up to 4 licenses across 12 policy dimensions and audit inbound dependency conflicts (`compatible`, `conditional`, `incompatible`).
- **Live Repository Analyzer:** Inspect public repositories (and GitHub App-installed private repositories via `POST /api/analyze`) for existing `LICENSE` files, `NOTICE` files, and dependency manifests.
- **Customizable LICENSE & Header Generator:** Populate copyright year/holder templates cleanly and export `LICENSE` files or per-file SPDX headers.
- **Automated GitHub App PR Workflow:** Creates an isolated feature branch (`chore/add-license-<spdx>`), refuses (`409 Conflict`) to overwrite an existing license file, commits `LICENSE`, and opens an explanatory Pull Request.
- **GitHub Native Minimal UI:** Built strictly with semantic HTML5, pure vanilla CSS (`public/css/base.css`, `components.css`), and ES6 modules with zero build step or external databases.

## Project Structure

```text
license-advisor/
├── public/                     # Static vanilla HTML5, CSS, assets, and shared ES6 modules
│   ├── index.html              # Overview & policy-first guide
│   ├── explorer.html           # Searchable 12-license SPDX catalog & generator
│   ├── questionnaire.html      # Interactive recommendation wizard + dependency filter
│   ├── compare.html            # Side-by-side matrix & compatibility checker
│   ├── analyzer.html           # On-demand GitHub repository analyzer
│   ├── app-install.html        # GitHub App setup & automated PR trigger UI
│   ├── privacy.html            # Privacy policy (Marketplace URL)
│   ├── support.html            # Support & troubleshooting (Marketplace URL)
│   ├── assets/
│   │   ├── logo.svg            # Crisp vector brand icon
│   │   └── logo-200x200.png    # 200x200 px PNG icon for GitHub Marketplace
│   ├── css/
│   │   ├── base.css            # GitHub Primer light tokens, typography, layout
│   │   └── components.css      # Buttons, boxes, badges, tables, alerts, forms
│   └── js/
│       ├── catalog-data.js     # Verified SPDX license metadata & official texts
│       ├── engine.js           # Deterministic policy & compatibility engine
│       ├── generator.js        # Copyright template & SPDX header formatter
│       ├── analyzer.js         # GitHub REST API client & root tree auditor
│       └── app.js              # XSS-safe UI coordinator
├── src/                        # Express.js & Octokit backend
│   ├── config/github.js        # PEM key loader & @octokit/app setup
│   ├── routes/
│   │   ├── api.js              # REST API endpoints
│   │   └── webhooks.js         # HMAC SHA-256 webhook receiver
│   ├── services/
│   │   ├── licenseService.js   # Backend validation & repo audit orchestration
│   │   └── prService.js        # Feature branch, commit & PR generator
│   └── server.js               # Helmet CSP, CORS, raw webhook & static server
├── docs/                       # Architecture, dev, setup, Marketplace & security guides
├── tests/                      # Native node:test unit & HTTP integration suites
├── .env.example
├── LICENSE
└── package.json
```

## Quick Start

1. **Install dependencies** (requires Node.js `>=20.0.0`):
   ```bash
   npm install
   ```
2. **Configure environment variables** (optional for static UI/public analysis; required for automated PRs and webhooks):
   ```bash
   cp .env.example .env
   ```
3. **Run tests & syntax verification:**
   ```bash
   npm test
   npm run lint:syntax
   ```
4. **Start the server:**
   ```bash
   npm start
   # or with watch mode during development:
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Node runtime mode |
| `APP_URL` | No | `http://localhost:3000` | Public base URL of the app |
| `ALLOWED_ORIGINS` | No | `APP_URL` | Comma-separated CORS allowed origins |
| `GITHUB_APP_ID` | For App/PRs | — | Numeric GitHub App ID |
| `GITHUB_APP_SLUG` | No | `github-license-advisor` | App URL slug for install links |
| `GITHUB_WEBHOOK_SECRET` | For Webhooks | — | HMAC SHA-256 webhook secret |
| `GITHUB_PRIVATE_KEY_PATH` | For App/PRs* | — | Path to local `.pem` private key |
| `GITHUB_PRIVATE_KEY` | For App/PRs* | — | Inline PEM key with `\n` escapes (alternative to path) |
| `GITHUB_PUBLIC_TOKEN` | No | — | Optional token for higher public REST rate limits |
| `WEBHOOK_PROXY_URL` | No | — | Optional `smee.io` proxy URL for local dev |

*\*Provide either `GITHUB_PRIVATE_KEY_PATH` or `GITHUB_PRIVATE_KEY` when enabling the GitHub App.*

## API & Webhook Endpoints

| Method & Path | Purpose |
| :--- | :--- |
| `GET /api/health` | Service readiness, database-free mode, and App/webhook configuration status |
| `GET /api/config` | Public non-secret metadata (`appSlug`, `installUrl`, `planTier`, permissions, SPDX version) |
| `POST /api/recommend` | Deterministic policy recommendation from criteria and `dependencyLicenses` |
| `POST /api/analyze` | Server-side inspection of public or App-installed private repositories (`{ "repo": "owner/repo" }`) |
| `POST /api/trigger-pr` | Creates feature branch, commits `LICENSE`, and opens PR (`{ "repo", "licenseId", "year", "holder" }`) |
| `POST /api/webhooks` | Receives signed `ping`, `installation`, `installation_repositories`, and `repository` webhooks |

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Local Development & `smee.io` Webhook Guide](docs/DEVELOPMENT.md)
- [GitHub App Registration Guide](docs/GITHUB_APP_SETUP.md)
- [GitHub Marketplace Listing Checklist](docs/MARKETPLACE_GUIDELINES.md)
- [Security Policy & Threat Controls](docs/SECURITY.md)

## Attribution & License

- **Project License:** Licensed under the [MIT License](LICENSE) (`Copyright (c) 2026 ayushcmd`).
- **SPDX License Data:** Official license texts and SPDX metadata in `public/js/catalog-data.js` are sourced from [spdx/license-list-data](https://github.com/spdx/license-list-data) (CC0-1.0).
- **Disclaimer:** All licensing explanations and recommendations are educational and informational only and do not constitute formal legal advice.
