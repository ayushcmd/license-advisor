/**
 * Open Workers — Dashboard Coordinator
 *
 * Orchestrates cross-module repository inspections across the six core capabilities
 * with bounded concurrency, error isolation, rate limit resilience, and privacy enforcement.
 */

import { Octokit } from '@octokit/rest';
import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { analyzeRepositoryServer } from '../../services/licenseService.js';
import { auditCommunityRepository } from '../../modules/community/communityService.js';
import { auditSecurityRepository } from '../../modules/security/securityService.js';
import { auditDocumentationRepository } from '../../modules/documentation/documentationService.js';
import { inspectStaleIssues } from '../../modules/issues/issueService.js';
import { auditRepositorySetup } from '../../modules/automation/automationService.js';
import {
  normalizeLicensingFindings,
  normalizeCommunityFindings,
  normalizeSecurityFindings,
  normalizeDocumentationFindings,
  normalizeIssuesFindings,
  normalizeAutomationFindings,
  aggregateDashboardFindings
} from './findings.js';

function mapGitHubError(err, fallbackMessage) {
  if (err instanceof ServiceError) return err;
  const status = err?.status || 500;
  if (status === 404) return new ServiceError(404, 'Repository not found or access denied.', 'NOT_FOUND');
  if (status === 403) {
    const msg = err?.message || '';
    if (msg.includes('rate limit')) {
      return new ServiceError(403, 'GitHub API rate limit exceeded.', 'RATE_LIMITED');
    }
    return new ServiceError(403, 'GitHub API access denied or insufficient permissions.', 'INSUFFICIENT_PERMISSIONS');
  }
  if (status === 401) return new ServiceError(401, 'GitHub authentication failed or credentials expired.', 'AUTH_REQUIRED');
  return new ServiceError(502, `${fallbackMessage}: ${err?.message || 'Upstream error'}`, 'GITHUB_API_ERROR');
}

/**
 * Perform unified cross-module analysis of a repository
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {string} [params.authorization]
 * @param {object} params.githubContext
 * @param {Function} [params.createUserClient]
 * @returns {Promise<object>}
 */
