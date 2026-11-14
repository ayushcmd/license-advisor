/**
 * Open Workers — Dashboard Coordinator
 *
 * Orchestrates cross-module repository inspections across the six core capabilities
 * with bounded concurrency, error isolation, rate limit resilience, and privacy enforcement.
 */

import { Octokit } from '@octokit/rest';
import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { authorizeRepositoryRead } from '../github/authorize.js';
import { mapGitHubError } from '../github/errors.js';
import { AnalysisContext } from '../github/context.js';
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

export { mapGitHubError };

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

  // Initialize request-scoped analysis context for bounded metadata and tree reuse
  const context = new AnalysisContext({
    owner,
    repo,
    fullName,
    githubContext,
    authorization,
    createUserClient
  });

  const { installed, installationId } = await context.resolveClient();

  // 1. Initial repository metadata inspection via request context
  const repoData = await context.getRepoData();
  const isPrivate = Boolean(repoData.private);

  // 2. Privacy Guard: Private repositories require authenticated user authorization
  if (isPrivate) {
    await context.authorizeRead();
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
    analyzeRepositoryServer({ repoInput: fullName, githubContext, authorization, createUserClient, context }),

    // 2. Community Module
    auditCommunityRepository({ repoInput: fullName, githubContext, authorization, createUserClient, context }),

    // 3. Security Module
    auditSecurityRepository({ repoInput: fullName, githubContext, authorization, createUserClient, context }),

    // 4. Documentation Module
    auditDocumentationRepository({ repoInput: fullName, githubContext, authorization, createUserClient, context }),

    // 5. PR & Issue Management Module (Repository-level collaboration check)
    (async () => {
      const issuesEnabled = repoData.has_issues !== false;
      const openCount = repoData.open_issues_count || 0;
      if (!issuesEnabled) {
        return {
          issuesEnabled: false,
          openCount: 0,
          staleCount: 0,
          scannedIssues: 0,
          daysInactive: 30,
          staleIssues: [],
          inspected: false,
          reason: 'Issues are disabled for this repository.'
        };
      }
      if (openCount === 0) {
        return {
          issuesEnabled: true,
          openCount: 0,
          staleCount: 0,
          scannedIssues: 0,
          daysInactive: 30,
          staleIssues: [],
          inspected: true
        };
      }
      const staleRes = await inspectStaleIssues({
        repoInput: fullName,
        daysInactive: 30,
        limit: 30,
        githubContext,
        authorization,
        createUserClient,
        context
      });
      return {
        issuesEnabled: true,
        openCount,
        staleCount: staleRes.staleCount ?? (Array.isArray(staleRes.staleIssues) ? staleRes.staleIssues.length : 0),
        scannedIssues: staleRes.scannedIssues ?? 0,
        daysInactive: staleRes.daysInactive ?? 30,
        staleIssues: staleRes.staleIssues || [],
        inspected: true
      };
    })(),

    // 6. Repository Automation Module
    auditRepositorySetup({ repoInput: fullName, githubContext, authorization, createUserClient, context })
  ]);

  // 4. Normalize findings per module with error resilience
  const licensingNorm = licensingSettled.status === 'fulfilled'
    ? normalizeLicensingFindings(licensingSettled.value, fullName)
    : {
        module: 'licensing',
        executionStatus: 'failed',
        healthStatus: 'unknown',
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
        executionStatus: 'failed',
        healthStatus: 'unknown',
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
        executionStatus: 'failed',
        healthStatus: 'unknown',
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
        executionStatus: 'failed',
        healthStatus: 'unknown',
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
        executionStatus: 'failed',
        healthStatus: 'unknown',
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
        executionStatus: 'failed',
        healthStatus: 'unknown',
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
