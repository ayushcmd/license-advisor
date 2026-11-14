# GitHub Marketplace Listing Guidelines & Checklist

This checklist prepares **Open Workers** for submission and maintenance on the GitHub Marketplace under a **Free** plan tier.

---

## 1. Visual & Brand Assets

- [x] **Marketplace Icon (`public/assets/open-workers-icon-512.png`):** High-resolution `512×512 px` PNG raster icon with crisp high-contrast squircle and electric green PR glyph.
- [x] **Vector Assets (`public/assets/open-workers-icon.svg`, `public/assets/open-workers-logo.svg`):** Scalable vector platform assets for desktop and responsive rendering.
- [x] **No Prohibited Branding:** Does not misuse GitHub's Octocat trademark or copyrighted third-party logos.
- [x] **UI Consistency:** GitHub Primer-inspired design tokens, accessible contrast, and zero layout shift.

---

## 2. Required Listing URLs & Canonical Endpoints

The deployed production environment exposes these verified canonical endpoints:

| Marketplace Field | Canonical URL | Description & Status |
| :--- | :--- | :--- |
| **Homepage URL** | `https://open-workers.onrender.com/` | Main Open Workers home page and capability catalog |
| **Customer Support URL** | `https://open-workers.onrender.com/support.html` | Troubleshooting guides, GitHub Issues link, and maintainer contact |
| **Privacy Policy URL** | `https://open-workers.onrender.com/privacy.html` | Explains zero-database, stateless API, in-memory token handling |
| **Status / Health URL** | `https://open-workers.onrender.com/api/health` | Returns `200 OK` JSON readiness status and catalog count |
| **Documentation URL** | `https://github.com/ayushcmd/open-workers#readme` | Complete repository documentation and development guide |
| **Company / Organization URL**| `https://github.com/ayushcmd/open-workers` | GitHub repository and author organization URL |
| **App Installation URL** | `https://github.com/apps/open-license-advisor` | Actual registered GitHub App installation page |
| **Setup / Configuration URL**| `https://open-workers.onrender.com/app-install.html` | Guides repository selection and automated PR preview |
| **Webhook URL** | `https://open-workers.onrender.com/api/webhooks` | HTTPS webhook endpoint verified via `X-Hub-Signature-256` |

> [!NOTE]
> **Terms of Service URL:** The GitHub Marketplace requires a dedicated Terms of Service URL. In earlier drafts, this field may have linked to the repository homepage. A repository README is informational documentation and should not be represented as a dedicated legal Terms of Service agreement. If a dedicated Terms of Service document is required by the Marketplace review team, a dedicated page (e.g. `terms.html`) should be established with approved legal terms.

---

## 3. Pricing Plan Configuration

- **Plan Type:** **Free** (zero cost, zero billing, no trials or paid tiers).
- Because Open Workers operates exclusively on a Free plan without charging users, Marketplace billing webhook handling (`marketplace_purchase`) is not required for paid checkout flows, and `/api/config` explicitly advertises `"planTier": "free"`.

---

## 4. Technical & Security Compliance Checklist

- [x] **Least-Privilege Permissions:** Only `Metadata: Read-only`, `Contents: Read & write`, and `Pull requests: Read & write`.
- [x] **Webhook Signature Verification:** `POST /api/webhooks` validates `X-Hub-Signature-256` against raw unparsed payload bytes via `@octokit/webhooks`.
- [x] **Duplicate Delivery Protection:** `X-GitHub-Delivery` IDs are deduplicated in memory after signature verification.
- [x] **Non-Destructive Repository Edits:** Refuses (`409 Conflict`) to overwrite existing files on default branches without explicit `replaceExisting: true` opt-in and never pushes commits directly to default branches.
- [x] **Stateless Security:** User-provided GitHub tokens are processed in-memory only for repository write authorization and are never logged or stored.
- [x] **Public Visibility:** GitHub App configured to allow installation on **Any account**.

---

## 5. Listing Copy

- **Product Name:** Open Workers
- **Short Description:** Multi-purpose GitHub automation platform for licensing, community standards, security, documentation, and repository governance.
- **Detailed Description:**
  > Open Workers is a multi-purpose GitHub automation platform designed to help developers maintain, improve, and organize their repositories through one GitHub App. Built on the operational principle Inspect → Recommend → Act, Open Workers provides deterministic open-source licensing guidance, standard community document generation, structured issue and PR templates, repository health auditing, and automated pull requests directly on user repositories without storing repository code.
- **Categories:**
  - Primary: Code quality
  - Secondary: Dependency management / Workflow automation
- **Informational Disclaimer:** Summaries are provided for developer guidance and do not constitute formal legal counsel.
