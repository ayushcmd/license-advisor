import { ServiceError } from '../../services/licenseService.js';

// Conflict-aware branch creation shared by repository capabilities.
export async function createFeatureBranch(octokit, { owner, repo, defaultBranch, baseSha, baseBranchName }) {
  let targetBranch = baseBranchName;

  if (targetBranch === defaultBranch) {
    targetBranch = `${baseBranchName}-file`;
  }

  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${targetBranch}`,
      sha: baseSha
    });
  } catch (err) {
    if (err?.status === 422) {
      const existingPrs = await octokit.rest.pulls
        .list({ owner, repo, state: 'open', head: `${owner}:${targetBranch}` })
        .catch(() => { throw new ServiceError(502, 'Could not check existing pull requests. Retry when GitHub is available.', 'GITHUB_API_ERROR'); });

      if (Array.isArray(existingPrs.data) && existingPrs.data.length > 0) {
        const openPr = existingPrs.data[0];
        throw new ServiceError(
          409,
          `An open pull request (#${openPr.number}) already exists for branch "${targetBranch}".`,
          'PR_ALREADY_EXISTS',
          { pullNumber: openPr.number, pullUrl: openPr.html_url }
        );
      }

      targetBranch = `${baseBranchName}-${Date.now().toString(36)}`;
      try {
        await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${targetBranch}`,
          sha: baseSha
        });
      } catch (retryErr) {
        if (retryErr?.status === 403) {
          throw new ServiceError(403, 'GitHub App lacks write permission to create branches.', 'INSUFFICIENT_PERMISSIONS');
        }
        throw new ServiceError(502, `Failed to create feature branch "${targetBranch}": ${retryErr.message}`, 'GITHUB_API_ERROR');
      }
    } else if (err?.status === 403) {
      throw new ServiceError(403, 'GitHub App lacks Contents write permission to create branches.', 'INSUFFICIENT_PERMISSIONS');
    } else {
      throw new ServiceError(502, `Failed to create feature branch "${targetBranch}": ${err.message}`, 'GITHUB_API_ERROR');
    }
  }

  return targetBranch;
}
