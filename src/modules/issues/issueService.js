/**
 * Open Workers — Issue Service
 *
 * Provides repository issue inspection, rule-based categorization, duplicate detection,
 * stale issue inspection, and authorized label management.
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { authorizeRepositoryWrite, authorizeRepositoryRead } from '../../core/github/authorize.js';
import {
  categorizeIssue,
  findDuplicateCandidates,
  evaluateStaleIssue,
  ISSUE_CATEGORIES,
  DEFAULT_EXEMPT_STALE_LABELS
} from './engine.js';

function mapGitHubError(err, fallbackMessage) {
  if (err instanceof ServiceError) return err;
  const status = err?.status || 500;
  if (status === 404) return new ServiceError(404, 'Repository or issue not found.', 'NOT_FOUND');
  if (status === 403) {
    const msg = err.message || '';
    if (msg.includes('Resource not accessible by integration') || msg.includes('Issues')) {
      return new ServiceError(403, 'GitHub App lacks "issues: write" permission. Grant "Issues: Read & write" permission in your GitHub App settings.', 'INSUFFICIENT_PERMISSIONS');
    }
    return new ServiceError(403, 'GitHub API access denied or rate limit exceeded.', 'INSUFFICIENT_PERMISSIONS');
  }
  if (status === 401) return new ServiceError(401, 'GitHub authentication failed or credentials expired.', 'AUTH_REQUIRED');
  return new ServiceError(502, `${fallbackMessage}: ${err?.message || 'Upstream error'}`, 'GITHUB_API_ERROR');
}

/**
 * Resolve an Octokit client for a repository
 */
async function resolveClient(owner, repo, githubContext) {
  let octokit = null;
  let installed = false;
  let installation = null;

  if (githubContext?.isAppConfigured && typeof githubContext.resolveRepoInstallation === 'function') {
    try {
      const resolution = await githubContext.resolveRepoInstallation(owner, repo);
      if (resolution?.installed && resolution.octokit) {
        octokit = resolution.octokit;
        installed = true;
        installation = resolution.installation || null;
      }
    } catch {
      // Fall through to public client
    }
  }

  if (!octokit) {
    octokit = githubContext?.createPublicOctokit ? githubContext.createPublicOctokit() : null;
  }

  if (!octokit) {
    throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
  }

  return { octokit, installed, installation };
}

/**
 * Return supported issue management capabilities and categories
 */
export function listIssueCapabilities() {
  return {
    categories: ISSUE_CATEGORIES,
    features: [
      { id: 'categorize', name: 'Rule-Based Issue Categorization', description: 'Deterministic classification of issues based on title, description, and keywords.' },
      { id: 'labeling', name: 'Automatic & Preview Labeling', description: 'Preview and apply category and maintenance labels without overwriting existing labels.' },
      { id: 'duplicates', name: 'Duplicate Issue Suggestions', description: 'Finds candidate issues sharing vocabulary and intent without speculative auto-closure.' },
      { id: 'stale', name: 'Stale Issue Inspection', description: 'Identifies inactive issues while protecting security disclosures and pinned discussions.' }
    ],
    permissionsRequired: {
      read: 'Requires "issues: read" (or public repository read)',
      write: 'Requires "issues: write" to apply labels or create comments'
    }
  };
}

