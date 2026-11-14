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
import { listSecurityChecks, listSecurityTemplates, generateSecurityConfig } from '../modules/security/engine.js';
import {
  auditSecurityRepository,
  previewSecurityPr,
  createSecurityPullRequest
} from '../modules/security/securityService.js';
import {
  listDocumentationChecks,
  listDocumentationTemplates,
  generateReadme,
  improveExistingReadme,
  generateChangelog,
  generateBadge
} from '../modules/documentation/engine.js';
import {
  auditDocumentationRepository,
  checkDocumentationLinks,
  previewDocumentationPr,
  createDocumentationPullRequest
} from '../modules/documentation/documentationService.js';
import {
  listIssueCapabilities,
  analyzeIssue,
  findDuplicateIssues,
  inspectStaleIssues,
  previewIssueLabels,
  applyIssueLabels
} from '../modules/issues/issueService.js';
import {
  analyzePullRequest,
  classifyPullRequest,
  generateReleaseNotes,
  previewPullRequestAction,
  executePullRequestAction
} from '../modules/issues/pullRequestService.js';
import {
  listAutomationChecks,
  listAutomationTemplates,
  generateAutomationFile
} from '../modules/automation/engine.js';
import {
  auditRepositorySetup,
  inspectRepositoryWorkflows,
  previewAutomationPr,
  createAutomationPullRequest
} from '../modules/automation/automationService.js';
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

  // Security module endpoints
  router.get('/security/checks', (_req, res) => {
    res.json({ checks: listSecurityChecks() });
  });

  router.get('/security/templates', (_req, res) => {
    res.json({ templates: listSecurityTemplates() });
  });

  router.post(
    '/security/generate',
    withServiceErrorHandling(async (req, res) => {
      res.json(generateSecurityConfig(req.body));
    })
  );

  router.post(
    '/security/analyze',
    withServiceErrorHandling(async (req, res) => {
      const repoInput = req.body?.repo;
      const report = await auditSecurityRepository({ repoInput, githubContext });
      res.json(report);
    })
  );

  router.post(
    '/security/preview-pr',
    withServiceErrorHandling(async (req, res) => {
      const preview = await previewSecurityPr({
        repoInput: req.body?.repo,
        configs: req.body?.configs,
        replaceExisting: req.body?.replaceExisting,
        githubContext
      });
      res.json(preview);
    })
  );

  router.post(
    '/security/trigger-pr',
    withServiceErrorHandling(async (req, res) => {
      await authorizeRepositoryWrite({
        authorization: req.get('authorization'),
        repoInput: req.body?.repo,
        githubContext,
        createUserClient
      });
      const result = await createSecurityPullRequest({
        repoInput: req.body?.repo,
        configs: req.body?.configs,
        replaceExisting: req.body?.replaceExisting,
        customBranch: req.body?.branch,
        githubContext
      });
      res.status(201).json(result);
    })
  );

  // Documentation module endpoints
  router.get('/documentation/checks', (_req, res) => {
    res.json({ checks: listDocumentationChecks() });
  });

  router.get('/documentation/templates', (_req, res) => {
    res.json({ templates: listDocumentationTemplates() });
  });

  router.post(
    '/documentation/generate',
    withServiceErrorHandling(async (req, res) => {
      const templateId = req.body?.templateId;
      if (templateId === 'readme') {
        if (req.body?.mode === 'improve') {
          const result = improveExistingReadme(req.body?.originalContent, req.body?.sections);
          return res.json(result);
        }
        const content = generateReadme(req.body?.options || {});
        return res.json({ templateId: 'readme', filename: 'README.md', content });
      }

      if (templateId === 'changelog') {
        const content = generateChangelog(req.body?.options || {});
        return res.json({ templateId: 'changelog', filename: 'CHANGELOG.md', content });
      }

      if (templateId === 'badges') {
        if (Array.isArray(req.body?.badges)) {
          const badges = req.body.badges.map(generateBadge).filter(Boolean).join(' ');
          return res.json({ templateId: 'badges', content: badges });
        }
        const badge = generateBadge(req.body?.badge || {});
        return res.json({ templateId: 'badges', content: badge });
      }

      throw new ServiceError(400, `Unknown documentation template "${templateId}". Supported: readme, changelog, badges.`, 'INVALID_INPUT');
    })
  );

  router.post(
    '/documentation/analyze',
    withServiceErrorHandling(async (req, res) => {
      const repoInput = req.body?.repo;
      const report = await auditDocumentationRepository({ repoInput, githubContext });
      res.json(report);
    })
  );

  router.post(
    '/documentation/check-links',
    withServiceErrorHandling(async (req, res) => {
      const repoInput = req.body?.repo;
      const filePath = req.body?.path || 'README.md';
      const result = await checkDocumentationLinks({ repoInput, path: filePath, githubContext });
      res.json(result);
    })
  );

  router.post(
    '/documentation/preview-pr',
    withServiceErrorHandling(async (req, res) => {
      const preview = await previewDocumentationPr({
        repoInput: req.body?.repo,
        changes: req.body?.changes,
        replaceExisting: req.body?.replaceExisting,
        githubContext
      });
      res.json(preview);
    })
  );

  router.post(
    '/documentation/trigger-pr',
    withServiceErrorHandling(async (req, res) => {
      await authorizeRepositoryWrite({
        authorization: req.get('authorization'),
        repoInput: req.body?.repo,
        githubContext,
        createUserClient
      });
      const result = await createDocumentationPullRequest({
        repoInput: req.body?.repo,
        changes: req.body?.changes,
        replaceExisting: req.body?.replaceExisting,
        customBranch: req.body?.branch,
        githubContext
      });
      res.status(201).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // PR & Issue Management Module Endpoints
  // ---------------------------------------------------------------------------

  router.get('/issues/capabilities', (_req, res) => {
    res.json(listIssueCapabilities());
  });

  router.post(
    '/issues/analyze',
    withServiceErrorHandling(async (req, res) => {
      const result = await analyzeIssue({
        repoInput: req.body?.repo,
        issueNumber: req.body?.issueNumber,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/issues/duplicates',
    withServiceErrorHandling(async (req, res) => {
      const result = await findDuplicateIssues({
        repoInput: req.body?.repo,
        issueNumber: req.body?.issueNumber,
        candidateLimit: req.body?.limit,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/issues/stale',
    withServiceErrorHandling(async (req, res) => {
      const result = await inspectStaleIssues({
        repoInput: req.body?.repo,
        daysInactive: req.body?.daysInactive,
        exemptLabels: req.body?.exemptLabels,
        limit: req.body?.limit,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/issues/preview-labels',
    withServiceErrorHandling(async (req, res) => {
      const result = await previewIssueLabels({
        repoInput: req.body?.repo,
        issueNumber: req.body?.issueNumber,
        labelsToAdd: req.body?.labels,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/issues/apply-labels',
    withServiceErrorHandling(async (req, res) => {
      const result = await applyIssueLabels({
        repoInput: req.body?.repo,
        issueNumber: req.body?.issueNumber,
        labelsToAdd: req.body?.labels,
        authorization: req.get('authorization'),
        githubContext,
        createUserClient
      });
      res.status(200).json(result);
    })
  );

  router.post(
    '/pulls/analyze',
    withServiceErrorHandling(async (req, res) => {
      const result = await analyzePullRequest({
        repoInput: req.body?.repo,
        pullNumber: req.body?.pullNumber,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/pulls/size',
    withServiceErrorHandling(async (req, res) => {
      const result = await classifyPullRequest({
        repoInput: req.body?.repo,
        pullNumber: req.body?.pullNumber,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/pulls/release-notes',
    withServiceErrorHandling(async (req, res) => {
      const result = await generateReleaseNotes({
        repoInput: req.body?.repo,
        releaseTitle: req.body?.releaseTitle,
        previousTag: req.body?.previousTag,
        currentTag: req.body?.currentTag,
        limit: req.body?.limit,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/pulls/preview-action',
    withServiceErrorHandling(async (req, res) => {
      const result = await previewPullRequestAction({
        repoInput: req.body?.repo,
        pullNumber: req.body?.pullNumber,
        action: req.body?.action,
        options: req.body?.options,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/pulls/execute-action',
    withServiceErrorHandling(async (req, res) => {
      const result = await executePullRequestAction({
        repoInput: req.body?.repo,
        pullNumber: req.body?.pullNumber,
        action: req.body?.action,
        options: req.body?.options,
        authorization: req.get('authorization'),
        githubContext,
        createUserClient
      });
      res.status(200).json(result);
    })
  );

  // Repository Automation routes
  router.get('/automation/checks', (_req, res) => {
    res.json({ checks: listAutomationChecks() });
  });

  router.get('/automation/templates', (_req, res) => {
    res.json({ templates: listAutomationTemplates() });
  });

  router.post(
    '/automation/generate',
    withServiceErrorHandling(async (req, res) => {
      const { templateId, options, existingContent } = req.body || {};
      if (!templateId) {
        throw new ServiceError(400, 'A "templateId" is required to generate an automation file.', 'INVALID_INPUT');
      }
      const generated = generateAutomationFile({ templateId, options, existingContent });
      res.json(generated);
    })
  );

  router.post(
    '/automation/analyze',
    withServiceErrorHandling(async (req, res) => {
      const result = await auditRepositorySetup({
        repoInput: req.body?.repo,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/automation/inspect-workflows',
    withServiceErrorHandling(async (req, res) => {
      const result = await inspectRepositoryWorkflows({
        repoInput: req.body?.repo,
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/automation/preview-pr',
    withServiceErrorHandling(async (req, res) => {
      const result = await previewAutomationPr({
        repoInput: req.body?.repo,
        files: req.body?.files,
        replaceExisting: Boolean(req.body?.replaceExisting),
        githubContext
      });
      res.json(result);
    })
  );

  router.post(
    '/automation/trigger-pr',
    withServiceErrorHandling(async (req, res) => {
      const auth = await authorizeRepositoryWrite({
        authorization: req.get('authorization'),
        repoInput: req.body?.repo,
        githubContext,
        createUserClient
      });
      const result = await createAutomationPullRequest({
        repoInput: req.body?.repo,
        files: req.body?.files,
        replaceExisting: Boolean(req.body?.replaceExisting),
        customBranch: req.body?.branch,
        customPrTitle: req.body?.prTitle,
        customPrBody: req.body?.prBody,
        githubContext
      });
      res.status(201).json({
        ...result,
        caller: auth.login
      });
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
