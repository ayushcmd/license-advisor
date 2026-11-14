/**
 * Open Workers — Documentation Service
 *
 * Implements repository documentation inspection, README structure analysis,
 * safe internal/external link validation, changelog compilation,
 * and automated documentation pull requests.
 */

import path from 'node:path';
import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { createFeatureBranch } from '../../core/pullRequests/branches.js';
import { commitFiles } from '../../core/pullRequests/files.js';
import { repositoryService } from '../../core/repository/service.js';
import {
  parseReadmeContent,
  extractMarkdownLinks,
  isSafeExternalUrl
} from './engine.js';

function mapGitHubError(err, fallbackMessage) {
  if (err instanceof ServiceError) return err;
  const status = err?.status || 500;
  if (status === 404) return new ServiceError(404, 'Repository or file not found.', 'NOT_FOUND');
  if (status === 403) return new ServiceError(403, 'GitHub API access denied or rate limit exceeded.', 'INSUFFICIENT_PERMISSIONS');
  if (status === 401) return new ServiceError(401, 'GitHub authentication failed or credentials expired.', 'AUTH_REQUIRED');
  return new ServiceError(502, `${fallbackMessage}: ${err?.message || 'Upstream error'}`, 'GITHUB_API_ERROR');
}

/**
 * Resolve an Octokit client (App installation or public) for a repository
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
    } catch (err) {
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
 * Perform a comprehensive documentation audit on a GitHub repository
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function auditDocumentationRepository({ repoInput, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const { octokit, installed, installation } = await resolveClient(owner, repo, githubContext);

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load details for "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  // Read root entries
  let rootEntries = [];
  try {
    const rootRes = await octokit.rest.repos.getContent({ owner, repo, path: '', ref: defaultBranch });
    rootEntries = Array.isArray(rootRes.data) ? rootRes.data : [];
  } catch (err) {
    if (err?.status !== 404) throw mapGitHubError(err, 'Failed to inspect repository root directory.');
  }

  // 1. Detect README file in root or standard subdirectories
  let readmePath = null;
  let readmeFormat = 'markdown';
  const rootReadme = rootEntries.find((e) => e.type === 'file' && /^readme(\.(md|markdown|rst|txt))?$/i.test(e.name));

  if (rootReadme) {
    readmePath = rootReadme.path;
    if (/\.rst$/i.test(rootReadme.name)) readmeFormat = 'rst';
    else if (/\.txt$/i.test(rootReadme.name) || !rootReadme.name.includes('.')) readmeFormat = 'text';
  } else {
    // Check .github/ and docs/ for fallback README
    for (const subDir of ['.github', 'docs']) {
      const hasSubDir = rootEntries.some((e) => e.name === subDir && e.type === 'dir');
      if (hasSubDir) {
        try {
          const subRes = await octokit.rest.repos.getContent({ owner, repo, path: subDir, ref: defaultBranch });
          const entries = Array.isArray(subRes.data) ? subRes.data : [];
          const subReadme = entries.find((e) => e.type === 'file' && /^readme(\.(md|markdown|rst|txt))?$/i.test(e.name));
          if (subReadme) {
            readmePath = subReadme.path;
            if (/\.rst$/i.test(subReadme.name)) readmeFormat = 'rst';
            else if (/\.txt$/i.test(subReadme.name) || !subReadme.name.includes('.')) readmeFormat = 'text';
            break;
          }
        } catch {
          // ignore subdirectory read error
        }
      }
    }
  }

  let readmeContent = '';
  let readmeSha = null;
  let parsedReadme = { detected: {}, rawHeadings: [], hasBadges: false };

  if (readmePath) {
    try {
      const fileRes = await octokit.rest.repos.getContent({ owner, repo, path: readmePath, ref: defaultBranch });
      if (fileRes?.data?.content) {
        readmeContent = Buffer.from(fileRes.data.content, 'base64').toString('utf8');
        readmeSha = fileRes.data.sha;
        if (readmeFormat === 'markdown') {
          parsedReadme = parseReadmeContent(readmeContent);
        }
      }
    } catch {
      // Content could not be read
    }
  }

  // 2. Check docs/ directory
  const hasDocsDirectory = rootEntries.some((e) => e.name === 'docs' && e.type === 'dir');

  // 3. Check CHANGELOG.md presence
  const changelogFile = rootEntries.find((e) => e.type === 'file' && /^changelog(\.(md|markdown|txt))?$/i.test(e.name));
  const changelogPath = changelogFile ? changelogFile.path : null;

  // Build structured checks
  const checks = [];

  // Check 1: README Presence
  checks.push({
    id: 'readme-present',
    name: 'README File Presence',
    category: 'readme',
    status: readmePath ? 'passed' : 'missing',
    path: readmePath,
    format: readmeFormat,
    message: readmePath
      ? `Found ${readmeFormat.toUpperCase()} README at "${readmePath}".`
      : 'No README file found in root, .github/, or docs/.',
    recommendation: readmePath
      ? 'Repository README is present.'
      : 'Create a comprehensive README.md to welcome developers and explain project purpose.',
    canGenerateFix: !readmePath,
    fixTemplateId: 'readme'
  });

  // Check 2: Title and Overview
  const hasTitleDesc = parsedReadme.detected.title && parsedReadme.detected.description;
  checks.push({
    id: 'readme-title-desc',
    name: 'Title & Project Overview',
    category: 'readme',
    status: !readmePath
      ? 'missing'
      : readmeFormat !== 'markdown'
        ? 'not_verified'
        : hasTitleDesc
          ? 'passed'
          : 'needs_attention',
    message: hasTitleDesc
      ? `Project title "${parsedReadme.detected.titleText || ''}" and introduction detected.`
      : 'README lacks a clear top-level title (H1) or project overview.',
    recommendation: hasTitleDesc
      ? 'Project overview is clearly established.'
      : 'Add an H1 heading with the project name and an introductory paragraph explaining what the project does.',
    canGenerateFix: true,
    fixTemplateId: 'readme'
  });

  // Check 3: Installation & Setup
  const hasInstall = parsedReadme.detected.installation || parsedReadme.detected.prerequisites;
  checks.push({
    id: 'readme-installation',
    name: 'Installation & Setup Guide',
    category: 'readme',
    status: !readmePath
      ? 'missing'
      : readmeFormat !== 'markdown'
        ? 'not_verified'
        : hasInstall
          ? 'passed'
          : 'missing',
    message: hasInstall
      ? 'Installation or setup instructions detected.'
      : 'No installation, setup, or getting started instructions detected.',
    recommendation: hasInstall
      ? 'Installation instructions are present.'
      : 'Add an Installation or Getting Started section showing step-by-step setup commands.',
    canGenerateFix: true,
    fixTemplateId: 'readme'
  });

  // Check 4: Usage & Examples
  const hasUsage = parsedReadme.detected.usage;
  checks.push({
    id: 'readme-usage',
    name: 'Usage Instructions & Examples',
    category: 'readme',
    status: !readmePath
      ? 'missing'
      : readmeFormat !== 'markdown'
        ? 'not_verified'
        : hasUsage
          ? 'passed'
          : 'missing',
    message: hasUsage
      ? 'Usage instructions or code examples detected.'
      : 'No usage instructions, code snippets, or CLI examples detected.',
    recommendation: hasUsage
      ? 'Usage instructions are present.'
      : 'Add a Usage section showing common commands, code snippets, or API interactions.',
    canGenerateFix: true,
    fixTemplateId: 'readme'
  });

  // Check 5: License Documentation
  const hasLicense = parsedReadme.detected.license;
  checks.push({
    id: 'readme-license',
    name: 'License Notice in README',
    category: 'readme',
    status: !readmePath
      ? 'missing'
      : readmeFormat !== 'markdown'
        ? 'not_verified'
        : hasLicense
          ? 'passed'
          : 'missing',
    message: hasLicense
      ? 'License section or badge detected in README.'
      : 'No license reference or badge detected in the README.',
    recommendation: hasLicense
      ? 'License is documented in the README.'
      : 'Add a License section or badge referencing the repository license and linking to LICENSE.',
    canGenerateFix: true,
    fixTemplateId: 'readme'
  });

  // Check 6: Docs Directory
  checks.push({
    id: 'docs-directory',
    name: 'Extended Documentation Directory',
    category: 'structure',
    status: hasDocsDirectory ? 'passed' : 'needs_attention',
    message: hasDocsDirectory
      ? 'Found "docs/" directory for extended guides and architecture notes.'
      : 'No "docs/" directory found. For growing projects, a dedicated docs/ folder helps organize in-depth guides.',
    recommendation: hasDocsDirectory
      ? 'Documentation directory is established.'
      : 'Consider adding a docs/ directory for architectural guides, API documentation, and security disclosures.',
    canGenerateFix: false
  });

  // Check 7: Changelog Presence
  checks.push({
    id: 'changelog-present',
    name: 'Changelog Presence (CHANGELOG.md)',
    category: 'history',
    status: changelogPath ? 'passed' : 'missing',
    path: changelogPath,
    message: changelogPath
      ? `Found changelog file at "${changelogPath}".`
      : 'No CHANGELOG.md file found in the repository.',
    recommendation: changelogPath
      ? 'Changelog is actively tracking releases.'
      : 'Generate a CHANGELOG.md file based on Conventional Commits to inform contributors of version updates.',
    canGenerateFix: !changelogPath,
    fixTemplateId: 'changelog'
  });

  // Calculate Documentation Completeness Score
  // Checks evaluated: readme-present, readme-title-desc, readme-installation, readme-usage, readme-license, changelog-present
  const coreChecks = checks.filter((c) => c.status === 'passed' || c.status === 'missing' || c.status === 'needs_attention');
  const passedCount = checks.filter((c) => c.status === 'passed').length;
  const missingCount = checks.filter((c) => c.status === 'missing').length;
  const needsAttentionCount = checks.filter((c) => c.status === 'needs_attention').length;
  const notVerifiedCount = checks.filter((c) => c.status === 'not_verified').length;

  const completenessScore = coreChecks.length > 0
    ? Math.round((passedCount / coreChecks.length) * 100)
    : 0;

  // Extract recommendations
  const recommendations = checks
    .filter((c) => c.status === 'missing' || c.status === 'needs_attention')
    .map((c) => ({
      checkId: c.id,
      name: c.name,
      message: c.recommendation,
      canGenerateFix: Boolean(c.canGenerateFix),
      fixTemplateId: c.fixTemplateId || null
    }));

  return {
    repository: {
      fullName: repoRes.data.full_name,
      owner: repoRes.data.owner?.login || owner,
      repo: repoRes.data.name || repo,
      description: repoRes.data.description || '',
      htmlUrl: repoRes.data.html_url,
      defaultBranch,
      private: Boolean(repoRes.data.private),
      archived: Boolean(repoRes.data.archived),
      installed,
      installationId: installation?.id || null
    },
    readme: {
      path: readmePath,
      sha: readmeSha,
      format: readmeFormat,
      exists: Boolean(readmePath),
      sections: parsedReadme.detected,
      headings: parsedReadme.rawHeadings,
      hasBadges: parsedReadme.hasBadges
    },
    changelog: {
      path: changelogPath,
      exists: Boolean(changelogPath)
    },
    hasDocsDirectory,
    summary: {
      completenessScore,
      passed: passedCount,
      missing: missingCount,
      needsAttention: needsAttentionCount,
      notVerified: notVerifiedCount,
      totalChecks: checks.length,
      assessmentNotice: 'This score assesses documentation completeness across standard developer sections (overview, installation, usage, license, and changelog). Optional extended sections and unverified non-Markdown formats are not penalized as critical failures.'
    },
    checks,
    recommendations
  };
}

/**
 * Safely inspect links in a Markdown file within a repository
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {string} [params.path='README.md']
 * @param {object} params.githubContext
 * @param {Function} [params.fetchImpl=fetch]
 * @returns {Promise<object>}
 */
