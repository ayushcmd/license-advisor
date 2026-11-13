/**
 * REST API Routes
 *
 * Exposes health/config metadata, deterministic policy recommendation,
 * repository auditing (`POST /api/analyze`), and GitHub App Pull Request
 * creation (`POST /api/trigger-pr`).
 */

import { Router } from 'express';
import { LICENSE_CATALOG, SPDX_DATA_VERSION } from '../../public/js/catalog-data.js';
import {
  ServiceError,
  analyzeRepositoryServer,
  validateRecommendationRequest
} from '../services/licenseService.js';
import { createLicensePullRequest } from '../services/prService.js';

function withServiceErrorHandling(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          ...(err.details ? { details: err.details } : {})
        });
      }
      return next(err);
    }
  };
}

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

  router.post(
    '/recommend',
    withServiceErrorHandling(async (req, res) => {
      const recommendation = validateRecommendationRequest(req.body);
      res.json(recommendation);
    })
  );

  router.post(
    '/analyze',
    withServiceErrorHandling(async (req, res) => {
      const repoInput = req.body?.repo;
      const report = await analyzeRepositoryServer({ repoInput, githubContext });
      res.json(report);
    })
  );

  router.post(
    '/trigger-pr',
    withServiceErrorHandling(async (req, res) => {
      const result = await createLicensePullRequest({
        repo: req.body?.repo,
        licenseId: req.body?.licenseId,
        year: req.body?.year,
        holder: req.body?.holder,
        replaceExisting: req.body?.replaceExisting,
        githubContext
      });
      res.status(201).json(result);
    })
  );

  return router;
}
