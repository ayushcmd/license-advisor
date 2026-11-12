# GitHub License Advisor

A lightweight, database-free web application and GitHub App that helps developers choose, compare, generate, and add appropriate open-source licenses to their repositories via automated pull requests.

## Key Capabilities

- **Policy-Driven Recommendations**: Evaluates permissions, distribution requirements, copyleft obligations, patent grants, and network-use triggers rather than guessing from programming languages.
- **SPDX License Explorer & Side-by-Side Comparison**: Clear breakdowns of permissions, conditions, and limitations across popular OSI-approved licenses.
- **Live Repository Analyzer**: Inspects public GitHub repositories on demand to detect existing `LICENSE` files, repository metadata, and potential licensing considerations.
- **Automated GitHub App PR Workflow**: Creates a dedicated branch, commits the customized license file, and opens an explanatory pull request after explicit developer confirmation.
- **Database-Free & Stateless Architecture**: Static vanilla HTML/CSS/ES6 frontend paired with a stateless Node.js + Express backend.

## Architecture Overview

- **Frontend (`public/`)**: Pure semantic HTML5, GitHub-native vanilla CSS, and modular ES6 JavaScript without build tools or heavy client frameworks.
- **Backend (`src/`)**: Express.js server handling REST endpoints, GitHub App authentication (`@octokit/app`), repository mutations (`@octokit/rest`), and HMAC SHA-256 webhook verification (`@octokit/webhooks`).
- **Tests (`tests/`)**: Native Node.js test runner (`node --test`) suites for recommendation logic and webhook signature verification.

## Quick Start

> **Note:** Project scaffolding is currently in Phase 1. Core modules and documentation will be added across Phases 2–6.

1. Copy `.env.example` to `.env` and configure your GitHub App credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run tests:
   ```bash
   npm test
   ```
4. Start the server:
   ```bash
   npm start
   ```

## Documentation

Planned guides under `docs/`:
- `docs/ARCHITECTURE.md` — Vanilla stack & GitHub App flow
- `docs/DEVELOPMENT.md` — Local testing & `smee.io` webhook proxy setup
- `docs/GITHUB_APP_SETUP.md` — Step-by-step GitHub App registration
- `docs/MARKETPLACE_GUIDELINES.md` — GitHub Marketplace listing checklist & assets
- `docs/SECURITY.md` — Private key handling & webhook signature verification