export async function checkDocumentationLinks({ repoInput, path: filePath = 'README.md', githubContext, fetchImpl = fetch }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  const { octokit } = await resolveClient(owner, repo, githubContext);

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load details for "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  let contentRes;
  try {
    contentRes = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
  } catch (err) {
    throw mapGitHubError(err, `Could not find file "${filePath}" on branch "${defaultBranch}".`);
  }

  if (!contentRes?.data?.content) {
    throw new ServiceError(400, `File "${filePath}" has no readable content.`, 'EMPTY_FILE');
  }

  const rawContent = Buffer.from(contentRes.data.content, 'base64').toString('utf8');
  const extracted = extractMarkdownLinks(rawContent);

  const fileDir = path.posix.dirname(filePath);
  const results = [];

  let workingCount = 0;
  let brokenCount = 0;
  let redirectedCount = 0;
  let notVerifiedCount = 0;
  let internalCount = 0;
  let externalCount = 0;

  for (const item of extracted) {
    if (item.type === 'anchor' || item.type === 'mailto') {
      results.push({
        ...item,
        status: 'working',
        message: item.type === 'anchor' ? 'Local section anchor' : 'Email contact link'
      });
      workingCount++;
      continue;
    }

    if (item.type === 'internal') {
      internalCount++;
      // Clean path, remove query or hash
      const cleanUrl = item.url.split('#')[0].split('?')[0];
      const targetRelPath = path.posix.normalize(path.posix.join(fileDir, cleanUrl));

      if (targetRelPath.startsWith('..')) {
        results.push({
          ...item,
          status: 'broken',
          message: `Relative path escapes repository root: "${item.url}"`
        });
        brokenCount++;
        continue;
      }

      // Check existence via GitHub API
      let exists = false;
      try {
        const checkRes = await octokit.rest.repos.getContent({ owner, repo, path: targetRelPath, ref: defaultBranch });
        if (checkRes?.data) exists = true;
      } catch {
        exists = false;
      }

      if (exists) {
        results.push({
          ...item,
          resolvedPath: targetRelPath,
          status: 'working',
          message: `Local file verified at "${targetRelPath}"`
        });
        workingCount++;
      } else {
        results.push({
          ...item,
          resolvedPath: targetRelPath,
          status: 'broken',
          message: `File not found at resolved repository path "${targetRelPath}"`
        });
        brokenCount++;
      }
      continue;
    }

    if (item.type === 'external') {
      externalCount++;
      const safety = isSafeExternalUrl(item.url);
      if (!safety.safe) {
        results.push({
          ...item,
          status: 'not_verified',
          message: `External link inspection skipped: ${safety.reason}`
        });
        notVerifiedCount++;
        continue;
      }

      // Perform bounded external HTTP check with 4s timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const resp = await fetchImpl(item.url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: { 'User-Agent': 'OpenWorkers-LinkChecker/1.0 (+https://open-workers.onrender.com)' }
        });
        clearTimeout(timeoutId);

        if (resp.status >= 200 && resp.status < 300) {
          results.push({ ...item, status: 'working', message: `HTTP ${resp.status} OK` });
          workingCount++;
        } else if (resp.status >= 300 && resp.status < 400) {
          results.push({ ...item, status: 'redirected', message: `Redirected (HTTP ${resp.status})` });
          redirectedCount++;
        } else if (resp.status === 404 || resp.status === 410) {
          results.push({ ...item, status: 'broken', message: `HTTP ${resp.status} Not Found` });
          brokenCount++;
        } else {
          // 403, 429, etc. Often bot protections or rate limits - do not mark broken
          results.push({
            ...item,
            status: 'not_verified',
            message: `External server returned HTTP ${resp.status} (may be bot-protected or rate-limited)`
          });
          notVerifiedCount++;
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          results.push({ ...item, status: 'not_verified', message: 'Request timed out after 4 seconds' });
          notVerifiedCount++;
        } else {
          results.push({ ...item, status: 'not_verified', message: `Could not verify external host: ${err.message}` });
          notVerifiedCount++;
        }
      }
    }
  }

  return {
    filePath,
    totalLinks: extracted.length,
    summary: {
      working: workingCount,
      broken: brokenCount,
      redirected: redirectedCount,
      notVerified: notVerifiedCount,
      internal: internalCount,
      external: externalCount
    },
    links: results
  };
}

