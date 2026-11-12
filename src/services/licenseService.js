/**
 * Backend License Validation, Recommendation & Repository Analysis Service
 *
 * Reuses the shared ES6 modules from `public/js/` (`catalog-data.js`,
 * `engine.js`, `generator.js`, `analyzer.js`) as a single source of truth.
 */

import { getLicenseById } from '../../public/js/catalog-data.js';
import { explainLicense, recommendLicenses, resolveLicense } from '../../public/js/engine.js';
import { generateLicensePackage } from '../../public/js/generator.js';
import { buildAuditReport, parseRepoInput } from '../../public/js/analyzer.js';

/**
 * Structured service error carrying an explicit HTTP status code and machine code.
 */
export class ServiceError extends Error {
  constructor(statusCode, message, code = 'SERVICE_ERROR', details = null) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function extractOctokitRateLimit(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (limit === undefined && remaining === undefined) return null;

  const resetEpoch = reset ? Number(reset) * 1000 : null;
  return {
    limit: limit !== undefined ? Number(limit) : null,
    remaining: remaining !== undefined ? Number(remaining) : null,
    resetAt: resetEpoch && Number.isFinite(resetEpoch) ? new Date(resetEpoch).toISOString() : null
  };
}

function mapGitHubError(err, contextMessage) {
  const status = err?.status || err?.response?.status;
  if (status === 404) {
    return new ServiceError(404, `${contextMessage} Repository was not found or is private without App access.`, 'NOT_FOUND');
  }
  if (status === 401 || status === 403) {
    const rateLimit = extractOctokitRateLimit(err?.response?.headers);
    if (rateLimit && rateLimit.remaining === 0) {
      return new ServiceError(429, 'GitHub API rate limit exceeded. Configure GitHub App credentials or retry after reset.', 'RATE_LIMITED');
    }
    return new ServiceError(403, `${contextMessage} Insufficient GitHub permissions.`, 'FORBIDDEN');
  }
  if (status === 429) {
    return new ServiceError(429, 'GitHub API rate limit exceeded. Try again shortly.', 'RATE_LIMITED');
  }
  return new ServiceError(502, `${contextMessage} ${err?.message || 'Unexpected GitHub API failure.'}`, 'GITHUB_API_ERROR');
}

/**
 * Validate recommendation payload and run the deterministic policy engine.
 *
 * @param {object} body
 * @returns {object}
 */
export function validateRecommendationRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServiceError(400, 'Request body must be a JSON object.', 'INVALID_INPUT');
  }
  if (body.dependencyLicenses !== undefined && !Array.isArray(body.dependencyLicenses)) {
    throw new ServiceError(400, 'dependencyLicenses must be an array of SPDX license identifiers.', 'INVALID_INPUT');
  }
  return recommendLicenses(body);
}

/**
 * Validate and prepare inputs required for generating a LICENSE pull request.
 *
 * @param {object} body
 * @returns {object}
 */
export function validatePrRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServiceError(400, 'Request body must be a JSON object.', 'INVALID_INPUT');
  }

  let parsedRepo;
  try {
    parsedRepo = parseRepoInput(body.repo);
  } catch (err) {
    throw new ServiceError(400, err.message, 'INVALID_REPO');
  }

  const resolved = resolveLicense(body.licenseId);
  if (!resolved) {
    throw new ServiceError(
      400,
      `Unknown or unsupported SPDX license "${body.licenseId || ''}".`,
      'INVALID_LICENSE'
    );
  }

  let licensePackage;
  try {
    licensePackage = generateLicensePackage(resolved.id, {
      year: body.year,
      holder: body.holder,
      strict: true
    });
  } catch (err) {
    throw new ServiceError(400, err.message, 'INVALID_TEMPLATE_OPTIONS');
  }

  const explanation = explainLicense(resolved.id);
  const catalogEntry = getLicenseById(resolved.id);

  return {
    owner: parsedRepo.owner,
    repo: parsedRepo.repo,
    fullName: parsedRepo.fullName,
    licenseId: resolved.id,
    catalogEntry,
    explanation,
    licensePackage
  };
}

/**
 * Inspect a public repository or GitHub App-installed private repository on demand.
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function analyzeRepositoryServer({ repoInput, githubContext }) {
  let parsedRepo;
  try {
    parsedRepo = parseRepoInput(repoInput);
  } catch (err) {
    throw new ServiceError(400, err.message, 'INVALID_REPO');
  }

  const { owner, repo } = parsedRepo;
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
    } catch (err) {
      throw mapGitHubError(err, 'Unable to verify GitHub App installation.');
    }
  }

  if (!octokit) {
    octokit = githubContext.createPublicOctokit();
  }

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to inspect "${owner}/${repo}".`);
  }

  const [licenseRes, contentsRes] = await Promise.all([
    octokit.rest.licenses.getForRepo({ owner, repo }).catch((err) => {
      if (err?.status === 404) return null;
      throw mapGitHubError(err, 'Failed to read repository license metadata.');
    }),
    octokit.rest.repos.getContent({ owner, repo, path: '' }).catch((err) => {
      if (err?.status === 404) return { data: [], headers: err?.response?.headers };
      throw mapGitHubError(err, 'Failed to inspect repository root directory.');
    })
  ]);

  const rateLimit = extractOctokitRateLimit(
    contentsRes?.headers || licenseRes?.headers || repoRes?.headers
  );
  const rootEntries = Array.isArray(contentsRes?.data) ? contentsRes.data : [];

  const report = buildAuditReport(repoRes.data, licenseRes?.data || null, rootEntries, rateLimit);
  return {
    ...report,
    analysisSource: installed ? 'github-app-installation' : 'public-api',
    appInstalled: installed,
    installationId
  };
}