/**
 * Inspect and categorize a specific repository issue
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number|string} params.issueNumber
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function analyzeIssue({ repoInput, issueNumber, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const num = parseInt(issueNumber, 10);
  if (isNaN(num) || num <= 0) {
    throw new ServiceError(400, 'A valid positive numeric issue number is required.', 'INVALID_INPUT');
  }

  const { octokit, installed } = await resolveClient(owner, repo, githubContext);

  let issueRes;
  try {
    issueRes = await octokit.rest.issues.get({ owner, repo, issue_number: num });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load issue #${num} for "${fullName}".`);
  }

  const issueData = issueRes.data;
  const isPullRequest = Boolean(issueData.pull_request);

  const categorization = categorizeIssue({
    title: issueData.title,
    body: issueData.body || '',
    labels: issueData.labels || [],
    number: issueData.number
  });

  return {
    repository: {
      fullName,
      owner,
      repo,
      installed
    },
    issue: {
      number: issueData.number,
      title: issueData.title,
      body: issueData.body || '',
      state: issueData.state,
      htmlUrl: issueData.html_url,
      author: issueData.user?.login || 'unknown',
      isBotAuthor: issueData.user?.type === 'Bot' || issueData.user?.login?.endsWith('[bot]'),
      createdAt: issueData.created_at,
      updatedAt: issueData.updated_at,
      labels: (issueData.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
      isPullRequest
    },
    categorization,
    notice: isPullRequest
      ? 'Note: This item is a Pull Request. Use the Pull Request Checks tab for PR quality and size analysis.'
      : null
  };
}

/**
 * Find candidate duplicate or related issues for a given issue
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number|string} params.issueNumber
 * @param {number} [params.candidateLimit=30]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function findDuplicateIssues({ repoInput, issueNumber, candidateLimit = 30, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const num = parseInt(issueNumber, 10);
  if (isNaN(num) || num <= 0) {
    throw new ServiceError(400, 'A valid positive numeric issue number is required.', 'INVALID_INPUT');
  }

  const { octokit } = await resolveClient(owner, repo, githubContext);

  let targetIssue;
  try {
    const res = await octokit.rest.issues.get({ owner, repo, issue_number: num });
    targetIssue = res.data;
  } catch (err) {
    throw mapGitHubError(err, `Failed to load issue #${num} for "${fullName}".`);
  }

  // Fetch recent open issues bounded to candidateLimit
  const limit = Math.min(Math.max(1, parseInt(candidateLimit, 10) || 30), 50);
  let candidatesRes;
  try {
    candidatesRes = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: limit
    });
  } catch (err) {
    throw mapGitHubError(err, `Failed to list open issues for "${fullName}".`);
  }

  const candidateList = Array.isArray(candidatesRes.data) ? candidatesRes.data : [];
  const suggestions = findDuplicateCandidates(targetIssue, candidateList, { limit: 5 });

  return {
    repository: fullName,
    targetIssue: {
      number: targetIssue.number,
      title: targetIssue.title
    },
    scannedCount: candidateList.filter((c) => !c.pull_request && c.number !== num).length,
    suggestions,
    notice: 'Suggestions are based on title and keyword text similarity. Never treat similarity as proof of duplicate.'
  };
}

/**
 * Inspect inactive or stale issues
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number} [params.daysInactive=30]
 * @param {Array<string>} [params.exemptLabels]
 * @param {number} [params.limit=30]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function inspectStaleIssues({ repoInput, daysInactive = 30, exemptLabels, limit = 30, githubContext, authorization, createUserClient, context = null }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;
  const isContextValid = Boolean(context && context.fullName === fullName);

  const days = Math.max(1, parseInt(daysInactive, 10) || 30);
  const scanLimit = Math.min(Math.max(1, parseInt(limit, 10) || 30), 50);
  const exempt = Array.isArray(exemptLabels) && exemptLabels.length > 0 ? exemptLabels : DEFAULT_EXEMPT_STALE_LABELS;

  let octokit = null;
  if (isContextValid) {
    const clientRes = await context.resolveClient();
    octokit = clientRes.octokit;
    const repoData = await context.getRepoData();
    if (repoData?.private) {
      await context.authorizeRead();
    }
  } else {
    const clientRes = await resolveClient(owner, repo, githubContext);
    octokit = clientRes.octokit;

    if (!octokit) {
      throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
    }

    const repoRes = await octokit.rest.repos.get({ owner, repo }).catch(() => null);
    if (repoRes?.data?.private) {
      await authorizeRepositoryRead({
        authorization,
        repoInput: fullName,
        githubContext,
        createUserClient
      });
    }
  }

  if (!octokit) {
    throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
  }

  let issuesRes;
  try {
    issuesRes = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      sort: 'updated',
      direction: 'asc',
      per_page: scanLimit
    });
  } catch (err) {
    throw mapGitHubError(err, `Failed to list issues for "${fullName}".`);
  }

  const rawIssues = (Array.isArray(issuesRes.data) ? issuesRes.data : []).filter((i) => !i.pull_request);
  const evaluated = rawIssues.map((issue) => evaluateStaleIssue(issue, { daysInactive: days, exemptLabels: exempt }));
  const staleIssues = evaluated.filter((e) => e.isStale);

  return {
    repository: fullName,
    daysInactive: days,
    scannedIssues: rawIssues.length,
    staleCount: staleIssues.length,
    exemptLabels: exempt,
    staleIssues,
    notice: 'Open Workers operates statelessly; stale issues are inspected on demand. Automatic issue closure is not enabled by default.'
  };
}

/**
 * Preview label modifications for an issue without mutating
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number|string} params.issueNumber
 * @param {Array<string>} params.labelsToAdd
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function previewIssueLabels({ repoInput, issueNumber, labelsToAdd = [], githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const num = parseInt(issueNumber, 10);
  if (isNaN(num) || num <= 0) {
    throw new ServiceError(400, 'A valid positive numeric issue number is required.', 'INVALID_INPUT');
  }

  const cleanLabels = Array.from(new Set((Array.isArray(labelsToAdd) ? labelsToAdd : []).map((l) => String(l).trim()).filter(Boolean)));
  if (cleanLabels.length === 0) {
    throw new ServiceError(400, 'Select at least one label to preview.', 'INVALID_INPUT');
  }

  const { octokit, installed } = await resolveClient(owner, repo, githubContext);

  let issueRes;
  try {
    issueRes = await octokit.rest.issues.get({ owner, repo, issue_number: num });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load issue #${num} for "${fullName}".`);
  }

  const currentLabels = (issueRes.data.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const labelsAlreadyPresent = cleanLabels.filter((l) => currentLabels.includes(l));
  const labelsToApply = cleanLabels.filter((l) => !currentLabels.includes(l));

  // Check which labels exist in the repo
  let existingRepoLabels = [];
  try {
    const repoLabelsRes = await octokit.rest.issues.listLabelsForRepo({ owner, repo, per_page: 100 });
    existingRepoLabels = (repoLabelsRes.data || []).map((l) => l.name);
  } catch {
    // If cannot list repo labels, assume they exist
  }

  const missingFromRepo = labelsToApply.filter((l) => existingRepoLabels.length > 0 && !existingRepoLabels.includes(l));

  return {
    repository: fullName,
    issueNumber: num,
    currentLabels,
    labelsRequested: cleanLabels,
    labelsAlreadyPresent,
    labelsToApply,
    missingFromRepo,
    appInstalled: installed,
    canProceed: labelsToApply.length > 0
  };
}

/**
 * Apply labels to an issue with caller write authorization
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number|string} params.issueNumber
 * @param {Array<string>} params.labelsToAdd
 * @param {string} params.authorization
 * @param {object} params.githubContext
 * @param {Function} [params.createUserClient]
 * @returns {Promise<object>}
 */
