/**
 * REST API Routes
 *
 * Exposes health/config metadata, deterministic policy recommendation,
 * repository auditing (`POST /api/analyze`), and GitHub App Pull Request
 * creation (`POST /api/trigger-pr`).
 */

import { Router } from 'express';
import { CAPABILITIES, getCapability } from '../core/capabilities/registry.js';
import { listTemplates, generateDocument } from '../modules/community/engine.js';
import {
  auditCommunityRepository,
  previewCommunityPr,
  createCommunityPullRequest
} from '../modules/community/communityService.js';
import { authorizeRepositoryWrite } from '../core/github/authorize.js';
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
export function createApiRouter({ githubContext, env = process.env, createUserClient }) {
  const router = Router();
  const appUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

  router.get('/capabilities', (_req, res) => res.json({ capabilities: CAPABILITIES }));
  router.get('/capabilities/:id', (req, res) => {
    const capability = getCapability(req.params.id);
    return capability ? res.json(capability) : res.status(404).json({ error: 'Unknown capability.', code: 'UNKNOWN_CAPABILITY' });
  });
  router.get('/community/templates', (req, res) => {
    const category = req.query?.category;
    res.json({ templates: listTemplates(category ? { category } : {}) });
  });
  router.post('/community/generate', withServiceErrorHandling(async (req, res) => res.json(generateDocument(req.body))));
  router.post(
    '/community/analyze',
    withServiceErrorHandling(async (req, res) => {
      const repoInput = req.body?.repo;
      const report = await auditCommunityRepository({ repoInput, githubContext });
      res.json(report);
    })
  );
  router.post(
    '/community/preview-pr',
    withServiceErrorHandling(async (req, res) => {
      const preview = await previewCommunityPr({
        repoInput: req.body?.repo,
        documents: req.body?.documents,
        replaceExisting: req.body?.replaceExisting,
        githubContext
      });
      res.json(preview);
    })
  );
  router.post(
    '/community/trigger-pr',
    withServiceErrorHandling(async (req, res) => {
      await authorizeRepositoryWrite({
        authorization: req.get('authorization'),
        repoInput: req.body?.repo,
        githubContext,
        createUserClient
      });
      const result = await createCommunityPullRequest({
        repoInput: req.body?.repo,
        documents: req.body?.documents,
        replaceExisting: req.body?.replaceExisting,
        customBranch: req.body?.branch,
        githubContext
      });
      res.status(201).json(result);
    })
  );

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'open-workers',
      mode: 'database-free',
      timestamp: new Date().toISOString(),
      githubAppConfigured: Boolean(githubContext?.isAppConfigured),
      webhookConfigured: Boolean(githubContext?.isWebhookConfigured),
      catalogCount: LICENSE_CATALOG.length
    });
  });

  router.get('/config', (_req, res) => {
    res.json({
      appName: 'Open Workers',
      appSlug: githubContext?.appSlug || 'open-license-advisor',
      appUrl,
      installUrl: githubContext?.getInstallationUrl
        ? githubContext.getInstallationUrl()
        : 'https://github.com/apps/open-license-advisor/installations/new',
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
      await authorizeRepositoryWrite({ authorization: req.get('authorization'), repoInput: req.body?.repo, githubContext, createUserClient });
      const result = await createLicensePullRequest({
        repo: req.body?.repo,
        licenseId: req.body?.licenseId,
        year: req.body?.year,
        holder: req.body?.holder,
        replaceExisting: req.body?.replaceExisting,
        readmePlacement: req.body?.readmePlacement,
        githubContext
      });
      res.status(201).json(result);
    })
  );

  return router;
}
