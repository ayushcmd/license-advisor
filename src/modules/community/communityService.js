/**
 * Community Health Analysis & Automated PR Service
 *
 * Inspects standard GitHub community profile documents, previews proposed
 * multi-file changes, and opens consolidated Pull Requests via the GitHub App.
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { createFeatureBranch } from '../../core/pullRequests/branches.js';
import { commitFiles } from '../../core/pullRequests/files.js';
import { repositoryService } from '../../core/repository/service.js';
import { authorizeRepositoryRead } from '../../core/github/authorize.js';
import { mapGitHubError } from '../../core/github/errors.js';
import { generateDocument } from './engine.js';

export { mapGitHubError };

/**
 * Audit standard community files in a repository across root, .github/, and docs/
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {object} params.githubContext
 * @param {string} [params.authorization]
 * @param {Function} [params.createUserClient]
 * @param {object} [params.context]
 * @returns {Promise<object>}
 */
export async function auditCommunityRepository({ repoInput, githubContext, authorization, createUserClient, context = null }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;
  const isContextValid = Boolean(context && context.fullName === fullName);

  let octokit = null;
  let installed = false;
  let installationId = null;
  let repoData = null;

  if (isContextValid) {
    const clientRes = await context.resolveClient();
    octokit = clientRes.octokit;
    installed = clientRes.installed;
    installationId = clientRes.installationId;
    repoData = await context.getRepoData();

    if (repoData?.private) {
      await context.authorizeRead();
    }
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
      octokit = githubContext?.createPublicOctokit
        ? githubContext.createPublicOctokit()
        : null;
    }

    if (!octokit) {
      throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
    }

    let repoRes;
    try {
      repoRes = await octokit.rest.repos.get({ owner, repo });
      repoData = repoRes.data;
    } catch (err) {
      throw mapGitHubError(err, `Failed to inspect "${fullName}".`);
    }

    if (repoData?.private) {
      await authorizeRepositoryRead({
        authorization,
        repoInput: fullName,
        githubContext,
        createUserClient
      });
    }
  }

  const defaultBranch = repoData.default_branch || 'main';

  // Read root entries
  let rootEntries = [];
  try {
    const rootRes = isContextValid
      ? await context.getContent('', defaultBranch)
      : await octokit.rest.repos.getContent({ owner, repo, path: '', ref: defaultBranch });
    rootEntries = Array.isArray(rootRes.data) ? rootRes.data : [];
  } catch (err) {
    if (err?.status !== 404) throw mapGitHubError(err, 'Failed to inspect repository root directory.');
  }

  // Check if .github or docs directories exist
  const hasDotGithub = rootEntries.some((e) => e.name === '.github' && e.type === 'dir');
  const hasDocs = rootEntries.some((e) => e.name === 'docs' && e.type === 'dir');

  let dotGithubEntries = [];
  if (hasDotGithub) {
    try {
      const ghRes = isContextValid
        ? await context.getContent('.github', defaultBranch)
        : await octokit.rest.repos.getContent({ owner, repo, path: '.github', ref: defaultBranch });
      dotGithubEntries = Array.isArray(ghRes.data) ? ghRes.data : [];
    } catch {
      dotGithubEntries = [];
    }
  }

  let issueTemplateEntries = [];
  const hasIssueTemplateDir = dotGithubEntries.some((e) => e.name.toLowerCase() === 'issue_template' && e.type === 'dir');
  if (hasIssueTemplateDir) {
    try {
      const itRes = isContextValid
        ? await context.getContent('.github/ISSUE_TEMPLATE', defaultBranch)
        : await octokit.rest.repos.getContent({ owner, repo, path: '.github/ISSUE_TEMPLATE', ref: defaultBranch });
      issueTemplateEntries = Array.isArray(itRes.data) ? itRes.data : [];
    } catch {
      issueTemplateEntries = [];
    }
  }

  let prTemplateDirEntries = [];
  const hasPrTemplateDir = dotGithubEntries.some((e) => e.name.toLowerCase() === 'pull_request_template' && e.type === 'dir');
  if (hasPrTemplateDir) {
    try {
      const prtRes = isContextValid
        ? await context.getContent('.github/PULL_REQUEST_TEMPLATE', defaultBranch)
        : await octokit.rest.repos.getContent({ owner, repo, path: '.github/PULL_REQUEST_TEMPLATE', ref: defaultBranch });
      prTemplateDirEntries = Array.isArray(prtRes.data) ? prtRes.data : [];
    } catch {
      prTemplateDirEntries = [];
    }
  }

  let docsEntries = [];
  if (hasDocs) {
    try {
      const dRes = isContextValid
        ? await context.getContent('docs', defaultBranch)
        : await octokit.rest.repos.getContent({ owner, repo, path: 'docs', ref: defaultBranch });
      docsEntries = Array.isArray(dRes.data) ? dRes.data : [];
    } catch {
      docsEntries = [];
    }
  }

  // Helper to find a file by pattern across directories
  function findFile(regex) {
    const fromRoot = rootEntries.find((e) => e.type === 'file' && regex.test(e.name));
    if (fromRoot) return fromRoot.path;
    const fromGh = dotGithubEntries.find((e) => e.type === 'file' && regex.test(e.name));
    if (fromGh) return fromGh.path;
    const fromDocs = docsEntries.find((e) => e.type === 'file' && regex.test(e.name));
    if (fromDocs) return fromDocs.path;
    return null;
  }

  const contributingPath = findFile(/^contributing(\.md)?$/i);
  const codeOfConductPath = findFile(/^code_of_conduct(\.md)?$/i);
  const securityPath = findFile(/^security(\.md)?$/i);
  const supportPath = findFile(/^support(\.md)?$/i);

  // Pull request template check
  let prTemplatePath = findFile(/^pull_request_template(\.md)?$/i);
  if (!prTemplatePath && prTemplateDirEntries.length > 0) {
    const firstPrt = prTemplateDirEntries.find((e) => e.type === 'file');
    if (firstPrt) prTemplatePath = firstPrt.path;
  }

  // Issue templates check
  const issueTemplatePaths = issueTemplateEntries
    .filter((e) => e.type === 'file' && (e.name.endsWith('.md') || e.name.endsWith('.yml') || e.name.endsWith('.yaml')))
    .map((e) => e.path);

  const singleIssueTemplate = findFile(/^issue_template(\.md)?$/i);
  if (singleIssueTemplate && !issueTemplatePaths.includes(singleIssueTemplate)) {
    issueTemplatePaths.push(singleIssueTemplate);
  }

  const files = {
    contributing: {
      id: 'contributing',
      label: 'Contribution Guidelines',
      filename: 'CONTRIBUTING.md',
      status: contributingPath ? 'present' : 'missing',
      path: contributingPath,
      recommendation: contributingPath
        ? 'Contribution guidelines are configured.'
        : 'Add CONTRIBUTING.md to clarify workflow, coding standards, and testing expectations.'
    },
    codeOfConduct: {
      id: 'code-of-conduct',
      label: 'Code of Conduct',
      filename: 'CODE_OF_CONDUCT.md',
      status: codeOfConductPath ? 'present' : 'missing',
      path: codeOfConductPath,
      recommendation: codeOfConductPath
        ? 'Code of conduct is configured.'
        : 'Adopt a CODE_OF_CONDUCT.md (such as Contributor Covenant 3.0) to set community standards.'
    },
    security: {
      id: 'security',
      label: 'Security Policy',
      filename: 'SECURITY.md',
      status: securityPath ? 'present' : 'missing',
      path: securityPath,
      recommendation: securityPath
        ? 'Security policy is present.'
        : 'Provide a SECURITY.md policy giving researchers instructions for private vulnerability reports.'
    },
    support: {
      id: 'support',
      label: 'Support Guidelines',
      filename: 'SUPPORT.md',
      status: supportPath ? 'present' : 'missing',
      path: supportPath,
      recommendation: supportPath
        ? 'Support guidelines are present.'
        : 'Add SUPPORT.md to direct users toward discussions, documentation, and help channels.'
    },
    issueTemplates: {
      id: 'issue-templates',
      label: 'Issue Templates',
      filename: '.github/ISSUE_TEMPLATE/',
      status: issueTemplatePaths.length > 0 ? 'present' : 'missing',
      paths: issueTemplatePaths,
      path: issueTemplatePaths[0] || null,
      recommendation: issueTemplatePaths.length > 0
        ? `Found ${issueTemplatePaths.length} issue template(s).`
        : 'Add structured issue templates under .github/ISSUE_TEMPLATE/ for actionable bug reports and feature requests.'
    },
    pullRequestTemplate: {
      id: 'pull-request-template',
      label: 'Pull Request Template',
      filename: '.github/PULL_REQUEST_TEMPLATE.md',
      status: prTemplatePath ? 'present' : 'missing',
      path: prTemplatePath,
      recommendation: prTemplatePath
        ? 'Pull request template is present.'
        : 'Add .github/PULL_REQUEST_TEMPLATE.md so contributors include summaries, testing notes, and checklists.'
    }
  };

  const standardsList = Object.values(files);
  const presentCount = standardsList.filter((s) => s.status === 'present').length;
  const missingCount = standardsList.length - presentCount;
  const score = Math.round((presentCount / standardsList.length) * 100);

  const findings = standardsList.map((s) => ({
    standard: s.id,
    label: s.label,
    status: s.status,
    path: s.path,
    message: s.recommendation
  }));

  return {
    repository: {
      fullName: repoData.full_name,
      owner: repoData.owner?.login || owner,
      repo: repoData.name || repo,
      description: repoData.description || '',
      htmlUrl: repoData.html_url,
      defaultBranch,
      private: Boolean(repoData.private),
      archived: Boolean(repoData.archived),
      installed,
      installationId
    },
    summary: {
      total: standardsList.length,
      present: presentCount,
      missing: missingCount,
      score
    },
    files,
    findings
  };
}