/**
 * Preview proposed documentation changes and detect conflicts against the default branch
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {Array<object>} params.changes e.g. [{ path: 'README.md', content: '...' }]
 * @param {boolean} [params.replaceExisting=false]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function previewDocumentationPr({ repoInput, changes, replaceExisting = false, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ServiceError(400, 'Select at least one documentation file or change to preview.', 'INVALID_INPUT');
  }

  const { octokit, installed, installation } = await resolveClient(owner, repo, githubContext);

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load details for "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  const fileStatuses = [];
  const conflicts = [];
  const targetPaths = new Set();

  for (const change of changes) {
    if (!change || typeof change !== 'object' || !change.path) {
      throw new ServiceError(400, 'Each change entry must include a valid file path.', 'INVALID_INPUT');
    }
    const filePath = String(change.path).trim().replace(/^\/+/, '');
    if (targetPaths.has(filePath)) {
      throw new ServiceError(400, `Duplicate file path "${filePath}" in documentation changes.`, 'INVALID_INPUT');
    }
    targetPaths.add(filePath);

    let exists = false;
    let existingSha = null;

    try {
      const existingRes = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
      if (existingRes?.data?.type === 'file' && existingRes.data.sha) {
        exists = true;
        existingSha = existingRes.data.sha;
      }
    } catch (err) {
      if (err?.status !== 404) {
        throw mapGitHubError(err, `Failed to check existing file "${filePath}".`);
      }
    }

    if (exists && !replaceExisting) {
      conflicts.push(filePath);
    }

    fileStatuses.push({
      path: filePath,
      action: exists ? 'update' : 'add',
      exists,
      sha: existingSha,
      content: change.content || ''
    });
  }

  return {
    repository: {
      fullName: repoRes.data.full_name,
      owner: repoRes.data.owner?.login || owner,
      repo: repoRes.data.name || repo,
      defaultBranch,
      private: Boolean(repoRes.data.private),
      archived: Boolean(repoRes.data.archived),
      installed
    },
    appInstalled: installed,
    replaceExisting: Boolean(replaceExisting),
    hasConflicts: conflicts.length > 0,
    conflicts,
    canProceed: conflicts.length === 0,
    files: fileStatuses
  };
}

/**
 * Open a consolidated documentation pull request via the GitHub App
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {Array<object>} params.changes
 * @param {boolean} [params.replaceExisting=false]
 * @param {string} [params.customBranch]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function createDocumentationPullRequest({
  repoInput,
  changes,
  replaceExisting = false,
  customBranch,
  githubContext
}) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  if (typeof replaceExisting !== 'boolean') {
    throw new ServiceError(400, 'replaceExisting must be a boolean.', 'INVALID_INPUT');
  }

  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ServiceError(400, 'Select at least one documentation file or change to include in the pull request.', 'INVALID_INPUT');
  }

  if (!githubContext?.isAppConfigured || typeof githubContext.resolveRepoInstallation !== 'function') {
    throw new ServiceError(
      503,
      'GitHub App credentials are not configured on the server. Set GITHUB_APP_ID and private key credentials in .env.',
      'APP_NOT_CONFIGURED'
    );
  }

  let resolution;
  try {
    resolution = await githubContext.resolveRepoInstallation(owner, repo);
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      throw new ServiceError(403, 'GitHub App lacks permission to verify repository installation.', 'INSUFFICIENT_PERMISSIONS');
    }
    throw new ServiceError(502, `Unable to check GitHub App installation: ${err.message}`, 'GITHUB_API_ERROR');
  }

  if (!resolution?.installed || !resolution.octokit) {
    throw new ServiceError(
      404,
      `GitHub App is not installed on "${fullName}". Install the GitHub App on this repository first.`,
      'APP_NOT_INSTALLED'
    );
  }

  const perms = resolution.installation?.permissions || {};
  if (
    (perms.contents && perms.contents !== 'write') ||
    (perms.pull_requests && perms.pull_requests !== 'write')
  ) {
    throw new ServiceError(
      403,
      'GitHub App installation requires Contents (Read & write) and Pull Requests (Read & write) permissions.',
      'INSUFFICIENT_PERMISSIONS'
    );
  }

  const octokit = resolution.octokit;

  let repoData;
  try {
    repoData = await repositoryService(octokit, { owner, repo }).metadata();
  } catch (err) {
    if (err?.status === 403) throw new ServiceError(403, `GitHub App lacks permission to read metadata for "${fullName}".`, 'INSUFFICIENT_PERMISSIONS');
    if (err?.status === 404) throw new ServiceError(404, `Repository "${fullName}" was not found.`, 'NOT_FOUND');
    throw new ServiceError(502, `Failed to load repository details: ${err.message}`, 'GITHUB_API_ERROR');
  }

  if (repoData.archived) {
    throw new ServiceError(409, `Repository "${fullName}" is archived and read-only.`, 'REPO_ARCHIVED');
  }

  const defaultBranch = repoData.default_branch || 'main';

  let baseSha;
  try {
    baseSha = await repositoryService(octokit, { owner, repo }).base(defaultBranch);
  } catch (err) {
    if (err?.status === 404 || err?.status === 409) {
      throw new ServiceError(
        409,
        `Default branch "${defaultBranch}" has no commits yet. Create an initial commit before opening a documentation PR.`,
        'EMPTY_REPOSITORY'
      );
    }
    throw new ServiceError(502, `Failed to resolve default branch SHA: ${err.message}`, 'GITHUB_API_ERROR');
  }

  const filesToCommit = [];
  const targetPaths = new Set();

  for (const change of changes) {
    const filePath = String(change.path).trim().replace(/^\/+/, '');
    if (targetPaths.has(filePath)) {
      throw new ServiceError(400, `Duplicate target file path "${filePath}".`, 'INVALID_INPUT');
    }
    targetPaths.add(filePath);

    let existingSha = null;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: baseSha });
      if (data?.type === 'file' && data.sha) {
        existingSha = data.sha;
      }
    } catch (err) {
      if (err?.status !== 404) {
        throw mapGitHubError(err, `Failed to inspect default branch for "${filePath}".`);
      }
    }

    if (existingSha && !replaceExisting) {
      throw new ServiceError(
        409,
        `File "${filePath}" already exists on "${defaultBranch}". Enable replaceExisting to update it.`,
        'FILE_ALREADY_EXISTS',
        { existingFile: filePath }
      );
    }

    const actionVerb = existingSha ? 'update' : 'add';
    filesToCommit.push({
      path: filePath,
      content: change.content,
      sha: replaceExisting && existingSha ? existingSha : undefined,
      message: `docs: ${actionVerb} ${filePath}`
    });
  }

  // Create isolated feature branch
  const baseBranchName = customBranch && typeof customBranch === 'string' && /^[a-zA-Z0-9_\-\.\/]+$/.test(customBranch.trim())
    ? customBranch.trim()
    : 'chore/improve-docs';

  const branch = await createFeatureBranch(octokit, {
    owner,
    repo,
    defaultBranch,
    baseSha,
    baseBranchName
  });

  // Commit files sequentially
  try {
    await commitFiles(octokit, {
      owner,
      repo,
      branch,
      defaultBranch,
      files: filesToCommit
    });
  } catch (err) {
    throw new ServiceError(502, `Failed to commit documentation files: ${err.message}`, 'COMMIT_FAILED');
  }

  // Open Pull Request
  const fileNames = filesToCommit.map((f) => f.path);
  const prTitle = fileNames.length === 1
    ? `docs: improve ${fileNames[0]}`
    : `docs: update ${fileNames.slice(0, 2).join(' and ')}${fileNames.length > 2 ? ' and more' : ''}`;

  const prBody = [
    '## Summary',
    '',
    `This pull request updates project documentation using **[Open Workers](https://open-workers.onrender.com)**.`,
    '',
    '### Changed Files',
    '',
    ...filesToCommit.map((f) => `- \`${f.path}\``),
    '',
    '---',
    '*Automated with [Open Workers](https://open-workers.onrender.com) &bull; Least-privilege GitHub automation*'
  ].join('\n');

  let prRes;
  try {
    prRes = await octokit.rest.pulls.create({
      owner,
      repo,
      title: prTitle,
      head: branch,
      base: defaultBranch,
      body: prBody
    });
  } catch (err) {
    if (err?.status === 422) {
      throw new ServiceError(409, `A pull request for branch "${branch}" already exists.`, 'PR_ALREADY_EXISTS');
    }
    throw mapGitHubError(err, 'Failed to create pull request.');
  }

  return {
    success: true,
    repository: fullName,
    branch,
    pullRequest: {
      number: prRes.data.number,
      htmlUrl: prRes.data.html_url,
      title: prRes.data.title,
      state: prRes.data.state
    },
    files: fileNames
  };
}
