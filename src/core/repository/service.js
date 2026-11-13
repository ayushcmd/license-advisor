// Shared, explicit repository reads. 404 means absent; other failures propagate.
export function repositoryService(octokit, { owner, repo }) {
  const scope = { owner, repo };
  return {
    async metadata() { return (await octokit.rest.repos.get(scope)).data; },
    async read(path, ref) {
      try { return (await octokit.rest.repos.getContent({ ...scope, path, ref })).data; }
      catch (error) { if (error.status === 404) return null; throw error; }
    },
    async root(ref) { const entries = await this.read('', ref); return Array.isArray(entries) ? entries : []; },
    async exists(path, ref) { return (await this.read(path, ref)) !== null; },
    async base(defaultBranch) { return (await octokit.rest.git.getRef({ ...scope, ref: `heads/${defaultBranch}` })).data.object.sha; }
  };
}