/**
 * Preview community files to be generated or updated in a pull request.
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {Array<object>} params.documents - Array of { templateId, options }
 * @param {boolean} [params.replaceExisting=false]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function previewCommunityPr({ repoInput, documents, replaceExisting = false, githubContext }) {
  let parsed;
  try {
    parsed = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  const { owner, repo, fullName } = parsed;

  if (!Array.isArray(documents) || documents.length === 0) {
    throw new ServiceError(400, 'Select at least one document or template to generate.', 'INVALID_INPUT');
  }

  const generatedDocs = [];
  const targetPaths = new Set();
  for (const doc of documents) {
    if (!doc || typeof doc !== 'object' || !doc.templateId) {
      throw new ServiceError(400, 'Each document entry must specify a templateId.', 'INVALID_INPUT');
    }
    const generated = generateDocument({ templateId: doc.templateId, options: doc.options || {} });
    if (targetPaths.has(generated.filename)) {
      throw new ServiceError(400, `Duplicate target file path "${generated.filename}".`, 'INVALID_INPUT');
    }
    targetPaths.add(generated.filename);
    generatedDocs.push(generated);
  }

  let octokit = null;
  if (githubContext?.isAppConfigured && typeof githubContext.resolveRepoInstallation === 'function') {
    try {
      const resolution = await githubContext.resolveRepoInstallation(owner, repo);
      if (resolution?.installed && resolution.octokit) {
        octokit = resolution.octokit;
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

  // Check each document against default branch
  const fileStatuses = [];
  const conflicts = [];

  for (const doc of generatedDocs) {
    let exists = false;
    let existingSha = null;

    try {
      const existingRes = await octokit.rest.repos.getContent({ owner, repo, path: doc.filename, ref: defaultBranch });
      if (existingRes?.data?.type === 'file' && existingRes.data.sha) {
        exists = true;
        existingSha = existingRes.data.sha;
      }
    } catch (err) {
      if (err?.status !== 404) {
        throw mapGitHubError(err, `Failed to check existing file "${doc.filename}".`);
      }
    }

    if (exists && !replaceExisting) {
      conflicts.push(doc.filename);
    }

    fileStatuses.push({
      path: doc.filename,
      templateId: doc.templateId,
      action: exists ? 'replace' : 'add',
      exists,
      sha: existingSha,
      content: doc.content
    });
  }

  const baseBranchName = replaceExisting ? 'chore/update-community-standards' : 'chore/add-community-files';

  return {
    ok: true,
    repository: fullName,
    defaultBranch,
    targetBranch: baseBranchName,
    replaceExisting: Boolean(replaceExisting),
    hasConflicts: conflicts.length > 0,
    conflicts,
    files: fileStatuses
  };
}

/**
 * Create a consolidated Pull Request containing multiple community files.
 *
 * @param {object} params
 * @param {string} params.repoInput
 * @param {Array<object>} params.documents - Array of { templateId, options }
 * @param {boolean} [params.replaceExisting=false]
 * @param {string} [params.customBranch=null]
 * @param {object} params.githubContext
 * @returns {Promise<object>}
 */
