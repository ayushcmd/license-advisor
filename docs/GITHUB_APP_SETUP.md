# GitHub App Registration & Setup Guide

Follow these steps to register and connect **Open Workers** as a least-privilege GitHub App.

---

## 1. Create the GitHub App

1. Open GitHub **Settings** &rarr; **Developer settings** &rarr; **GitHub Apps** &rarr; **New GitHub App** (or under your Organization's Developer settings).
2. Configure **Basic Information**:
   - **GitHub App name:** `Open Workers` (must be globally unique on GitHub; record the resulting slug as `GITHUB_APP_SLUG`, currently registered as `open-license-advisor`)
   - **Description:** Multi-purpose GitHub automation suite for licensing, community standards, security, documentation, and repository governance.
   - **Homepage URL:** `https://open-workers.onrender.com`
   - **Setup URL:** `https://open-workers.onrender.com/app-install.html`
   - **Redirect on update:** Enabled (recommended so users return to the setup page after adding repositories)
   - **User authorization callback URL:** Not required unless you later add OAuth user flows.
3. Configure **Webhook**:
   - **Active:** Checked
   - **Webhook URL:** `https://open-workers.onrender.com/api/webhooks` (or your `smee.io` URL for local dev)
   - **Webhook secret:** Generate a cryptographically random secret:
     ```bash
     node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
     ```
     Save this exact value in `GITHUB_WEBHOOK_SECRET`.

---

## 2. Configure Least-Privilege Permissions

Under **Permissions & events** &rarr; **Repository permissions**, grant **only** these permissions:

| Permission | Access Level | Justification |
| :--- | :--- | :--- |
| **Metadata** | Read-only | Required by GitHub Apps to read repository visibility and default branch name |
| **Contents** | Read and write | Inspect repository trees for existing files, create feature branches, and commit verified files |
| **Pull requests** | Read and write | Open explanatory Pull Requests and detect open duplicate PRs |

Leave all Account permissions and Organization permissions set to **No access**.

---

## 3. Subscribe to Webhook Events

Under **Subscribe to events**, enable:
- `Repository`
- `Installation` / `Installation repositories` (delivered to GitHub Apps for installation lifecycle events)

---

## 4. Installation Visibility

- Choose **Any account** if publishing the App on GitHub Marketplace.
- Choose **Only on this account** while developing privately.

Click **Create GitHub App**, then note the **App ID** shown at the top of the General page (`GITHUB_APP_ID`).

---

## 5. Generate & Configure the Private Key (`.pem`)

1. On the App's **General** page, scroll to **Private keys** and click **Generate a private key**.
2. GitHub downloads a `.pem` file. **Never commit this file to Git** (`.gitignore` blocks `*.pem`).
3. Configure **either** option in `.env`:

### Option A: File Path (Local Development)
Move the `.pem` file into the project root (or a secure local directory) and set:
```dotenv
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=open-license-advisor
GITHUB_WEBHOOK_SECRET=your_generated_hex_secret
GITHUB_PRIVATE_KEY_PATH=./open-workers.private-key.pem
```

### Option B: Inline Key String (Production / Render)
Encode the private key with escaped newlines (`\n`) for environment variables:
```dotenv
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=open-license-advisor
GITHUB_WEBHOOK_SECRET=your_generated_hex_secret
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----"
```