export async function applyIssueLabels({
  repoInput,
  issueNumber,
  labelsToAdd = [],
  authorization,
  githubContext,
  createUserClient
}) {
  const auth = await authorizeRepositoryWrite({
    authorization,
    repoInput,
    githubContext,
    createUserClient
  });

  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const num = parseInt(issueNumber, 10);
  if (isNaN(num) || num <= 0) {
    throw new ServiceError(400, 'A valid positive numeric issue number is required.', 'INVALID_INPUT');
  }

  const cleanLabels = Array.from(new Set((Array.isArray(labelsToAdd) ? labelsToAdd : []).map((l) => String(l).trim()).filter(Boolean)));
  if (cleanLabels.length === 0) {
    throw new ServiceError(400, 'Select at least one label to apply.', 'INVALID_INPUT');
  }

  const { octokit, installed } = await resolveClient(owner, repo, githubContext);
  if (!installed) {
    throw new ServiceError(403, `GitHub App is not installed on repository "${fullName}".`, 'APP_NOT_INSTALLED');
  }

  try {
    const res = await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: num,
      labels: cleanLabels
    });

    const updatedLabels = (res.data || []).map((l) => (typeof l === 'string' ? l : l.name));
    return {
      success: true,
      repository: fullName,
      issueNumber: num,
      appliedBy: auth.login,
      appliedLabels: cleanLabels,
      currentLabels: updatedLabels
    };
  } catch (err) {
    throw mapGitHubError(err, `Failed to apply labels to issue #${num}.`);
  }
}