export async function analyzeRepositoryDashboard({
  repoInput,
  authorization,
  githubContext,
  createUserClient = (token) => new Octokit({ auth: token, log: { debug() {}, info() {}, warn() {}, error() {} } })
}) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (err) {
    throw new ServiceError(400, err.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  let octokit = null;
  let installed = false;
  let installationId = null;

  if (githubContext?.isAppConfigured && typeof githubContext.resolveRepoInstallation === 'function') {
    try {
      const resolution = await githubContext.resolveRepoInstallation(owner, repo);
      if (resolution?.installed && resolution.octokit) {
        octokit = resolution.octokit;
        installed = true;
        installationId = resolution.installation?.id || null;
      }
    } catch {
      // Continue to public client
    }
  }

  if (!octokit) {
    if (typeof githubContext?.createPublicOctokit === 'function') {
      octokit = githubContext.createPublicOctokit();
    } else if (typeof githubContext?.getPublicOctokit === 'function') {
      octokit = githubContext.getPublicOctokit();
    }
  }

  if (!octokit) {
    throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
  }

  // 1. Initial repository metadata inspection
  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to inspect repository "${fullName}".`);
  }

  const repoData = repoRes.data;
  const isPrivate = Boolean(repoData.private);

  // 2. Privacy Guard: Private repositories require authenticated user authorization
  if (isPrivate) {
    const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+([A-Za-z0-9_.-]+)$/i);
    if (!match) {
      throw new ServiceError(401, 'Private repository analysis requires GitHub user authorization.', 'AUTH_REQUIRED');
    }

    try {
      const userOctokit = createUserClient(match[1]);
      const userCheck = await userOctokit.rest.repos.get({ owner, repo });
      if (!userCheck?.data) {
        throw new ServiceError(403, 'Access to private repository was denied.', 'FORBIDDEN');
      }
    } catch (authErr) {
      if (authErr instanceof ServiceError) throw authErr;
      throw new ServiceError(403, 'Access to private repository was denied.', 'FORBIDDEN');
    }
  }

  // 3. Run all six capability audits with isolated error boundaries using Promise.allSettled
  const [
    licensingSettled,
    communitySettled,
    securitySettled,
    docSettled,
    issuesSettled,
    automationSettled
  ] = await Promise.allSettled([
    // 1. Licensing Module
    analyzeRepositoryServer({ repoInput: fullName, githubContext }),

    // 2. Community Module
    auditCommunityRepository({ repoInput: fullName, githubContext }),

    // 3. Security Module
    auditSecurityRepository({ repoInput: fullName, githubContext }),

    // 4. Documentation Module
    auditDocumentationRepository({ repoInput: fullName, githubContext }),

    // 5. PR & Issue Management Module (Repository-level collaboration check)
    (async () => {
      let staleIssues = [];
      if (repoData.has_issues && repoData.open_issues_count > 0) {
        const staleRes = await inspectStaleIssues({
          repoInput: fullName,
          daysInactive: 30,
          limit: 10,
          githubContext
        });
        staleIssues = staleRes.staleIssues || [];
      }
      return { staleIssues };
    })(),

    // 6. Repository Automation Module
    auditRepositorySetup({ repoInput: fullName, githubContext })
  ]);

  // 4. Normalize findings per module with error resilience
  const licensingNorm = licensingSettled.status === 'fulfilled'
    ? normalizeLicensingFindings(licensingSettled.value, fullName)
    : {
        module: 'licensing',
        status: 'failed',
        summary: licensingSettled.reason?.message || 'Licensing analysis failed.',
        score: null,
        findings: [],
        recommendations: []
      };

  const communityNorm = communitySettled.status === 'fulfilled'
    ? normalizeCommunityFindings(communitySettled.value, fullName)
    : {
        module: 'community',
        status: 'failed',
        summary: communitySettled.reason?.message || 'Community standards audit failed.',
        score: null,
        findings: [],
        recommendations: []
      };

  const securityNorm = securitySettled.status === 'fulfilled'
    ? normalizeSecurityFindings(securitySettled.value, fullName)
    : {
        module: 'security',
        status: 'failed',
        summary: securitySettled.reason?.message || 'Security configuration audit failed.',
        score: null,
        findings: [],
        recommendations: []
      };

  const documentationNorm = docSettled.status === 'fulfilled'
    ? normalizeDocumentationFindings(docSettled.value, fullName)
    : {
        module: 'documentation',
        status: 'failed',
        summary: docSettled.reason?.message || 'Documentation analysis failed.',
        score: null,
        findings: [],
        recommendations: []
      };

  const issuesNorm = issuesSettled.status === 'fulfilled'
    ? normalizeIssuesFindings(issuesSettled.value, repoData, fullName)
    : {
        module: 'issues',
        status: 'failed',
        summary: issuesSettled.reason?.message || 'PR & Issue inspection failed.',
        score: null,
        findings: [],
        recommendations: []
      };

  const automationNorm = automationSettled.status === 'fulfilled'
    ? normalizeAutomationFindings(automationSettled.value, fullName)
    : {
        module: 'automation',
        status: 'failed',
        summary: automationSettled.reason?.message || 'Repository automation audit failed.',
        score: null,
        findings: [],
        recommendations: []
      };

  // 5. Aggregate overall health metrics and prioritize recommendations
  const modulesMap = {
    licensing: licensingNorm,
    community: communityNorm,
    security: securityNorm,
    documentation: documentationNorm,
    issues: issuesNorm,
    automation: automationNorm
  };

  const aggregate = aggregateDashboardFindings(modulesMap);

  return {
    repository: {
      owner,
      repo,
      fullName,
      defaultBranch: repoData.default_branch || 'main',
      description: repoData.description || '',
      primaryLanguage: repoData.language || 'Unknown',
      isArchived: Boolean(repoData.archived),
      isPrivate,
      htmlUrl: repoData.html_url,
      updatedAt: repoData.updated_at || null,
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssues: repoData.open_issues_count || 0,
      installed,
      installationId
    },
    summary: aggregate.summary,
    modules: modulesMap,
    prioritizedRecommendations: aggregate.prioritizedRecommendations
  };
}
