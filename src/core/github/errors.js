/**
 * Open Workers — GitHub API Error Handling & Diagnostics
 *
 * Standardizes upstream GitHub REST API error mapping, rate-limit extraction,
 * secondary rate-limit detection, and network failure diagnostics.
 */

import { ServiceError } from '../../services/licenseService.js';

export { ServiceError };

/**
 * Extract GitHub rate-limit headers from an HTTP response or Octokit error.
 *
 * @param {object} headers
 * @returns {object|null}
 */
export function extractOctokitRateLimit(headers) {
  if (!headers || typeof headers !== 'object') return null;

  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  const retryAfter = headers['retry-after'];

  if (limit === undefined && remaining === undefined && retryAfter === undefined) {
    return null;
  }

  const resetEpoch = reset ? Number(reset) * 1000 : null;
  const parsedRetryAfter = retryAfter ? parseInt(retryAfter, 10) : null;

  return {
    limit: limit !== undefined ? Number(limit) : null,
    remaining: remaining !== undefined ? Number(remaining) : null,
    resetAt: resetEpoch && Number.isFinite(resetEpoch) ? new Date(resetEpoch).toISOString() : null,
    retryAfter: Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter : null
  };
}

/**
 * Maps upstream GitHub errors to structured ServiceError instances with standard HTTP status codes.
 *
 * @param {Error|object} err
 * @param {string} [contextMessage='']
 * @returns {ServiceError}
 */
export function mapGitHubError(err, contextMessage = '') {
  if (err instanceof ServiceError) return err;

  const status = Number(err?.status || err?.response?.status || (typeof err?.statusCode === 'number' ? err.statusCode : 0)) || 500;
  const msg = String(err?.message || '');
  const headers = err?.response?.headers || err?.headers || null;
  const rateLimit = extractOctokitRateLimit(headers);

  // 1. Rate Limiting (Primary, Secondary / Abuse Detection)
  const isSecondaryRateLimit = msg.toLowerCase().includes('secondary rate limit') || msg.toLowerCase().includes('abuse detection');
  const isRateLimited = status === 429 ||
    (status === 403 && (msg.toLowerCase().includes('rate limit') || isSecondaryRateLimit || rateLimit?.remaining === 0));

  if (isRateLimited) {
    const retryAfter = rateLimit?.retryAfter || null;
    const resetAt = rateLimit?.resetAt || null;
    const message = isSecondaryRateLimit
      ? 'GitHub API secondary rate limit triggered. Please wait before retrying.'
      : 'GitHub API rate limit exceeded. Configure GitHub App credentials or retry shortly.';

    return new ServiceError(429, message, 'RATE_LIMITED', {
      rateLimited: true,
      secondary: isSecondaryRateLimit,
      remaining: rateLimit?.remaining ?? 0,
      resetAt,
      retryAfter
    });
  }

  // 2. Resource Not Found / Access Denied for Private Repositories
  if (status === 404) {
    const text = contextMessage
      ? `${contextMessage.replace(/\.+$/, '')}. Repository or file was not found or is private without App access.`
      : 'Repository or file not found or access denied.';
    return new ServiceError(404, text, 'NOT_FOUND');
  }

  // 3. Authentication Required / Expired
  if (status === 401) {
    return new ServiceError(401, 'GitHub user authentication failed or credentials expired.', 'AUTH_REQUIRED');
  }

  // 4. Insufficient Permissions (403 non-rate-limited)
  if (status === 403) {
    const text = contextMessage
      ? `${contextMessage.replace(/\.+$/, '')}. Insufficient GitHub permissions.`
      : 'GitHub API access denied or insufficient permissions.';
    return new ServiceError(403, text, 'FORBIDDEN');
  }

  // 5. Existing Resource Conflict (409)
  if (status === 409) {
    const text = contextMessage
      ? `${contextMessage.replace(/\.+$/, '')}. File conflict detected.`
      : 'Resource conflict detected.';
    return new ServiceError(409, text, 'CONFLICT');
  }

  // 6. Bad Request / Validation Failure (400)
  if (status === 400) {
    const text = contextMessage ? `${contextMessage}: ${msg || 'Invalid request.'}` : msg || 'Invalid request.';
    return new ServiceError(400, text, 'INVALID_INPUT');
  }

  // 7. Network Timeouts & Connection Failures
  if (err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND') {
    return new ServiceError(503, 'GitHub API service is temporarily unreachable. Try again shortly.', 'UPSTREAM_UNAVAILABLE', {
      cause: err?.code || err?.name
    });
  }

  // 8. Upstream Server Errors (500, 502, 503, 504)
  if (status >= 500) {
    const text = contextMessage ? `${contextMessage}: ${msg || 'Upstream GitHub API error.'}` : (msg || 'Upstream GitHub API error.');
    return new ServiceError(502, text, 'GITHUB_API_ERROR');
  }

  // Default fallback
  const fallback = contextMessage ? `${contextMessage}: ${msg || 'Unexpected error'}` : (msg || 'Unexpected error');
  return new ServiceError(status, fallback, 'SERVICE_ERROR');
}
