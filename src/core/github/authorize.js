import { Octokit } from '@octokit/rest';
import { parseRepoInput } from '../../../public/js/analyzer.js';
import { ServiceError } from '../../services/licenseService.js';

// A user token proves identity; the installation independently checks that user's
// repository permission. Never use a caller-supplied login or installation ID.
export async function authorizeRepositoryWrite({
  authorization,
  repoInput,
  githubContext,
  createUserClient = (token) => new Octokit({ auth: token, log: { debug() {}, info() {}, warn() {}, error() {} } })
}) {
  const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+([A-Za-z0-9_.-]+)$/i);
  if (!match || match[1].length > 512) {
    throw new ServiceError(401, 'A GitHub user access token is required to create a pull request.', 'AUTH_REQUIRED');
  }
  let repository;
  try {
    repository = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }
  try {
    const { data: user } = await createUserClient(match[1]).rest.users.getAuthenticated();
    if (!user?.login || user.type !== 'User') {
      throw new ServiceError(403, 'A human GitHub user account is required.', 'FORBIDDEN');
    }
    const resolution = await githubContext.resolveRepoInstallation(repository.owner, repository.repo);
    if (!resolution?.installed || !resolution.octokit) {
      throw new ServiceError(403, 'Repository access could not be authorized.', 'FORBIDDEN');
    }
    const { data } = await resolution.octokit.rest.repos.getCollaboratorPermissionLevel({
      owner: repository.owner,
      repo: repository.repo,
      username: user.login
    });
    if (!['write', 'admin', 'maintain'].includes(data.permission)) {
      throw new ServiceError(403, 'Write access to this repository is required.', 'FORBIDDEN');
    }
    return { login: user.login, repository: repository.fullName };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error.status === 401) throw new ServiceError(401, 'GitHub user token is invalid or expired.', 'AUTH_REQUIRED');
    if ([403, 404].includes(error.status)) throw new ServiceError(403, 'Repository access could not be authorized.', 'FORBIDDEN');
    throw new ServiceError(503, 'GitHub authorization is unavailable. No changes were made.', 'AUTH_UNAVAILABLE');
  }
}

/**
 * Authorize read-only inspection of private repositories.
 * Requires caller authentication and verifies read-level permission on target repo.
 */
export async function authorizeRepositoryRead({
  authorization,
  repoInput,
  githubContext,
  createUserClient = (token) => new Octokit({ auth: token, log: { debug() {}, info() {}, warn() {}, error() {} } }),
  authCache = null
}) {
  const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+([A-Za-z0-9_.-]+)$/i);
  if (!match || match[1].length > 512) {
    throw new ServiceError(401, 'Private repository analysis requires GitHub user authorization.', 'AUTH_REQUIRED');
  }
  let repository;
  try {
    repository = parseRepoInput(repoInput);
  } catch (error) {
    throw new ServiceError(400, error.message, 'INVALID_INPUT');
  }

  const cacheKey = authCache ? `${repository.fullName}::${match[1]}` : null;
  if (cacheKey && authCache.has(cacheKey)) {
    const cached = authCache.get(cacheKey);
    if (cached instanceof Error) throw cached;
    return cached;
  }

  try {
    const userClient = createUserClient(match[1]);
    let username = null;
    if (typeof userClient.rest?.users?.getAuthenticated === 'function') {
      try {
        const { data: user } = await userClient.rest.users.getAuthenticated();
        if (user?.type && user.type !== 'User') {
          throw new ServiceError(403, 'A human GitHub user account is required.', 'FORBIDDEN');
        }
        username = user?.login;
      } catch (userErr) {
        if (userErr instanceof ServiceError) throw userErr;
        if (userErr?.status === 401) {
          throw new ServiceError(401, 'GitHub user token is invalid or expired.', 'AUTH_REQUIRED');
        }
      }
    }

    const resolution = githubContext?.resolveRepoInstallation
      ? await githubContext.resolveRepoInstallation(repository.owner, repository.repo)
      : null;

    if (resolution?.installed && resolution.octokit && username) {
      const { data } = await resolution.octokit.rest.repos.getCollaboratorPermissionLevel({
        owner: repository.owner,
        repo: repository.repo,
        username
      });
      if (!['read', 'triage', 'write', 'admin', 'maintain'].includes(data.permission)) {
        throw new ServiceError(403, 'Access to private repository was denied.', 'FORBIDDEN');
      }
      const verified = { login: username, repository: repository.fullName, permission: data.permission };
      if (cacheKey && authCache) authCache.set(cacheKey, verified);
      return verified;
    }

    // Direct repo check via caller's client
    const userCheck = await userClient.rest.repos.get({
      owner: repository.owner,
      repo: repository.repo
    });
    if (!userCheck?.data) {
      throw new ServiceError(403, 'Access to private repository was denied.', 'FORBIDDEN');
    }
    const verified = { login: username || 'authorized-user', repository: repository.fullName };
    if (cacheKey && authCache) authCache.set(cacheKey, verified);
    return verified;
  } catch (error) {
    if (cacheKey && authCache) authCache.set(cacheKey, error);
    if (error instanceof ServiceError) throw error;
    if (error.status === 401) throw new ServiceError(401, 'GitHub user token is invalid or expired.', 'AUTH_REQUIRED');
    if ([403, 404].includes(error.status)) throw new ServiceError(403, 'Access to private repository was denied.', 'FORBIDDEN');
    throw new ServiceError(503, 'GitHub authorization is unavailable. No inspection performed.', 'AUTH_UNAVAILABLE');
  }
}