export async function createCommunityPullRequest({ repoInput, documents, replaceExisting = false, customBranch = null, githubContext }) {
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

  if (!Array.isArray(documents) || documents.length === 0) {
    throw new ServiceError(400, 'Select at least one document or template to include in the pull request.', 'INVALID_INPUT');
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
        `Default branch "${defaultBranch}" has no commits yet. Create an initial commit before opening a community PR.`,
        'EMPTY_REPOSITORY'
      );
    }
    throw new ServiceError(502, `Failed to resolve default branch SHA: ${err.message}`, 'GITHUB_API_ERROR');
  }

  // Generate all documents and validate them
  const generatedDocs = [];
  const targetPaths = new Set();
  for (const doc of documents) {
    const generated = generateDocument({ templateId: doc.templateId, options: doc.options || {} });
    if (targetPaths.has(generated.filename)) {
      throw new ServiceError(400, `Duplicate target file path "${generated.filename}".`, 'INVALID_INPUT');
    }
    targetPaths.add(generated.filename);
    generatedDocs.push(generated);
  }

  // Check each file against default branch
  const filesToCommit = [];
  const existingFiles = [];

  for (const doc of generatedDocs) {
    let existingSha = null;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: doc.filename, ref: baseSha });
      if (data?.type === 'file' && data.sha) {
        existingSha = data.sha;
        existingFiles.push(doc.filename);
      }
    } catch (err) {
      if (err?.status !== 404) {
        throw new ServiceError(502, `Failed to inspect "${doc.filename}": ${err.message}`, 'GITHUB_API_ERROR');
      }
    }

    if (existingSha && !replaceExisting) {
      throw new ServiceError(
        409,
        `Repository already contains "${doc.filename}" on "${defaultBranch}". Enable replaceExisting to update it.`,
        'FILE_EXISTS',
        { existingFile: doc.filename, defaultBranch }
      );
    }

    filesToCommit.push({
      path: doc.filename,
      sha: existingSha,
      message: `chore: ${existingSha ? 'update' : 'add'} ${doc.filename}`,
      content: doc.content
    });
  }

  const baseBranchName = customBranch || (replaceExisting ? 'chore/update-community-standards' : 'chore/add-community-files');
  const targetBranch = await createFeatureBranch(octokit, {
    owner,
    repo,
    defaultBranch,
    baseSha,
    baseBranchName
  });

  // Commit files sequentially on the isolated branch
  let commitSha = null;
  try {
    commitSha = await commitFiles(octokit, {
      owner,
      repo,
      branch: targetBranch,
      defaultBranch,
      files: filesToCommit
    });
  } catch (err) {
    throw new ServiceError(502, `Failed to commit community files to branch "${targetBranch}": ${err.message}`, 'FILE_WRITE_FAILED');
  }

  const actionVerb = replaceExisting ? 'update' : 'add';
  const prTitle = `chore: ${actionVerb} community health and project standard files`;
  const prBody = [
    '## Summary',
    `This automated pull request proposes community health and project standard files targeting \`${defaultBranch}\`.`,
    '',
    '### Files Included',
    ...filesToCommit.map((f) => `- \`${f.path}\` (${f.sha ? 'updated' : 'new'})`),
    '',
    '### Guidelines Covered',
    '- Transparent expectations for maintainers and external contributors.',
    '- Clear workflows for reporting bugs, proposing features, and opening pull requests.',
    '',
    '> *Generated by Open Workers. Review the proposed community documents before merging.*'
  ].join('\n');

  try {
    const prRes = await octokit.rest.pulls.create({
      owner,
      repo,
      title: prTitle,
      head: targetBranch,
      base: defaultBranch,
      body: prBody
    });

    return {
      ok: true,
      repository: fullName,
      branch: targetBranch,
      baseBranch: defaultBranch,
      commitSha,
      pullNumber: prRes.data.number,
      pullUrl: prRes.data.html_url,
      title: prRes.data.title,
      files: filesToCommit.map((f) => f.path)
    };
  } catch (err) {
    if (err?.status === 403 || err?.status === 404) {
      throw new ServiceError(403, 'GitHub App lacks Pull Requests write permission to open the pull request.', 'INSUFFICIENT_PERMISSIONS');
    }
    if (err?.status === 422) {
      throw new ServiceError(422, `GitHub rejected pull request creation: ${err.message}`, 'PR_VALIDATION_ERROR');
    }
    throw new ServiceError(502, `Failed to open pull request: ${err.message}`, 'GITHUB_API_ERROR');
  }
}
