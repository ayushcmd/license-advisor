/**
 * Public GitHub Repository License Analyzer
 *
 * Queries public GitHub REST endpoints on demand to audit repository metadata,
 * root license/notice files, and dependency manifests without any database.
 *
 * Compatible with both browser ES6 modules and Node.js 20+.
 */

import { explainLicense, resolveLicense } from './engine.js';

const OWNER_REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

const LICENSE_FILE_NAMES = new Set([
  'license',
  'license.md',
  'license.txt',
  'licence',
  'licence.md',
  'licence.txt',
  'copying',
  'copying.md',
  'copying.txt',
  'unlicense',
  'unlicense.txt'
]);

const NOTICE_FILE_NAMES = new Set([
  'notice',
  'notice.md',
  'notice.txt',
  'patents',
  'third_party_notices',
  'third_party_notices.md',
  'third_party_notices.txt'
]);

const DEPENDENCY_MANIFESTS = Object.freeze({
  'package.json': 'Node.js / npm manifest',
  'package-lock.json': 'npm lockfile',
  'pyproject.toml': 'Python project manifest',
  'requirements.txt': 'Python requirements manifest',
  'cargo.toml': 'Rust Cargo manifest',
  'go.mod': 'Go module manifest',
  'pom.xml': 'Maven project manifest',
  'build.gradle': 'Gradle build manifest',
  gemfile: 'Ruby Bundler manifest',
  'composer.json': 'PHP Composer manifest'
});

/**
 * Parse a GitHub repository specifier (`owner/repo`, HTTPS URL, or SSH URL).
 *
 * @param {string} rawInput
 * @returns {{ owner: string, repo: string, fullName: string }}
 */
