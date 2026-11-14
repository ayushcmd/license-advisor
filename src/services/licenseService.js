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
import { authorizeRepositoryRead } from '../core/github/authorize.js';
import { mapGitHubError, extractOctokitRateLimit } from '../core/github/errors.js';

export { mapGitHubError, extractOctokitRateLimit };

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
export async function analyzeRepositoryServer({ repoInput, githubContext, authorization, createUserClient, enforceAuthorization = false, context = null }) {
  let parsedRepo;
  try {
    parsedRepo = parseRepoInput(repoInput);
  } catch (err) {
    throw new ServiceError(400, err.message, 'INVALID_REPO');
  }

  const { owner, repo, fullName } = parsedRepo;
  const isContextValid = Boolean(context && context.fullName === fullName);

  let octokit = null;
  let installed = false;
  let installationId = null;
  let repoData = null;
  let contentsRes = null;

  if (isContextValid) {
    const clientRes = await context.resolveClient();
    octokit = clientRes.octokit;
    installed = clientRes.installed;
    installationId = clientRes.installationId;
    repoData = await context.getRepoData();

    if (repoData?.private && (enforceAuthorization || authorization !== undefined)) {
      await context.authorizeRead();
    }

    contentsRes = await context.getContent('').catch((err) => {
      if (err?.status === 404) return { data: [], headers: err?.response?.headers };
      throw mapGitHubError(err, 'Failed to inspect repository root directory.');
    });
  } else {
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
      repoData = repoRes.data;
    } catch (err) {
      throw mapGitHubError(err, `Failed to inspect "${owner}/${repo}".`);
    }

    if (repoData?.private && (enforceAuthorization || authorization !== undefined)) {
      await authorizeRepositoryRead({
        authorization,
        repoInput: `${owner}/${repo}`,
        githubContext,
        createUserClient
      });
    }

    contentsRes = await octokit.rest.repos.getContent({ owner, repo, path: '' }).catch((err) => {
      if (err?.status === 404) return { data: [], headers: err?.response?.headers };
      throw mapGitHubError(err, 'Failed to inspect repository root directory.');
    });
  }

  const licenseRes = octokit.rest?.licenses?.getForRepo
    ? await octokit.rest.licenses.getForRepo({ owner, repo }).catch((err) => {
        if (err?.status === 404) return null;
        throw mapGitHubError(err, 'Failed to read repository license metadata.');
      })
    : null;

  const rateLimit = extractOctokitRateLimit(
    contentsRes?.headers || licenseRes?.headers
  );
  const rootEntries = Array.isArray(contentsRes?.data) ? contentsRes.data : [];

  const report = buildAuditReport(repoData, licenseRes?.data || null, rootEntries, rateLimit);
  return {
    ...report,
    analysisSource: installed ? 'github-app-installation' : 'public-api',
    appInstalled: installed,
    installationId
  };
}

