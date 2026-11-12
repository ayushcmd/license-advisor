# Local Development & Testing Guide

## 1. Prerequisites

- **Node.js:** v20.0.0 or newer (developed and verified on Node v24.14.0 LTS)
- **npm:** v10+ (v11.20.0 verified)
- **Git:** For manual local version control

## 2. Initial Setup

```bash
git clone https://github.com/ayushcmd/license-advisor.git
cd license-advisor
npm install
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

> **Note:** The application degrades gracefully when GitHub App credentials are omitted in `.env`. All UI pages, the recommendation engine, the comparison matrix, and public repository analysis work immediately without App keys. Automated Pull Requests (`POST /api/trigger-pr`) and webhook verification (`POST /api/webhooks`) activate once credentials are configured.

## 3. Running Locally

Start the production-style server:

```bash
npm start
```

Start with automatic file-watch reloads (Node native `--watch`):

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

## 4. Running Tests & Syntax Checks

The repository uses Node's built-in `node:test` runner and `node:assert/strict` with zero external test framework dependencies:

```bash
npm test
npm run lint:syntax
```

Test suites in `tests/`:
- `tests/engine.test.js` — SPDX catalog integrity, deterministic policy recommendations, compatibility matrix, explanations, and template generation.
- `tests/analyzer.test.js` — Repository specifier parsing, root file inspection, audit classification, and mocked GitHub REST API behavior.
- `tests/webhook.test.js` — Credential loader, Helmet CSP, `/api/health` and `/api/config`, raw-body HMAC SHA-256 verification, and duplicate `X-GitHub-Delivery` protection.
- `tests/pr-service.test.js` — Validation, App-installed private repo inspection, feature-branch PR creation, `409 Conflict` license protection, and permission error handling.

## 5. Testing Webhooks Locally with `smee.io`

GitHub cannot send webhooks directly to `http://localhost:3000`. Use [smee.io](https://smee.io/) to forward webhook deliveries during local development:

1. Create a channel at [https://smee.io/new](https://smee.io/new) and copy the unique URL (e.g. `https://smee.io/AbCdEf123456`).
2. Set `WEBHOOK_PROXY_URL` in `.env` and configure that Smee URL as your development GitHub App's **Webhook URL**, using a strong random string for `GITHUB_WEBHOOK_SECRET`.
3. Forward deliveries to your local Express webhook receiver:

```bash
npx smee-client --url https://smee.io/AbCdEf123456 --target http://localhost:3000/api/webhooks
```

4. Keep `npm run dev` running in a second terminal. Installing, adding repositories, or clicking **Redeliver** in GitHub App Advanced settings will forward real `X-Hub-Signature-256` payloads to `/api/webhooks`.

## 6. Quick API Verification

Health check:

```bash
curl http://localhost:3000/api/health
```

Policy recommendation request:

```bash
curl -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"copyleftPreference":"permissive","patentProtection":"required"}'
```

Public repository audit:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"repo":"expressjs/express"}'
```

