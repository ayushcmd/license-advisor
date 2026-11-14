/**
 * Open Workers — Automation Service
 *
 * Implements repository setup audits, GitHub Actions workflow inspections,
 * PR previews, and authorized automation pull requests.
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { createFeatureBranch } from '../../core/pullRequests/branches.js';
import { commitFiles } from '../../core/pullRequests/files.js';
import {
  AUTOMATION_CHECKS,
  AUTOMATION_TEMPLATES,
  inspectWorkflowContent,
  evaluateRepositorySetup,
  generateAutomationFile
} from './engine.js';

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

export function listAutomationChecks() {
  return AUTOMATION_CHECKS;
}

export function listAutomationTemplates() {
  return AUTOMATION_TEMPLATES;
}

/**
 * Non-destructive repository setup audit
 */
export async function auditRepositorySetup({ repoInput, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
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
    } catch (err) {
      throw mapGitHubError(err, 'Unable to verify GitHub App installation.');
    }
  }

  if (!octokit) {
    octokit = githubContext?.createPublicOctokit ? githubContext.createPublicOctokit() : null;
  }

  if (!octokit) {
    throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
  }

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to inspect "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  // Read root directory entries
  let rootEntries = [];
  try {
    const rootRes = await octokit.rest.repos.getContent({ owner, repo, path: '', ref: defaultBranch });
    rootEntries = Array.isArray(rootRes.data) ? rootRes.data : [];
  } catch (err) {
    if (err?.status !== 404) throw mapGitHubError(err, 'Failed to inspect repository root directory.');
  }

  // Read .github directory entries if present
  const hasDotGithub = rootEntries.some((e) => e.name === '.github' && e.type === 'dir');
  let dotGithubEntries = [];
  if (hasDotGithub) {
    try {
      const ghRes = await octokit.rest.repos.getContent({ owner, repo, path: '.github', ref: defaultBranch });
      dotGithubEntries = Array.isArray(ghRes.data) ? ghRes.data : [];
    } catch {
      dotGithubEntries = [];
    }
  }

  // Read .github/workflows directory entries if present
  let workflowEntries = [];
  const hasWorkflows = dotGithubEntries.some((e) => e.name === 'workflows' && e.type === 'dir');
  if (hasWorkflows) {
    try {
      const wfRes = await octokit.rest.repos.getContent({ owner, repo, path: '.github/workflows', ref: defaultBranch });
      workflowEntries = Array.isArray(wfRes.data) ? wfRes.data : [];
    } catch {
      workflowEntries = [];
    }
  }

  // Inspect up to 10 workflow files
  const workflowHealthReports = [];
  const candidateWorkflows = workflowEntries
    .filter((e) => e.type === 'file' && /\.(ya?ml)$/i.test(e.name))
    .slice(0, 10);

  for (const wf of candidateWorkflows) {
    try {
      const fileRes = await octokit.rest.repos.getContent({ owner, repo, path: wf.path, ref: defaultBranch });
      if (fileRes.data?.content) {
        const raw = Buffer.from(fileRes.data.content, 'base64').toString('utf8');
        workflowHealthReports.push(inspectWorkflowContent({ path: wf.path, content: raw }));
      }
    } catch {
      // Continue inspecting other workflows if one fails to load
    }
  }

  const setupEvaluation = evaluateRepositorySetup({
    repoMetadata: repoRes.data,
    rootFiles: rootEntries,
    dotGithubFiles: dotGithubEntries,
    workflowFiles: candidateWorkflows,
    workflowHealthReports
  });

  // Cross-module maintenance recommendations
  const recommendations = [];
  const rootNames = new Set(rootEntries.map((e) => e.name.toLowerCase()));
  const dotGhNames = new Set(dotGithubEntries.map((e) => e.name.toLowerCase()));

  // Security cross-module checks
  const hasDependabot = dotGhNames.has('dependabot.yml') || dotGhNames.has('dependabot.yaml');
  if (!hasDependabot) {
    recommendations.push({
      category: 'security',
      title: 'Automated Dependency Updates',
      description: 'Dependabot is not configured. Automated security vulnerability updates are inactive.',
      actionUrl: '/security.html',
      actionLabel: 'Generate Dependabot config'
    });
  }

  const hasCodeQL = workflowEntries.some((w) => w.name.toLowerCase().includes('codeql'));
  if (!hasCodeQL) {
    recommendations.push({
      category: 'security',
      title: 'Static Code Analysis (CodeQL)',
      description: 'No CodeQL workflow found to scan code for vulnerabilities.',
      actionUrl: '/security.html',
      actionLabel: 'Generate CodeQL workflow'
    });
  }

  // Community cross-module checks
  const hasSecurityPolicy = rootNames.has('security.md') || dotGhNames.has('security.md');
  if (!hasSecurityPolicy) {
    recommendations.push({
      category: 'community',
      title: 'Security Policy (SECURITY.md)',
      description: 'No private vulnerability disclosure instructions found.',
      actionUrl: '/community.html?template=security',
      actionLabel: 'Generate in Community'
    });
  }

  // Documentation cross-module checks
  const hasReadme = rootNames.has('readme.md');
  if (!hasReadme) {
    recommendations.push({
      category: 'documentation',
      title: 'Repository README',
      description: 'README is missing from root. Project purpose and instructions are undocumented.',
      actionUrl: '/documentation.html',
      actionLabel: 'Generate in Documentation'
    });
  }

  return {
    repository: fullName,
    defaultBranch,
    isArchived: Boolean(repoRes.data.archived),
    primaryLanguage: repoRes.data.language || 'Unknown',
    installed,
    installationId,
    setupScore: setupEvaluation.setupScore,
    findings: setupEvaluation.findings,
    workflowReports: workflowHealthReports,
    recommendations
  };
}

