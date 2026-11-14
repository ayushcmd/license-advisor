/**
 * GitHub App Authentication & Octokit Configuration
 *
 * Loads GitHub App credentials from environment variables or a local PEM file
 * without storing secrets in code or requiring a database. Degrades gracefully
 * when credentials are absent so local UI development and tests run cleanly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

const PEM_HEADER_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

/**
 * Resolve and validate a GitHub App PEM private key from inline env or file path.
 *
 * @param {object} params
 * @param {string} [params.privateKey]
 * @param {string} [params.privateKeyPath]
 * @param {string} [params.cwd]
 * @returns {{ key: string|null, source: string|null, warning: string|null }}
 */
export function loadPrivateKey({ privateKey, privateKeyPath, cwd = process.cwd() } = {}) {
  if (typeof privateKey === 'string' && privateKey.trim()) {
    const normalized = privateKey.replace(/\\n/g, '\n').trim();
    if (!PEM_HEADER_PATTERN.test(normalized)) {
      return {
        key: null,
        source: 'env',
        warning: 'GITHUB_PRIVATE_KEY does not appear to be a valid PEM private key.'
      };
    }
    return { key: normalized, source: 'env', warning: null };
  }

  if (typeof privateKeyPath === 'string' && privateKeyPath.trim()) {
    const resolvedPath = path.resolve(cwd, privateKeyPath.trim());
    if (!fs.existsSync(resolvedPath)) {
      return {
        key: null,
        source: 'file',
        warning: `GITHUB_PRIVATE_KEY_PATH file not found at "${resolvedPath}".`
      };
    }
    try {
      const content = fs.readFileSync(resolvedPath, 'utf8').trim();
      if (!PEM_HEADER_PATTERN.test(content)) {
        return {
          key: null,
          source: 'file',
          warning: `Private key file at "${resolvedPath}" is not a valid PEM private key.`
        };
      }
      return { key: content, source: 'file', warning: null };
    } catch (err) {
      return {
        key: null,
        source: 'file',
        warning: `Unable to read GITHUB_PRIVATE_KEY_PATH: ${err.message}`
      };
    }
  }

  return {
    key: null,
    source: null,
    warning: 'No GitHub App private key configured (GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH).'
  };
}

/**
 * Create a GitHub App runtime context from environment configuration.
 *
 * @param {object} [env]
 * @param {object} [options]
 * @returns {object}
 */
export function createGitHubContext(env = process.env, options = {}) {
  const logger = options.logger || console;
  const appId = env.GITHUB_APP_ID ? String(env.GITHUB_APP_ID).trim() : '';
  const appSlug = env.GITHUB_APP_SLUG ? String(env.GITHUB_APP_SLUG).trim() : 'open-license-advisor';
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET ? String(env.GITHUB_WEBHOOK_SECRET).trim() : '';
  const publicToken = env.GITHUB_PUBLIC_TOKEN ? String(env.GITHUB_PUBLIC_TOKEN).trim() : '';

  const keyResult = loadPrivateKey({
    privateKey: env.GITHUB_PRIVATE_KEY,
    privateKeyPath: env.GITHUB_PRIVATE_KEY_PATH,
    cwd: options.cwd || process.cwd()
  });

  const warnings = [];
  if (!appId) warnings.push('GITHUB_APP_ID is not configured.');
  if (keyResult.warning) warnings.push(keyResult.warning);
  if (!webhookSecret) warnings.push('GITHUB_WEBHOOK_SECRET is not configured.');

  let app = null;
  if (appId && keyResult.key) {
    try {
      app = new App({
        appId,
        privateKey: keyResult.key,
        Octokit
      });
    } catch (err) {
      warnings.push(`Failed to initialize @octokit/app: ${err.message}`);
      app = null;
    }
  }

  if (warnings.length > 0 && !options.silent) {
    logger.warn(`[github-config] Running with partial GitHub App configuration: ${warnings.join(' ')}`);
  }

  return {
    appId: appId || null,
    appSlug,
    webhookSecret: webhookSecret || null,
    keySource: keyResult.source,
    isAppConfigured: Boolean(app),
    isWebhookConfigured: Boolean(webhookSecret),
    warnings,
    app,

    getInstallationUrl() {
      return `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`;
    },

    async getInstallationOctokit(installationId) {
      if (!app) {
        throw new Error('GitHub App is not configured. Set GITHUB_APP_ID and private key credentials in .env.');
      }
      const numericId = Number(installationId);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new Error('A valid positive numeric GitHub App installationId is required.');
      }
      return app.getInstallationOctokit(numericId);
    },

    async resolveRepoInstallation(owner, repo) {
      if (!app) {
        return { installed: false, installation: null, octokit: null };
      }
      try {
        const { data: installation } = await app.octokit.rest.apps.getRepoInstallation({ owner, repo });
        const octokit = await this.getInstallationOctokit(installation.id);
        return { installed: true, installation, octokit };
      } catch (err) {
        if (err?.status === 404) {
          return { installed: false, installation: null, octokit: null };
        }
        throw err;
      }
    },

    createPublicOctokit() {
      return new Octokit(publicToken ? { auth: publicToken } : {});
    }
  };
}

