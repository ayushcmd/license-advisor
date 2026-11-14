/**
 * Open Workers — Pull Request Service
 *
 * Provides pull request quality inspection, size classification, release notes preparation,
 * and authorized pull request actions (size labeling, welcome comments).
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { authorizeRepositoryWrite } from '../../core/github/authorize.js';
import { hasMarker, MARKERS } from '../../core/events/idempotency.js';
import {
  evaluatePullRequestQuality,
  classifyPullRequestSize,
  formatWelcomeMessage,
  generateReleaseNotesFromPulls,
  PR_SIZE_THRESHOLDS
} from './engine.js';

function mapGitHubError(err, fallbackMessage) {
  if (err instanceof ServiceError) return err;
  const status = err?.status || 500;
  if (status === 404) return new ServiceError(404, 'Repository or pull request not found.', 'NOT_FOUND');
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
 * Perform a quality and standard checklist inspection on a pull request
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number|string} params.pullNumber
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function analyzePullRequest({ repoInput, pullNumber, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const num = parseInt(pullNumber, 10);
  if (isNaN(num) || num <= 0) {
    throw new ServiceError(400, 'A valid positive numeric pull request number is required.', 'INVALID_INPUT');
  }

  const { octokit, installed } = await resolveClient(owner, repo, githubContext);

  let prRes;
  try {
    prRes = await octokit.rest.pulls.get({ owner, repo, pull_number: num });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load pull request #${num} for "${fullName}".`);
  }

  const prData = prRes.data;

  // Optional: list changed files to detect lockfiles
  let fileNames = [];
  try {
    const filesRes = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: num, per_page: 50 });
    fileNames = (filesRes.data || []).map((f) => f.filename);
  } catch {
    // If files list fails, proceed without filenames
  }

  const quality = evaluatePullRequestQuality(prData);
  const size = classifyPullRequestSize({
    additions: prData.additions,
    deletions: prData.deletions,
    changedFiles: prData.changed_files,
    fileNames
  });

  return {
    repository: {
      fullName,
      owner,
      repo,
      installed
    },
    pullRequest: {
      number: prData.number,
      title: prData.title,
      body: prData.body || '',
      state: prData.state,
      draft: Boolean(prData.draft),
      htmlUrl: prData.html_url,
      author: prData.user?.login || 'unknown',
      authorAssociation: prData.author_association || 'NONE',
      isBotAuthor: prData.user?.type === 'Bot' || prData.user?.login?.endsWith('[bot]'),
      createdAt: prData.created_at,
      updatedAt: prData.updated_at,
      labels: (prData.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
      baseRef: prData.base?.ref,
      headRef: prData.head?.ref
    },
    quality,
    size
  };
}

/**
 * Classify PR size and return suggested size label
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {number|string} params.pullNumber
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function classifyPullRequest({ repoInput, pullNumber, githubContext }) {
  const analysis = await analyzePullRequest({ repoInput, pullNumber, githubContext });
  return {
    repository: analysis.repository.fullName,
    pullNumber: analysis.pullRequest.number,
    size: analysis.size,
    currentLabels: analysis.pullRequest.labels,
    existingSizeLabels: analysis.pullRequest.labels.filter((l) => l.startsWith('size/'))
  };
}

/**
 * Generate release notes draft from merged pull requests
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {string} [params.releaseTitle='Release Notes']
 * @param {string} [params.previousTag]
 * @param {string} [params.currentTag]
 * @param {number} [params.limit=50]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */