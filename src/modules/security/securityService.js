/**
 * Open Workers — Security Service
 *
 * Implements repository security configuration inspection, transparent health scoring,
 * pull request previews, and automated configuration pull requests.
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { createFeatureBranch } from '../../core/pullRequests/branches.js';
import { commitFiles } from '../../core/pullRequests/files.js';
import { repositoryService } from '../../core/repository/service.js';
import { generateSecurityConfig, SECURITY_CHECKS } from './engine.js';

function mapGitHubError(err, fallbackMessage) {
  if (err instanceof ServiceError) return err;
  const status = err?.status || 500;
  if (status === 404) return new ServiceError(404, 'Repository not found or access denied.', 'NOT_FOUND');
  if (status === 403) return new ServiceError(403, 'GitHub API access denied or rate limit exceeded.', 'INSUFFICIENT_PERMISSIONS');
  if (status === 401) return new ServiceError(401, 'GitHub authentication failed or credentials expired.', 'AUTH_REQUIRED');
  return new ServiceError(502, `${fallbackMessage}: ${err?.message || 'Upstream error'}`, 'GITHUB_API_ERROR');
}

/**
 * Perform a non-destructive security configuration inspection on a GitHub repository
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function auditSecurityRepository({ repoInput, githubContext }) {
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

  // Read docs directory entries if present
  const hasDocs = rootEntries.some((e) => e.name === 'docs' && e.type === 'dir');
  let docsEntries = [];
  if (hasDocs) {
    try {
      const docsRes = await octokit.rest.repos.getContent({ owner, repo, path: 'docs', ref: defaultBranch });
      docsEntries = Array.isArray(docsRes.data) ? docsRes.data : [];
    } catch {
      docsEntries = [];
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

  // 1. Check SECURITY.md policy
  let securityPolicyPath = null;
  const rootSecurity = rootEntries.find((e) => e.type === 'file' && /^security\.md$/i.test(e.name));
  const dotGithubSecurity = dotGithubEntries.find((e) => e.type === 'file' && /^security\.md$/i.test(e.name));
  const docsSecurity = docsEntries.find((e) => e.type === 'file' && /^security\.md$/i.test(e.name));

  if (rootSecurity) securityPolicyPath = rootSecurity.path;
  else if (dotGithubSecurity) securityPolicyPath = dotGithubSecurity.path;
  else if (docsSecurity) securityPolicyPath = docsSecurity.path;

  // 2. Check Dependabot configuration
  let dependabotPath = null;
  const dependabotFile = dotGithubEntries.find((e) => e.type === 'file' && /^dependabot\.ya?ml$/i.test(e.name));
  if (dependabotFile) {
    dependabotPath = dependabotFile.path;
  }

  // 3. Check CodeQL workflow
  let codeqlWorkflowPath = null;
  // First check file names for codeql
  const codeqlFileByName = workflowEntries.find((e) => e.type === 'file' && /codeql/i.test(e.name));
  if (codeqlFileByName) {
    codeqlWorkflowPath = codeqlFileByName.path;
  } else if (workflowEntries.length > 0) {
    // If not obvious by name, inspect workflow files for CodeQL action references (up to 5 workflows)
    for (const wf of workflowEntries.slice(0, 5)) {
      if (wf.type === 'file' && /\.(ya?ml)$/i.test(wf.name)) {
        try {
          const wfContentRes = await octokit.rest.repos.getContent({ owner, repo, path: wf.path, ref: defaultBranch });
          if (wfContentRes?.data?.content) {
            const decoded = Buffer.from(wfContentRes.data.content, 'base64').toString('utf8');
            if (decoded.includes('github/codeql-action') || decoded.includes('actions/setup-codeql')) {
              codeqlWorkflowPath = wf.path;
              break;
            }
          }
        } catch {
          // Ignore read error for single workflow
        }
      }
    }
  }

  // 4. Check Branch Protection on default branch
  let branchProtectionStatus = 'missing';
  let branchProtectionDescription = `No branch protection rules configured on default branch "${defaultBranch}".`;
  let branchProtectionRecommendation = 'Enable branch protection in repository settings to require pull request reviews and status checks before merging.';

  try {
    const bpRes = await octokit.rest.repos.getBranchProtection({ owner, repo, branch: defaultBranch });
    if (bpRes?.data) {
      const hasReviews = Boolean(bpRes.data.required_pull_request_reviews);
      const hasChecks = Boolean(bpRes.data.required_status_checks);
      if (hasReviews && hasChecks) {
        branchProtectionStatus = 'passed';
        branchProtectionDescription = `Default branch "${defaultBranch}" is protected with required reviews and status checks.`;
        branchProtectionRecommendation = 'Branch protection rules are actively enforcing reviews and CI checks.';
      } else if (hasReviews || hasChecks) {
        branchProtectionStatus = 'needs_attention';
        branchProtectionDescription = `Default branch "${defaultBranch}" has partial protection (${hasReviews ? 'reviews required' : 'status checks required'}, but not both).`;
        branchProtectionRecommendation = 'Consider requiring both peer reviews and automated status checks on the default branch.';
      } else {
        branchProtectionStatus = 'needs_attention';
        branchProtectionDescription = `Branch protection is enabled on "${defaultBranch}", but no review or status check requirements are configured.`;
        branchProtectionRecommendation = 'Configure required pull request reviews or status checks to prevent unverified code from merging.';
      }
    }
  } catch (err) {
    if (err?.status === 404) {
      branchProtectionStatus = 'missing';
      branchProtectionDescription = `No branch protection rules configured on default branch "${defaultBranch}".`;
    } else if (err?.status === 403 || err?.status === 401) {
      branchProtectionStatus = 'not_verified';
      branchProtectionDescription = 'Branch protection details are not accessible via current API permissions.';
      branchProtectionRecommendation = 'Repository administration permissions are required to inspect branch protection settings via the GitHub API.';
    }
  }

  // 5. Check Secret Scanning (if metadata exposes security_and_analysis)
  let secretScanningStatus = 'not_verified';
  let secretScanningDescription = 'Secret scanning status is not accessible in public repository metadata without admin privileges.';
  let secretScanningRecommendation = 'Verify that Secret Scanning and Push Protection are enabled in repository Security settings.';

  const secAnalysis = repoRes.data.security_and_analysis;
  if (secAnalysis) {
    const ss = secAnalysis.secret_scanning?.status;
    const pp = secAnalysis.secret_scanning_push_protection?.status;
    if (ss === 'enabled' && pp === 'enabled') {
      secretScanningStatus = 'passed';
      secretScanningDescription = 'Secret scanning and push protection are enabled.';
      secretScanningRecommendation = 'Secret scanning is actively protecting commits against credential leaks.';
    } else if (ss === 'enabled') {
      secretScanningStatus = 'needs_attention';
      secretScanningDescription = 'Secret scanning is enabled, but push protection is not enabled.';
      secretScanningRecommendation = 'Enable Secret Scanning Push Protection to block commits containing sensitive secrets before push.';
    } else if (ss === 'disabled') {
      secretScanningStatus = 'needs_attention';
      secretScanningDescription = 'Secret scanning is disabled in repository settings.';
      secretScanningRecommendation = 'Enable Secret Scanning in repository Security settings to detect exposed credentials.';
    }
  } else if (!repoRes.data.private) {
    // For public repositories, Secret Scanning is free on GitHub. Without admin token, note verification status cleanly.
    secretScanningStatus = 'not_verified';
    secretScanningDescription = 'Secret scanning configuration could not be verified without administrative repository permissions.';
    secretScanningRecommendation = 'Check repository Settings > Code security and analysis to ensure Secret Scanning and Push Protection are active.';
  }

  // 6. Check Dependabot Alerts
  let dependabotAlertsStatus = 'not_verified';
  let dependabotAlertsDescription = 'Dependabot vulnerability alerts status is not accessible without administrative API access.';
  let dependabotAlertsRecommendation = 'Ensure Dependabot alerts are enabled in repository Security settings.';

  if (secAnalysis?.dependabot_security_updates?.status) {
    const dsu = secAnalysis.dependabot_security_updates.status;
    if (dsu === 'enabled') {
      dependabotAlertsStatus = 'passed';
      dependabotAlertsDescription = 'Dependabot security updates and alerts are enabled.';
      dependabotAlertsRecommendation = 'Dependabot is actively monitoring dependencies for known vulnerabilities.';
    } else {
      dependabotAlertsStatus = 'needs_attention';
      dependabotAlertsDescription = 'Dependabot security updates are disabled.';
      dependabotAlertsRecommendation = 'Enable Dependabot security updates in repository Settings > Code security.';
    }
  }

  // Construct structured check results
  const checks = [
    {
      id: 'security-policy',
      name: 'Security Policy (SECURITY.md)',
      category: 'policy',
      severity: 'high',
      status: securityPolicyPath ? 'passed' : 'missing',
      path: securityPolicyPath,
      description: securityPolicyPath
        ? `Security policy found at "${securityPolicyPath}".`
        : 'No SECURITY.md policy file found in standard locations (root, .github/, docs/).',
      recommendation: securityPolicyPath
        ? 'Security policy is configured.'
        : 'Add a SECURITY.md policy giving researchers instructions for private vulnerability reports.',
      canGenerateFix: false,
      fixUrl: '/community.html?template=security',
      fixLabel: 'Generate in Community module'
    },
    {
      id: 'dependabot-config',
      name: 'Dependabot Configuration',
      category: 'dependencies',
      severity: 'medium',
      status: dependabotPath ? 'passed' : 'missing',
      path: dependabotPath,
      description: dependabotPath
        ? `Dependabot configuration found at "${dependabotPath}".`
        : 'No Dependabot configuration file found (.github/dependabot.yml).',
      recommendation: dependabotPath
        ? 'Dependabot configuration is present.'
        : 'Generate a .github/dependabot.yml configuration to keep dependencies and GitHub Actions up to date.',
      canGenerateFix: true,
      fixTemplateId: 'dependabot',
      fixLabel: 'Generate Dependabot config'
    },
    {
      id: 'codeql-analysis',
      name: 'CodeQL Static Analysis',
      category: 'code-scanning',
      severity: 'medium',
      status: codeqlWorkflowPath ? 'passed' : 'missing',
      path: codeqlWorkflowPath,
      description: codeqlWorkflowPath
        ? `CodeQL workflow found at "${codeqlWorkflowPath}".`
        : 'No CodeQL static analysis workflow found under .github/workflows/.',
      recommendation: codeqlWorkflowPath
        ? 'CodeQL workflow is present.'
        : 'Generate a CodeQL analysis workflow (.github/workflows/codeql.yml) to detect code vulnerabilities in CI.',
      canGenerateFix: true,
      fixTemplateId: 'codeql',
      fixLabel: 'Generate CodeQL workflow'
    },
    {
      id: 'branch-protection',
      name: 'Default Branch Protection',
      category: 'branch-governance',
      severity: 'medium',
      status: branchProtectionStatus,
      description: branchProtectionDescription,
      recommendation: branchProtectionRecommendation,
      canGenerateFix: false
    },
    {
      id: 'secret-scanning',
      name: 'Secret Scanning',
      category: 'secrets',
      severity: 'high',
      status: secretScanningStatus,
      description: secretScanningDescription,
      recommendation: secretScanningRecommendation,
      canGenerateFix: false
    },
    {
      id: 'dependabot-alerts',
      name: 'Dependabot Vulnerability Alerts',
      category: 'dependencies',
      severity: 'high',
      status: dependabotAlertsStatus,
      description: dependabotAlertsDescription,
      recommendation: dependabotAlertsRecommendation,
      canGenerateFix: false
    }
  ];

  // Calculate transparent Security Configuration Health score
  const verifiedChecks = checks.filter((c) => c.status === 'passed' || c.status === 'missing' || c.status === 'needs_attention');
  const passedChecks = checks.filter((c) => c.status === 'passed');
  const missingChecks = checks.filter((c) => c.status === 'missing');
  const needsAttentionChecks = checks.filter((c) => c.status === 'needs_attention');
  const notVerifiedChecks = checks.filter((c) => c.status === 'not_verified');

  const healthScore = verifiedChecks.length > 0
    ? Math.round((passedChecks.length / verifiedChecks.length) * 100)
    : 0;

  // Actionable recommendations
  const actionableRecommendations = checks
    .filter((c) => c.status === 'missing' || c.status === 'needs_attention')
    .map((c) => ({
      checkId: c.id,
      name: c.name,
      severity: c.severity,
      message: c.recommendation,
      canGenerateFix: Boolean(c.canGenerateFix),
      fixTemplateId: c.fixTemplateId || null,
      fixUrl: c.fixUrl || null,
      fixLabel: c.fixLabel || null
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
      fork: Boolean(repoRes.data.fork),
      installed,
      installationId
    },
    inspectedAt: new Date().toISOString(),
    summary: {
      healthScore,
      passed: passedChecks.length,
      missing: missingChecks.length,
      needsAttention: needsAttentionChecks.length,
      notVerified: notVerifiedChecks.length,
      totalVerified: verifiedChecks.length,
      totalChecks: checks.length,
      assessmentNotice: 'This score evaluates verified repository security configuration hygiene. Unverified checks require administrative repository permissions and are not counted as failures. This report assesses configuration hygiene and does not guarantee the absence of code vulnerabilities.'
    },
    checks,
    recommendations: actionableRecommendations
  };
}

/**
 * Preview proposed security configuration files and inspect existing file conflicts
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {Array<object>} params.configs
 * @param {boolean} [params.replaceExisting=false]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function previewSecurityPr({ repoInput, configs, replaceExisting = false, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  if (!Array.isArray(configs) || configs.length === 0) {
    throw new ServiceError(400, 'Select at least one security configuration to preview.', 'INVALID_INPUT');
  }

  const generatedFiles = [];
  const targetPaths = new Set();
  for (const cfg of configs) {
    if (!cfg || typeof cfg !== 'object' || !cfg.templateId) {
      throw new ServiceError(400, 'Each configuration entry must specify a templateId ("dependabot" or "codeql").', 'INVALID_INPUT');
    }
    const generated = generateSecurityConfig({ templateId: cfg.templateId, options: cfg.options || {} });
    if (targetPaths.has(generated.filename)) {
      throw new ServiceError(400, `Duplicate target file path "${generated.filename}".`, 'INVALID_INPUT');
    }
    targetPaths.add(generated.filename);
    generatedFiles.push(generated);
  }

  let octokit = null;
  let appInstalled = false;
  let installationPermissions = {};

  if (githubContext?.isAppConfigured && typeof githubContext.resolveRepoInstallation === 'function') {
    try {
      const resolution = await githubContext.resolveRepoInstallation(owner, repo);
      if (resolution?.installed && resolution.octokit) {
        octokit = resolution.octokit;
        appInstalled = true;
        installationPermissions = resolution.installation?.permissions || {};
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

  let repoRes;
  try {
    repoRes = await octokit.rest.repos.get({ owner, repo });
  } catch (err) {
    throw mapGitHubError(err, `Failed to load details for "${fullName}".`);
  }

  const defaultBranch = repoRes.data.default_branch || 'main';

  // Check each file against default branch
  const fileStatuses = [];
  const conflicts = [];
  const requiresWorkflowPermission = generatedFiles.some((f) => f.filename.startsWith('.github/workflows/'));
  const hasWorkflowPermission = Boolean(installationPermissions.workflows === 'write');

  for (const file of generatedFiles) {
    let exists = false;
    let existingSha = null;

    try {
      const existingRes = await octokit.rest.repos.getContent({ owner, repo, path: file.filename, ref: defaultBranch });
      if (existingRes?.data?.type === 'file' && existingRes.data.sha) {
        exists = true;
        existingSha = existingRes.data.sha;
      }
    } catch (err) {
      if (err?.status !== 404) {
        throw mapGitHubError(err, `Failed to check existing file "${file.filename}".`);
      }
    }

    if (exists && !replaceExisting) {
      conflicts.push(file.filename);
    }

    const isWorkflow = file.filename.startsWith('.github/workflows/');

    fileStatuses.push({
      path: file.filename,
      templateId: file.templateId,
      action: exists ? 'replace' : 'add',
      exists,
      sha: existingSha,
      isWorkflow,
      workflowPermissionRequired: isWorkflow,
      content: file.content
    });
  }

  let workflowWarning = null;
  if (requiresWorkflowPermission && !hasWorkflowPermission) {
    workflowWarning = 'GitHub App currently lacks "Workflows (Read & write)" permission. Files under .github/workflows/ (such as CodeQL) can be copied or downloaded for manual commit, or granted in GitHub App settings before automated PR creation.';
  }

  return {
    repository: {
      fullName: repoRes.data.full_name,
      owner: repoRes.data.owner?.login || owner,
      repo: repoRes.data.name || repo,
      defaultBranch,
      private: Boolean(repoRes.data.private),
      archived: Boolean(repoRes.data.archived)
    },
    appInstalled,
    installationPermissions,
    hasWorkflowPermission,
    requiresWorkflowPermission,
    workflowWarning,
    replaceExisting: Boolean(replaceExisting),
    hasConflicts: conflicts.length > 0,
    conflicts,
    canProceed: conflicts.length === 0 && (!requiresWorkflowPermission || hasWorkflowPermission),
    files: fileStatuses
  };
}

/**
 * Open a consolidated security configuration pull request via GitHub App
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {Array<object>} params.configs
 * @param {boolean} [params.replaceExisting=false]
 * @param {string} [params.customBranch]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function createSecurityPullRequest({
  repoInput,
  configs,
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

  if (!Array.isArray(configs) || configs.length === 0) {
    throw new ServiceError(400, 'Select at least one security configuration to include in the pull request.', 'INVALID_INPUT');
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
    if (err?.status === 403) {
      throw new ServiceError(403, `GitHub App lacks permission to read metadata for "${fullName}".`, 'INSUFFICIENT_PERMISSIONS');
    }
    if (err?.status === 404) {
      throw new ServiceError(404, `Repository "${fullName}" was not found.`, 'NOT_FOUND');
    }
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
        `Default branch "${defaultBranch}" has no commits yet. Create an initial commit before opening a security PR.`,
        'EMPTY_REPOSITORY'
      );
    }
    throw new ServiceError(502, `Failed to resolve default branch SHA: ${err.message}`, 'GITHUB_API_ERROR');
  }

  // Generate configurations and validate them
  const generatedFiles = [];
  const targetPaths = new Set();
  for (const cfg of configs) {
    const generated = generateSecurityConfig({ templateId: cfg.templateId, options: cfg.options || {} });
    if (targetPaths.has(generated.filename)) {
      throw new ServiceError(400, `Duplicate target file path "${generated.filename}".`, 'INVALID_INPUT');
    }
    targetPaths.add(generated.filename);
    generatedFiles.push(generated);
  }

  // Permission safety check for GitHub Actions workflow files (.github/workflows/*)
  const hasWorkflowFiles = generatedFiles.some((f) => f.filename.startsWith('.github/workflows/'));
  if (hasWorkflowFiles && perms.workflows !== 'write') {
    throw new ServiceError(
      403,
      'GitHub App requires "Workflows (Read & write)" permission to commit files under .github/workflows/. You can copy or download codeql.yml to commit manually, or update GitHub App permissions in GitHub settings.',
      'WORKFLOW_PERMISSION_REQUIRED'
    );
  }

  // Check each file against default branch for existing files and conflicts
  const filesToCommit = [];
  const existingFiles = [];

  for (const file of generatedFiles) {
    let existingSha = null;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: file.filename, ref: baseSha });
      if (data?.type === 'file' && data.sha) {
        existingSha = data.sha;
        existingFiles.push(file.filename);
      }
    } catch (err) {
      if (err?.status !== 404) {
        throw mapGitHubError(err, `Failed to inspect default branch for "${file.filename}".`);
      }
    }

    if (existingSha && !replaceExisting) {
      throw new ServiceError(
        409,
        `File "${file.filename}" already exists on "${defaultBranch}". Enable replaceExisting to update it.`,
        'FILE_ALREADY_EXISTS',
        { existingFile: file.filename }
      );
    }

    const actionVerb = existingSha ? 'update' : 'add';
    filesToCommit.push({
      path: file.filename,
      content: file.content,
      sha: replaceExisting && existingSha ? existingSha : undefined,
      message: `chore(security): ${actionVerb} ${file.filename}`
    });
  }

  // Create isolated feature branch
  const baseBranchName = customBranch && typeof customBranch === 'string' && /^[a-zA-Z0-9_\-\.\/]+$/.test(customBranch.trim())
    ? customBranch.trim()
    : 'chore/configure-security';

  const branch = await createFeatureBranch(octokit, {
    owner,
    repo,
    defaultBranch,
    baseSha,
    baseBranchName
  });

  // Commit files sequentially on the feature branch
  try {
    await commitFiles(octokit, {
      owner,
      repo,
      branch,
      defaultBranch,
      files: filesToCommit
    });
  } catch (err) {
    throw new ServiceError(502, `Failed to commit security configurations: ${err.message}`, 'COMMIT_FAILED');
  }

  // Open the Pull Request
  const fileNames = generatedFiles.map((f) => f.templateId === 'dependabot' ? 'Dependabot' : 'CodeQL');
  const prTitle = `chore(security): configure ${fileNames.join(' and ')}`;

  const prBody = [
    '## Summary',
    '',
    `This pull request introduces automated repository security configuration using **[Open Workers](https://open-workers.onrender.com)**.`,
    '',
    '### Configured Files',
    '',
    ...generatedFiles.map((f) => `- \`${f.filename}\` (${f.templateId === 'dependabot' ? 'Dependabot version & security updates' : 'CodeQL semantic code scanning workflow'})`),
    '',
    '### Security Guidelines & Next Steps',
    '',
    '- **Dependabot:** Once merged, GitHub Dependabot will automatically scan dependency manifests on schedule and open pull requests for outdated or vulnerable packages.',
    '- **CodeQL:** Code scanning will execute automatically on push, pull request, and weekly schedule. Results appear under the **Security > Code scanning** tab.',
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
    files: filesToCommit.map((f) => f.path)
  };
}
