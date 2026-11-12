/**
 * Public REST API Routes
 *
 * Exposes health diagnostics and public, non-secret GitHub App configuration
 * metadata for the static frontend and health checks.
 */

import { Router } from 'express';
import { LICENSE_CATALOG, SPDX_DATA_VERSION } from '../../public/js/catalog-data.js';

/**
 * Create the `/api` router.
 *
 * @param {object} deps
 * @param {object} deps.githubContext
 * @param {object} [deps.env]
 * @returns {Router}
 */
export function createApiRouter({ githubContext, env = process.env }) {
  const router = Router();
  const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'github-license-advisor',
      mode: 'database-free',
      timestamp: new Date().toISOString(),
      githubAppConfigured: Boolean(githubContext?.isAppConfigured),
      webhookConfigured: Boolean(githubContext?.isWebhookConfigured),
      catalogCount: LICENSE_CATALOG.length
    });
  });

  router.get('/config', (_req, res) => {
    res.json({
      appName: 'GitHub License Advisor',
      appSlug: githubContext?.appSlug || 'github-license-advisor',
      appUrl,
      installUrl: githubContext?.getInstallationUrl
        ? githubContext.getInstallationUrl()
        : 'https://github.com/apps/github-license-advisor/installations/new',
      githubAppConfigured: Boolean(githubContext?.isAppConfigured),
      webhookConfigured: Boolean(githubContext?.isWebhookConfigured),
      planTier: 'free',
      supportedPermissions: {
        metadata: 'read',
        contents: 'write',
        pull_requests: 'write'
      },
      spdxCatalogVersion: SPDX_DATA_VERSION,
      licenseCount: LICENSE_CATALOG.length
    });
  });

  return router;
}