export function parseRepoInput(rawInput) {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    throw new Error('Enter a GitHub repository in "owner/repo" format or a https://github.com/owner/repo URL.');
  }

  let cleaned = rawInput.trim();

  // Support git@github.com:owner/repo.git
  const sshMatch = cleaned.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    cleaned = `${sshMatch[1]}/${sshMatch[2]}`;
  } else if (/^https?:\/\//i.test(cleaned)) {
    let url;
    try {
      url = new URL(cleaned);
    } catch {
      throw new Error('Invalid repository URL.');
    }
    if (url.hostname.toLowerCase() !== 'github.com' && url.hostname.toLowerCase() !== 'www.github.com') {
      throw new Error('Only github.com repositories are supported.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error('GitHub URL must include both owner and repository name (e.g., https://github.com/owner/repo).');
    }
    cleaned = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
  }

  const segments = cleaned.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (segments.length !== 2) {
    throw new Error('Repository must be specified as "owner/repo" (for example, "expressjs/express").');
  }

  const [owner, repo] = segments;
  if (!OWNER_REPO_SEGMENT.test(owner) || !OWNER_REPO_SEGMENT.test(repo) || owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    throw new Error('Repository owner or name contains unsupported characters.');
  }

  return { owner, repo, fullName: `${owner}/${repo}` };
}

/**
 * Inspect root repository entries for license files, notice files, README, and manifests.
 *
 * @param {Array<object>} rootEntries
 * @returns {object}
 */
export function inspectRootEntries(rootEntries = []) {
  const entries = Array.isArray(rootEntries) ? rootEntries : [];
  const licenseFiles = [];
  const noticeFiles = [];
  const dependencyManifests = [];
  let hasReadme = false;

  for (const item of entries) {
    if (!item || item.type !== 'file' || typeof item.name !== 'string') continue;
    const lower = item.name.toLowerCase();

    if (LICENSE_FILE_NAMES.has(lower) || lower.startsWith('license-') || lower.startsWith('copying-')) {
      licenseFiles.push({ name: item.name, path: item.path || item.name, htmlUrl: item.html_url || null });
    }
    if (NOTICE_FILE_NAMES.has(lower)) {
      noticeFiles.push({ name: item.name, path: item.path || item.name, htmlUrl: item.html_url || null });
    }
    if (lower.startsWith('readme')) {
      hasReadme = true;
    }
    if (DEPENDENCY_MANIFESTS[lower]) {
      dependencyManifests.push({
        name: item.name,
        description: DEPENDENCY_MANIFESTS[lower]
      });
    }
  }

  return {
    licenseFiles,
    noticeFiles,
    dependencyManifests,
    hasReadme
  };
}

function extractRateLimit(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (limit === null && remaining === null) return null;

  const resetEpoch = reset ? Number(reset) * 1000 : null;
  return {
    limit: limit ? Number(limit) : null,
    remaining: remaining !== null ? Number(remaining) : null,
    resetAt: resetEpoch && Number.isFinite(resetEpoch) ? new Date(resetEpoch).toISOString() : null
  };
}

async function fetchGitHubJson(url, { fetchImpl, headers }) {
  const response = await fetchImpl(url, { headers });
  const rateLimit = extractRateLimit(response.headers);

  if (response.status === 404) {
    return { status: 404, data: null, rateLimit };
  }

  if (response.status === 403 || response.status === 429) {
    const isRateLimited = rateLimit && rateLimit.remaining === 0;
    const resetHint = rateLimit?.resetAt
      ? ` Rate limit resets at ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`
      : '';
    throw new Error(
      isRateLimited
        ? `GitHub API public rate limit reached.${resetHint} Connect the server or try again shortly.`
        : `GitHub API refused request (${response.status}). Ensure the repository is public.`
    );
  }

  if (!response.ok) {
    throw new Error(`GitHub API request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  return { status: response.status, data, rateLimit };
}

/**
 * Construct a normalized, plain-language audit report from GitHub REST responses.
 *
 * @param {object} repoData
 * @param {object|null} licenseData
 * @param {Array<object>} rootEntries
 * @param {object|null} rateLimit
 * @returns {object}
 */
export function buildAuditReport(repoData, licenseData, rootEntries = [], rateLimit = null) {
  const rootObservations = inspectRootEntries(rootEntries);
  const rawSpdx = licenseData?.license?.spdx_id || repoData?.license?.spdx_id || null;
  const hasDetectedFile = Boolean(licenseData?.path || rootObservations.licenseFiles.length > 0);

  let licenseStatus = 'unlicensed';
  if (rawSpdx && rawSpdx !== 'NOASSERTION') {
    licenseStatus = 'licensed';
  } else if (hasDetectedFile) {
    licenseStatus = 'unrecognized';
  }

  const catalogEntry = rawSpdx && rawSpdx !== 'NOASSERTION' ? resolveLicense(rawSpdx) : null;
  const explanation = catalogEntry ? explainLicense(catalogEntry.id) : null;

  const findings = [];
  if (licenseStatus === 'licensed') {
    findings.push({
      severity: 'success',
      title: `Detected ${rawSpdx} license`,
      detail: `GitHub identified "${licenseData?.license?.name || repoData?.license?.name || rawSpdx}" at "${licenseData?.path || 'root license file'}".`
    });
  } else if (licenseStatus === 'unrecognized') {
    const fileLabel = licenseData?.path || rootObservations.licenseFiles[0]?.path || 'LICENSE';
    findings.push({
      severity: 'warning',
      title: 'License file present but not recognized as standard SPDX',
      detail: `Found "${fileLabel}", but GitHub returned NOASSERTION. Custom wording or extra preamble can prevent automated SPDX tools from classifying your license.`
    });
  } else {
    findings.push({
      severity: 'danger',
      title: 'No LICENSE file detected on default branch',
      detail: `Without a LICENSE file on "${repoData.default_branch || 'main'}", default copyright reserves all rights and prevents others from legally copying, modifying, or redistributing the repository.`
    });
  }

  if (repoData.fork) {
    findings.push({
      severity: 'warning',
      title: 'Repository is a fork',
      detail: 'Verify the upstream repository license before adding or modifying licensing terms; forks normally retain upstream license obligations.'
    });
  }

  if (repoData.archived) {
    findings.push({
      severity: 'info',
      title: 'Repository is archived',
      detail: 'Archived repositories are read-only; unarchive before opening a license pull request.'
    });
  }

  if (rootObservations.dependencyManifests.length > 0) {
    const names = rootObservations.dependencyManifests.map((m) => m.name).join(', ');
    findings.push({
      severity: 'info',
      title: 'Dependency manifests found for compatibility review',
      detail: `Detected ${names}. Audit third-party dependency licenses for outbound compatibility (without basing license choice on programming language).`
    });
  }

  if (catalogEntry?.flags?.networkUseTrigger) {
    findings.push({
      severity: 'info',
      title: 'Network-use copyleft active',
      detail: `${catalogEntry.id} requires offering Corresponding Source code to users interacting remotely over a network.`
    });
  }

  return {
    repository: {
      fullName: repoData.full_name,
      owner: repoData.owner?.login || repoData.full_name?.split('/')[0] || '',
      repo: repoData.name,
      description: repoData.description || '',
      htmlUrl: repoData.html_url,
      defaultBranch: repoData.default_branch || 'main',
      private: Boolean(repoData.private),
      archived: Boolean(repoData.archived),
      fork: Boolean(repoData.fork),
      visibility: repoData.visibility || (repoData.private ? 'private' : 'public'),
      stars: typeof repoData.stargazers_count === 'number' ? repoData.stargazers_count : 0,
      topics: Array.isArray(repoData.topics) ? repoData.topics : []
    },
    licenseStatus,
    detectedLicense: {
      spdxId: rawSpdx,
      name: licenseData?.license?.name || repoData?.license?.name || null,
      path: licenseData?.path || rootObservations.licenseFiles[0]?.path || null,
      htmlUrl: licenseData?.html_url || rootObservations.licenseFiles[0]?.htmlUrl || null,
      inCatalog: Boolean(catalogEntry),
      catalogId: catalogEntry?.id || null,
      explanation
    },
    rootObservations,
    findings,
    rateLimit
  };
}

/**
 * Analyze a public GitHub repository on demand via GitHub REST API v3.
 *
 * @param {string} repoInput - `owner/repo` or GitHub repository URL.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Custom fetch function (for testing or backend use).
 * @param {string} [options.apiBaseUrl] - API base URL (defaults to `https://api.github.com`).
 * @param {string} [options.authToken] - Optional bearer token (server-side only).
 * @returns {Promise<object>} Normalized repository audit report.
 */
export async function analyzePublicRepository(repoInput, options = {}) {
  const { owner, repo } = parseRepoInput(repoInput);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is unavailable in this environment.');
  }

  const baseUrl = (options.apiBaseUrl || 'https://api.github.com').replace(/\/+$/, '');
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (options.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }

  const repoRes = await fetchGitHubJson(`${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    fetchImpl,
    headers
  });

  if (repoRes.status === 404 || !repoRes.data) {
    throw new Error(`Repository "${owner}/${repo}" was not found or is private.`);
  }

  const [licenseRes, contentsRes] = await Promise.all([
    fetchGitHubJson(`${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/license`, {
      fetchImpl,
      headers
    }),
    fetchGitHubJson(`${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`, {
      fetchImpl,
      headers
    })
  ]);

  const latestRateLimit = contentsRes.rateLimit || licenseRes.rateLimit || repoRes.rateLimit;
  const rootEntries = Array.isArray(contentsRes.data) ? contentsRes.data : [];

  return buildAuditReport(repoRes.data, licenseRes.data, rootEntries, latestRateLimit);
}