/**
 * Deep inspection of GitHub Actions workflows
 */
export async function inspectRepositoryWorkflows({ repoInput, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  let octokit = null;
  if (githubContext?.isAppConfigured && typeof githubContext.resolveRepoInstallation === 'function') {
    try {
      const resolution = await githubContext.resolveRepoInstallation(owner, repo);
      if (resolution?.installed && resolution.octokit) {
        octokit = resolution.octokit;
      }
    } catch (err) {
      throw mapGitHubError(err, 'Unable to verify GitHub App installation.');
    }
  }

  if (!octokit) {
    octokit = githubContext?.createPublicOctokit ? githubContext.createPublicOctokit() : null;
  }

  if (!octokit) {
    throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
  }

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to inspect "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  let workflowEntries = [];
  try {
    const wfRes = await octokit.rest.repos.getContent({ owner, repo, path: '.github/workflows', ref: defaultBranch });
    workflowEntries = Array.isArray(wfRes.data) ? wfRes.data : [];
  } catch (err) {
    if (err?.status === 404) {
      return {
        repository: fullName,
        totalWorkflows: 0,
        reports: [],
        message: 'No .github/workflows directory found in default branch.'
      };
    }
    throw mapGitHubError(err, 'Failed to inspect workflows directory.');
  }

  const candidateWorkflows = workflowEntries
    .filter((e) => e.type === 'file' && /\.(ya?ml)$/i.test(e.name))
    .slice(0, 15);

  const reports = [];
  for (const wf of candidateWorkflows) {
    try {
      const fileRes = await octokit.rest.repos.getContent({ owner, repo, path: wf.path, ref: defaultBranch });
      if (fileRes.data?.content) {
        const raw = Buffer.from(fileRes.data.content, 'base64').toString('utf8');
        reports.push(inspectWorkflowContent({ path: wf.path, content: raw }));
      }
    } catch {
      // Continue
    }
  }

  return {
    repository: fullName,
    defaultBranch,
    totalWorkflows: candidateWorkflows.length,
    reports
  };
}

/**
 * Preview proposed automation changes & detect conflicts
 */
export async function previewAutomationPr({ repoInput, files = [], replaceExisting = false, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  if (!Array.isArray(files) || files.length === 0) {
    throw new ServiceError(400, 'At least one file must be specified for preview.', 'INVALID_FILES');
  }

  let octokit = null;
  let installationPermissions = {};
  if (githubContext?.isAppConfigured && typeof githubContext.resolveRepoInstallation === 'function') {
    try {
      const resolution = await githubContext.resolveRepoInstallation(owner, repo);
      if (resolution?.installed && resolution.octokit) {
        octokit = resolution.octokit;
        installationPermissions = resolution.installation?.permissions || {};
      }
    } catch (err) {
      throw mapGitHubError(err, 'Unable to verify GitHub App installation.');
    }
  }

  if (!octokit) {
    octokit = githubContext?.createPublicOctokit ? githubContext.createPublicOctokit() : null;
  }

  if (!octokit) {
    throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
  }

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to inspect "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  const fileStatuses = [];
  const conflicts = [];
  const requiresWorkflowPermission = files.some((f) => String(f.path || f.filename).startsWith('.github/workflows/'));
  const hasWorkflowPermission = Boolean(installationPermissions.workflows === 'write');

  for (const file of files) {
    const filePath = file.path || file.filename;
    if (!filePath) continue;

    let exists = false;
    let existingSha = null;

    try {
      const contentRes = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
      exists = true;
      existingSha = contentRes.data?.sha || null;
    } catch (err) {
      if (err?.status !== 404) {
        throw mapGitHubError(err, `Failed to check status of "${filePath}".`);
      }
    }

    if (exists && !replaceExisting) {
      conflicts.push(filePath);
    }

    const isWorkflow = filePath.startsWith('.github/workflows/');
    fileStatuses.push({
      path: filePath,
      exists,
      sha: existingSha,
      isWorkflow,
      requiresWorkflowsWrite: isWorkflow,
      status: exists ? (replaceExisting ? 'will_replace' : 'conflict') : 'will_create'
    });
  }

  let workflowWarning = null;
  if (requiresWorkflowPermission && !hasWorkflowPermission) {
    workflowWarning = 'GitHub App currently lacks "Workflows (Read & write)" permission. Files under .github/workflows/ can be copied or downloaded for manual commit, or granted in GitHub App settings before automated PR creation.';
  }

  return {
    repository: fullName,
    defaultBranch,
    canProceed: conflicts.length === 0,
    conflicts,
    files: fileStatuses,
    requiresWorkflowPermission,
    hasWorkflowPermission,
    workflowWarning
  };
}

/**
 * Create an authorized repository automation pull request
 */
export async function createAutomationPullRequest({
  repoInput,
  files = [],
  replaceExisting = false,
  customBranch,
  customPrTitle,
  customPrBody,
  githubContext
}) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  if (!Array.isArray(files) || files.length === 0) {
    throw new ServiceError(400, 'At least one file is required to create a pull request.', 'INVALID_FILES');
  }

  // Resolve GitHub App installation
  let octokit;
  let installation;
  try {
    const resolution = await githubContext.resolveRepoInstallation(owner, repo);
    if (!resolution?.installed || !resolution.octokit) {
      throw new ServiceError(403, 'GitHub App is not installed on this repository.', 'APP_NOT_INSTALLED');
    }
    octokit = resolution.octokit;
    installation = resolution.installation;
  } catch (err) {
    throw mapGitHubError(err, 'Failed to resolve GitHub App installation.');
  }

  // Check repository status
  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to inspect "${fullName}".`);
  }

  if (repoRes.data.archived) {
    throw new ServiceError(400, 'Cannot open pull requests on archived repositories.', 'REPOSITORY_ARCHIVED');
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  // Permission safety check for GitHub Actions workflow files (.github/workflows/*)
  const perms = installation?.permissions || {};
  const hasWorkflowFiles = files.some((f) => String(f.path || f.filename).startsWith('.github/workflows/'));
  if (hasWorkflowFiles && perms.workflows !== 'write') {
    throw new ServiceError(
      403,
      'GitHub App requires "Workflows (Read & write)" permission to commit files under .github/workflows/. You can copy or download workflow files to commit manually, or update GitHub App permissions in GitHub settings.',
      'WORKFLOW_PERMISSION_REQUIRED'
    );
  }

  // Prepare and validate files to commit
  const filesToCommit = [];
  for (const item of files) {
    const filePath = item.path || item.filename;
    let content = item.content;

    if (!filePath || typeof filePath !== 'string') {
      throw new ServiceError(400, 'Invalid file specification: missing path.', 'INVALID_FILES');
    }

    if (filePath.startsWith('/') || filePath.includes('\\') || filePath.split('/').some((p) => !p || p === '..' || p === '.')) {
      throw new ServiceError(400, `Unsafe or invalid file path: "${filePath}".`, 'INVALID_PATH');
    }

    if (typeof content !== 'string') {
      if (item.templateId) {
        const generated = generateAutomationFile({ templateId: item.templateId, options: item.options || {} });
        content = generated.content;
      } else {
        throw new ServiceError(400, `Missing content for file "${filePath}".`, 'INVALID_CONTENT');
      }
    }

    // Check if file exists on default branch
    let existingSha = null;
    try {
      const existingRes = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
      existingSha = existingRes.data?.sha || null;
    } catch (err) {
      if (err?.status !== 404) throw mapGitHubError(err, `Failed to check "${filePath}".`);
    }

    if (existingSha && !replaceExisting) {
      throw new ServiceError(409, `File "${filePath}" already exists on default branch "${defaultBranch}". Enable replaceExisting to overwrite.`, 'CONFLICT');
    }

    filesToCommit.push({
      path: filePath,
      content,
      sha: existingSha,
      message: existingSha ? `chore: update ${filePath}` : `chore: add ${filePath}`
    });
  }

  // Get base branch SHA
  let baseSha;
  try {
    const branchRes = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch });
    baseSha = branchRes.data.commit.sha;
  } catch (err) {
    throw mapGitHubError(err, `Failed to get default branch "${defaultBranch}".`);
  }

  // Determine branch name
  const isWorkflowPr = filesToCommit.some((f) => f.path.startsWith('.github/workflows/'));
  const baseBranchName = customBranch || (isWorkflowPr ? 'ci/configure-automation' : 'chore/setup-repository');

  let featureBranch;
  try {
    featureBranch = await createFeatureBranch(octokit, {
      owner,
      repo,
      defaultBranch,
      baseSha,
      baseBranchName
    });
  } catch (err) {
    throw mapGitHubError(err, 'Failed to create feature branch.');
  }

  // Commit files sequentially
  try {
    await commitFiles(octokit, {
      owner,
      repo,
      branch: featureBranch,
      defaultBranch,
      files: filesToCommit
    });
  } catch (err) {
    throw mapGitHubError(err, 'Failed to commit files to feature branch.');
  }

  // Generate pull request title and body
  const defaultTitle = isWorkflowPr
    ? 'ci: add workflows and repository automation configuration'
    : 'chore: establish repository standards and code quality configuration';
  const prTitle = customPrTitle || defaultTitle;

  const fileListMd = filesToCommit.map((f) => `- \`${f.path}\` (${f.sha ? 'updated' : 'created'})`).join('\n');
  const defaultBody = `## Open Workers — Repository Automation

This pull request configures recommended repository infrastructure and development standards.

### Proposed Changes
${fileListMd}

---
*Generated automatically by [Open Workers](https://open-workers.onrender.com/automation.html).*`;

  const prBody = customPrBody || defaultBody;

  let prRes;
  try {
    prRes = await octokit.rest.pulls.create({
      owner,
      repo,
      title: prTitle,
      body: prBody,
      head: featureBranch,
      base: defaultBranch
    });
  } catch (err) {
    throw mapGitHubError(err, 'Failed to open pull request.');
  }

  return {
    pullNumber: prRes.data.number,
    pullUrl: prRes.data.html_url,
    branch: featureBranch,
    createdFiles: filesToCommit.map((f) => f.path)
  };
}
