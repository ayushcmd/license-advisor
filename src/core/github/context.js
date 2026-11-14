/**
 * Open Workers — Request-Scoped GitHub Analysis Context
 *
 * Provides request-bounded caching of:
 * - Resolved Octokit client (GitHub App installation or public fallback)
 * - Repository metadata (`repos.get`)
 * - Authorized caller identity and permission (`authorizeRepositoryRead`)
 * - Directory tree and file contents (`repos.getContent`)
 *
 * Guarantees zero global state, zero cross-user data leakage, and automatic
 * garbage collection when the analysis request finishes.
 */

import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';
import { mapGitHubError } from './errors.js';
import { authorizeRepositoryRead } from './authorize.js';

export class AnalysisContext {
  constructor({
    repoInput,
    owner,
    repo,
    fullName,
    githubContext,
    authorization,
    createUserClient
  } = {}) {
    if (repoInput) {
      const parsed = parseRepoInput(repoInput);
      this.owner = parsed.owner;
      this.repo = parsed.repo;
      this.fullName = parsed.fullName;
    } else {
      this.owner = owner;
      this.repo = repo;
      this.fullName = fullName || (owner && repo ? `${owner}/${repo}` : null);
    }

    this.githubContext = githubContext;
    this.authorization = authorization;
    this.createUserClient = createUserClient;

    this.authCache = new Map();
    this._clientPromise = null;
    this._repoDataPromise = null;
    this._authReadPromise = null;
    this._contentCache = new Map();
  }

  /**
   * Resolve Octokit client once per request.
   */
  async resolveClient() {
    if (!this._clientPromise) {
      this._clientPromise = (async () => {
        let octokit = null;
        let installed = false;
        let installationId = null;
        let installation = null;

        if (this.githubContext?.isAppConfigured && typeof this.githubContext.resolveRepoInstallation === 'function') {
          try {
            const resolution = await this.githubContext.resolveRepoInstallation(this.owner, this.repo);
            if (resolution?.installed && resolution.octokit) {
              octokit = resolution.octokit;
              installed = true;
              installationId = resolution.installation?.id || null;
              installation = resolution.installation || null;
            }
          } catch {
            // Fall back to public client if App resolution fails
          }
        }

        if (!octokit) {
          if (typeof this.githubContext?.createPublicOctokit === 'function') {
            octokit = this.githubContext.createPublicOctokit();
          } else if (typeof this.githubContext?.getPublicOctokit === 'function') {
            octokit = this.githubContext.getPublicOctokit();
          }
        }

        if (!octokit) {
          throw new ServiceError(503, 'GitHub client is unavailable.', 'CLIENT_UNAVAILABLE');
        }

        return { octokit, installed, installationId, installation };
      })();
    }
    return this._clientPromise;
  }

  /**
   * Retrieve and cache repository metadata once per request.
   */
  async getRepoData() {
    if (!this._repoDataPromise) {
      this._repoDataPromise = (async () => {
        const { octokit } = await this.resolveClient();
        try {
          const res = await octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
          return res.data;
        } catch (err) {
          throw mapGitHubError(err, `Failed to inspect repository "${this.fullName}".`);
        }
      })();
    }
    return this._repoDataPromise;
  }

  /**
   * Verify read permissions once per request for private repositories.
   */
  async authorizeRead() {
    if (!this._authReadPromise) {
      this._authReadPromise = (async () => {
        return authorizeRepositoryRead({
          authorization: this.authorization,
          repoInput: this.fullName,
          githubContext: this.githubContext,
          createUserClient: this.createUserClient,
          authCache: this.authCache
        });
      })();
    }
    return this._authReadPromise;
  }

  /**
   * Retrieve repository contents with in-memory memoization per request scope.
   * Concurrently in-flight requests for the same path and ref share the exact same Promise.
   */
  async getContent(path = '', ref) {
    const defaultRef = ref || (await this.getRepoData()).default_branch || 'main';
    const cacheKey = `${path}::${defaultRef}`;

    if (!this._contentCache.has(cacheKey)) {
      const promise = (async () => {
        const { octokit } = await this.resolveClient();
        return octokit.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path,
          ref: defaultRef
        });
      })();

      // Prevent unhandled rejection warning if downstream handlers attach asynchronously
      promise.catch(() => {});
      this._contentCache.set(cacheKey, promise);
    }

    return this._contentCache.get(cacheKey);
  }
}
