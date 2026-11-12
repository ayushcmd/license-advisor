# GitHub Marketplace Listing Guidelines & Checklist

This checklist prepares **GitHub License Advisor** for submission to the GitHub Marketplace under a **Free** plan tier.

## 1. Visual & Brand Assets

- [x] **Marketplace Icon (`public/assets/logo-200x200.png`):** `200×200 px` PNG raster logo on a solid `#FFFFFF` background (converted from `public/assets/logo.svg`).
- [x] **No Prohibited Branding:** Does not reuse GitHub's Octocat trademark or copyrighted third-party logos.
- [x] **UI Consistency:** Crisp `#FFFFFF` light background, GitHub-native typography, accessible contrast, and responsive layout across desktop and mobile viewports.

## 2. Required Listing URLs & Endpoints

Ensure your deployed public HTTPS host exposes these working endpoints before submitting the draft Marketplace listing:

| Marketplace Field | Application Path | Notes |
| :--- | :--- | :--- |
| **Homepage URL** | `https://<domain>/` | Served from `public/index.html` |
| **Setup / Configuration URL** | `https://<domain>/app-install.html` | Guides repository selection and automated PR preview |
| **Privacy Policy URL** | `https://<domain>/privacy.html` | Explains zero-database, stateless API & webhook behavior |
| **Support URL** | `https://<domain>/support.html` | Troubleshooting guide, GitHub Issues link, and maintainer email |
| **Webhook URL** | `https://<domain>/api/webhooks` | HTTPS endpoint verified via `X-Hub-Signature-256` |
| **Health Endpoint** | `https://<domain>/api/health` | Returns `200 OK` JSON readiness status |

## 3. Pricing Plan Configuration

- **Plan Type:** **Free** (zero billing, no trials or paid tiers).
- Because the app operates exclusively on a Free plan without charging users, Marketplace billing webhook handling (`marketplace_purchase`) is not required for paid checkout flows, and `/api/config` explicitly advertises `"planTier": "free"`.

## 4. Technical & Security Compliance Checklist

- [x] **Least-Privilege Permissions:** Only `Metadata: Read-only`, `Contents: Read & write`, and `Pull requests: Read & write`.
- [x] **Webhook Signature Verification:** `POST /api/webhooks` validates `X-Hub-Signature-256` against raw unparsed payload bytes via `@octokit/webhooks`.
- [x] **Duplicate Delivery Protection:** `X-GitHub-Delivery` IDs are deduplicated in memory after signature verification.
- [x] **Non-Destructive Repository Edits:** Refuses (`409 Conflict`) to overwrite existing `LICENSE` / `LICENSE.md` files and never pushes commits directly to default branches.
- [x] **Public Visibility:** GitHub App configured to allow installation on **Any account**, with verified publisher domain (`https://<domain>`) configured in GitHub organization/account settings.

## 5. Plain-Language Listing Copy (Suggested Template)

- **Short Description:** Policy-first open-source license selector, side-by-side SPDX comparator, repo analyzer, and automated LICENSE pull request assistant.
- **Detailed Description:**
  > GitHub License Advisor helps maintainers choose an appropriate open-source license without guesswork. Instead of guessing from programming languages, it evaluates permissions, distribution rules, copyleft boundaries, explicit patent grants, dependency compatibility, and network-use triggers across 12 verified OSI-approved SPDX licenses. Audit existing repositories on demand, compare licenses side by side, customize copyright notices, and approve adding a `LICENSE` file via an isolated feature branch and explanatory pull request.
- **Informational Disclaimer:** Summaries are provided for developer guidance and do not constitute formal legal advice.

