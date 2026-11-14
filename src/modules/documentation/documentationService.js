/**
 * Open Workers — Documentation Service
 *
 * Implements repository documentation inspection, README structure analysis,
 * safe internal/external link validation, changelog compilation,
 * and automated documentation pull requests.
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { parseReadmeContent } from './engine.js';

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
  let readmeFormat = 'none';

  const rootReadme = rootEntries.find((e) => e.type === 'file' && /^readme(\..+)?$/i.test(e.name));
  if (rootReadme) {
    readmePath = rootReadme.path;
    const ext = rootReadme.name.split('.').pop().toLowerCase();
    if (ext === 'md' || ext === 'markdown') readmeFormat = 'markdown';
    else if (ext === 'rst') readmeFormat = 'restructuredtext';
    else if (ext === 'txt') readmeFormat = 'text';
    else readmeFormat = 'other';
  } else {
    // Check .github/ or docs/
    for (const folder of ['.github', 'docs']) {
      try {
        const subRes = await octokit.rest.repos.getContent({ owner, repo, path: folder, ref: defaultBranch });
        if (Array.isArray(subRes.data)) {
          const subReadme = subRes.data.find((e) => e.type === 'file' && /^readme(\..+)?$/i.test(e.name));
          if (subReadme) {
            readmePath = subReadme.path;
            const ext = subReadme.name.split('.').pop().toLowerCase();
            if (ext === 'md' || ext === 'markdown') readmeFormat = 'markdown';
            else readmeFormat = 'other';
            break;
          }
        }
      } catch {
        // Folder does not exist
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
      : 'No license notice, link, or badge found in README.',
    recommendation: hasLicense
      ? 'License is documented in README.'
      : 'Add a License section or badge referencing your open source license.',
    canGenerateFix: true,
    fixTemplateId: 'readme'
  });

  // Check 6: Docs Directory
  checks.push({
    id: 'docs-directory',
    name: 'Dedicated Docs Directory',
    category: 'structure',
    status: hasDocsDirectory ? 'passed' : 'needs_attention',
    message: hasDocsDirectory
      ? 'Dedicated docs/ directory detected.'
      : 'No docs/ directory found in repository root.',
    recommendation: hasDocsDirectory
      ? 'Dedicated documentation directory is available.'
      : 'Consider adding a docs/ directory for in-depth architecture and design documents as the project grows.',
    canGenerateFix: false
  });

  // Check 7: Changelog
  checks.push({
    id: 'changelog-present',
    name: 'Changelog Presence',
    category: 'history',
    status: changelogPath ? 'passed' : 'missing',
    path: changelogPath,
    message: changelogPath
      ? `Found changelog file at "${changelogPath}".`
      : 'No CHANGELOG file found in repository root.',
    recommendation: changelogPath
      ? 'Changelog is maintained.'
      : 'Add a CHANGELOG.md file to document notable changes across releases.',
    canGenerateFix: !changelogPath,
    fixTemplateId: 'changelog'
  });

  // Calculate completeness score (transparent 0-100%)
  const passedCount = checks.filter((c) => c.status === 'passed').length;
  const missingCount = checks.filter((c) => c.status === 'missing').length;
  const needsAttentionCount = checks.filter((c) => c.status === 'needs_attention').length;
  const notVerifiedCount = checks.filter((c) => c.status === 'not_verified').length;

  const completenessScore = Math.round((passedCount / checks.length) * 100);

  // Recommendations
  const recommendations = [];
  for (const c of checks) {
    if (c.status === 'missing' || c.status === 'needs_attention') {
      recommendations.push({
        id: c.id,
        severity: c.status === 'missing' ? 'high' : 'medium',
        title: c.name,
        message: c.message,
        action: c.recommendation,
        canGenerateFix: Boolean(c.canGenerateFix),
        fixTemplateId: c.fixTemplateId || null
      });
    }
  }

  return {
    repository: {
      fullName: repoRes.data.full_name,
      owner: repoRes.data.owner?.login || owner,
      repo: repoRes.data.name || repo,
      defaultBranch,
      private: Boolean(repoRes.data.private),
      archived: Boolean(repoRes.data.archived),
      installed,
      installationId: installation?.id || null
    },
    appInstalled: installed,
    readme: {
      path: readmePath,
      format: readmeFormat,
      sha: readmeSha,
      lineCount: parsedReadme.lineCount || 0,
      hasBadges: parsedReadme.hasBadges || false,
      sections: parsedReadme.detected,
      headings: parsedReadme.rawHeadings || []
    },
    changelog: {
      path: changelogPath,
      present: Boolean(changelogPath)
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
