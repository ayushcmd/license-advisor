// Internal service only: callers must authorize the user and inspect each file.
// Writes multiple files sequentially on a dedicated branch; expected SHAs protect
// replacements. A failure never opens a PR or force-updates a branch.
export async function commitFiles(octokit, { owner, repo, branch, defaultBranch, files }) {
  if (!branch || branch === defaultBranch) throw new Error('A dedicated feature branch is required.');
  const paths = new Set();
  for (const file of files) {
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '..' || part === '.') || paths.has(file.path)) throw new Error('Invalid or duplicate file path.');
    if (typeof file.content !== 'string' || !file.message) throw new Error('Content and commit message are required.');
    paths.add(file.path);
  }
  let commitSha = null;
  for (const file of files) {
    const result = await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, branch, path: file.path, ...(file.sha ? { sha: file.sha } : {}), message: file.message, content: Buffer.from(file.content, 'utf8').toString('base64') });
    commitSha = result.data?.commit?.sha || commitSha;
  }
  return commitSha;
}
