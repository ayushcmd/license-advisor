/**
 * Open Workers — Backend Performance, Concurrency & API Reliability Test Suite
 *
 * Verifies request-scoped GitHub API call deduplication, bounded concurrency,
 * primary/secondary rate-limit diagnostics, network timeout handling,
 * and memory/workload boundaries.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRepositoryDashboard } from '../src/core/dashboard/coordinator.js';
import { mapGitHubError, extractOctokitRateLimit } from '../src/core/github/errors.js';
import { ServiceError } from '../src/services/licenseService.js';

function createInstrumentedMockContext({ isPrivate = false, hasIssues = true, simulateDelayMs = 2 } = {}) {
  const calls = [];
  let activeConcurrent = 0;
  let peakConcurrent = 0;

  function trackCall(name, details) {
    activeConcurrent++;
    if (activeConcurrent > peakConcurrent) peakConcurrent = activeConcurrent;
    calls.push({ name, details });
    return () => {
      activeConcurrent--;
    };
  }

  const mockOctokit = {
    rest: {
      repos: {
        get: async (args) => {
          const done = trackCall('repos.get', args);
          if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
          done();
          return {
            data: {
              name: 'Perf-Repo',
              owner: { login: 'octocat' },
              full_name: 'octocat/Perf-Repo',
              default_branch: 'main',
              description: 'Repo for performance benchmark',
              language: 'JavaScript',
              archived: false,
              private: isPrivate,
              has_issues: hasIssues,
              html_url: 'https://github.com/octocat/Perf-Repo',
              updated_at: '2026-11-14T10:00:00Z',
              stargazers_count: 50,
              forks_count: 10,
              open_issues_count: hasIssues ? 3 : 0
            }
          };
        },
        getContent: async ({ path, ref }) => {
          const done = trackCall('repos.getContent', { path, ref });
          if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
          done();
          if (path === '') {
            return {
              data: [
                { name: 'README.md', path: 'README.md', type: 'file' },
                { name: 'LICENSE', path: 'LICENSE', type: 'file' },
                { name: '.github', path: '.github', type: 'dir' },
                { name: 'docs', path: 'docs', type: 'dir' }
              ]
            };
          }
          if (path === '.github') {
            return {
              data: [
                { name: 'workflows', path: '.github/workflows', type: 'dir' },
                { name: 'dependabot.yml', path: '.github/dependabot.yml', type: 'file' },
                { name: 'ISSUE_TEMPLATE', path: '.github/ISSUE_TEMPLATE', type: 'dir' },
                { name: 'PULL_REQUEST_TEMPLATE', path: '.github/PULL_REQUEST_TEMPLATE', type: 'dir' },
                { name: 'SECURITY.md', path: '.github/SECURITY.md', type: 'file' },
                { name: 'CONTRIBUTING.md', path: '.github/CONTRIBUTING.md', type: 'file' },
                { name: 'CODE_OF_CONDUCT.md', path: '.github/CODE_OF_CONDUCT.md', type: 'file' }
              ]
            };
          }
          if (path === 'docs') {
            return {
              data: [{ name: 'index.md', path: 'docs/index.md', type: 'file' }]
            };
          }
          if (path === '.github/workflows') {
            return {
              data: [
                { name: 'ci.yml', path: '.github/workflows/ci.yml', type: 'file' },
                { name: 'security.yml', path: '.github/workflows/security.yml', type: 'file' }
              ]
            };
          }
          if (path === '.github/ISSUE_TEMPLATE') {
            return {
              data: [{ name: 'bug_report.md', path: '.github/ISSUE_TEMPLATE/bug_report.md', type: 'file' }]
            };
          }
          if (path === '.github/PULL_REQUEST_TEMPLATE') {
            return {
              data: [{ name: 'pr_template.md', path: '.github/PULL_REQUEST_TEMPLATE/pr_template.md', type: 'file' }]
            };
          }
          if (path === '.github/workflows/ci.yml' || path === '.github/workflows/security.yml') {
            return {
              data: {
                content: Buffer.from('name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n').toString('base64'),
                encoding: 'base64',
                path,
                type: 'file',
                size: 150
              }
            };
          }
          if (path === 'README.md') {
            return {
              data: {
                content: Buffer.from('# Perf Repo\n\nOverview content.\n\n## License\n\nMIT\n').toString('base64'),
                encoding: 'base64',
                path: 'README.md',
                type: 'file',
                size: 80
              }
            };
          }
          const err = new Error(`Not found: ${path}`);
          err.status = 404;
          throw err;
        },
        getCollaboratorPermissionLevel: async (args) => {
          const done = trackCall('repos.getCollaboratorPermissionLevel', args);
          if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
          done();
          return { data: { permission: 'admin' } };
        }
      },
      licenses: {
        getForRepo: async (args) => {
          const done = trackCall('licenses.getForRepo', args);
          if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
          done();
          return {
            data: {
              license: {
                key: 'mit',
                name: 'MIT License',
                spdx_id: 'MIT'
              }
            }
          };
        }
      },
      issues: {
        listForRepo: async (args) => {
          const done = trackCall('issues.listForRepo', args);
          if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
          done();
          return {
            data: [
              { number: 1, title: 'Bug 1', updated_at: '2026-10-01T00:00:00Z', labels: [], pull_request: undefined }
            ]
          };
        }
      }
    }
  };

  const githubContext = {
    isAppConfigured: true,
    createPublicOctokit: () => mockOctokit,
    getPublicOctokit: () => mockOctokit,
    resolveRepoInstallation: async (owner, repo) => {
      const done = trackCall('resolveRepoInstallation', { owner, repo });
      if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
      done();
      return {
        installed: true,
        octokit: mockOctokit,
        installation: { id: 7777 }
      };
    }
  };

  const createUserClient = (token) => ({
    rest: {
      users: {
        getAuthenticated: async () => {
          const done = trackCall('users.getAuthenticated', { token });
          if (simulateDelayMs > 0) await new Promise((r) => setTimeout(r, simulateDelayMs));
          done();
          return { data: { login: 'perf-tester', type: 'User' } };
        }
      },
      repos: {
        get: async (args) => mockOctokit.rest.repos.get(args)
      }
    }
  });

  return {
    githubContext,
    createUserClient,
    getStats: () => {
      const callCounts = {};
      for (const c of calls) {
        callCounts[c.name] = (callCounts[c.name] || 0) + 1;
      }
      return {
        calls,
        totalCalls: calls.length,
        callCounts,
        peakConcurrent
      };
    }
  };
}

describe('Backend Performance & API Call Efficiency Benchmarks', () => {
  it('deduplicates public repository metadata, installation resolution, and tree calls (<= 15 calls)', async () => {
    const ctx = createInstrumentedMockContext({ isPrivate: false });
    const result = await analyzeRepositoryDashboard({
      repoInput: 'octocat/Perf-Repo',
      githubContext: ctx.githubContext,
      createUserClient: ctx.createUserClient
    });

    assert.equal(result.repository.fullName, 'octocat/Perf-Repo');
    assert.equal(result.summary.totalModules, 6);
    assert.equal(result.summary.modulesEvaluated, 6);

    const stats = ctx.getStats();

    // Verify bounded GitHub API calls
    assert.ok(stats.totalCalls <= 15, `Expected <= 15 total calls, received ${stats.totalCalls}`);
    assert.equal(stats.callCounts['resolveRepoInstallation'], 1, 'Installation resolution must occur exactly once');
    assert.equal(stats.callCounts['repos.get'], 1, 'Repository metadata inspection must occur exactly once');
    assert.equal(stats.callCounts['licenses.getForRepo'], 1, 'License inspection must occur exactly once');
    assert.equal(stats.callCounts['issues.listForRepo'], 1, 'Issue inspection must occur exactly once');
    assert.ok(stats.callCounts['repos.getContent'] <= 11, `Expected <= 11 getContent calls, received ${stats.callCounts['repos.getContent']}`);
    assert.ok(stats.peakConcurrent <= 6, `Expected peak concurrent operations <= 6, received ${stats.peakConcurrent}`);
  });

  it('deduplicates private repository authorization checks across all 6 modules', async () => {
    const ctx = createInstrumentedMockContext({ isPrivate: true });
    const result = await analyzeRepositoryDashboard({
      repoInput: 'octocat/Perf-Repo',
      authorization: 'Bearer gho_test_valid_perf_token',
      githubContext: ctx.githubContext,
      createUserClient: ctx.createUserClient
    });

    assert.equal(result.repository.fullName, 'octocat/Perf-Repo');
    assert.equal(result.repository.isPrivate, true);

    const stats = ctx.getStats();

    // Prior to optimization, private repo inspection performed 56 calls with 7 authorization rounds
    assert.ok(stats.totalCalls <= 18, `Expected <= 18 total calls for private repo, received ${stats.totalCalls}`);
    assert.equal(stats.callCounts['users.getAuthenticated'], 1, 'Caller user authentication must occur exactly once');
    assert.equal(stats.callCounts['repos.getCollaboratorPermissionLevel'], 1, 'Collaborator check must occur exactly once');
    assert.equal(stats.callCounts['repos.get'], 1, 'Metadata retrieval must occur exactly once');
  });

  it('safely handles repositories with issues disabled with 0 issue list calls', async () => {
    const ctx = createInstrumentedMockContext({ isPrivate: false, hasIssues: false });
    const result = await analyzeRepositoryDashboard({
      repoInput: 'octocat/Perf-Repo',
      githubContext: ctx.githubContext,
      createUserClient: ctx.createUserClient
    });

    assert.equal(result.modules.issues.executionStatus, 'not_supported');
    assert.equal(result.modules.issues.healthStatus, 'healthy');

    const stats = ctx.getStats();
    assert.equal(stats.callCounts['issues.listForRepo'] || 0, 0, 'No issues list call when issues are disabled');
  });
});

describe('Upstream Rate Limit, Network Timeout & Error Mapping Diagnostics', () => {
  it('detects primary rate limits and returns HTTP 429 with reset diagnostic information', () => {
    const err = new Error('API rate limit exceeded for user');
    err.status = 403;
    err.response = {
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1700000000'
      }
    };

    const mapped = mapGitHubError(err, 'Failed to inspect repository');
    assert.ok(mapped instanceof ServiceError);
    assert.equal(mapped.statusCode, 429);
    assert.equal(mapped.code, 'RATE_LIMITED');
    assert.ok(mapped.details.rateLimited);
    assert.equal(mapped.details.remaining, 0);
    assert.ok(mapped.details.resetAt);
  });

  it('detects secondary rate limits and extracts retry-after guidance', () => {
    const err = new Error('You have exceeded a secondary rate limit. Please wait a few minutes before submitting more requests.');
    err.status = 403;
    err.response = {
      headers: {
        'retry-after': '60',
        'x-ratelimit-remaining': '4500'
      }
    };

    const mapped = mapGitHubError(err);
    assert.equal(mapped.statusCode, 429);
    assert.equal(mapped.code, 'RATE_LIMITED');
    assert.equal(mapped.details.secondary, true);
    assert.equal(mapped.details.retryAfter, 60);
    assert.ok(mapped.message.includes('secondary rate limit'));
  });

  it('maps network timeouts and abort errors to HTTP 503 UPSTREAM_UNAVAILABLE', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    const mappedAbort = mapGitHubError(abortErr);
    assert.equal(mappedAbort.statusCode, 503);
    assert.equal(mappedAbort.code, 'UPSTREAM_UNAVAILABLE');

    const timeoutErr = new Error('connect ETIMEDOUT 140.82.121.3:443');
    timeoutErr.code = 'ETIMEDOUT';

    const mappedTimeout = mapGitHubError(timeoutErr);
    assert.equal(mappedTimeout.statusCode, 503);
    assert.equal(mappedTimeout.code, 'UPSTREAM_UNAVAILABLE');
  });

  it('maps HTTP 409 file conflicts accurately', () => {
    const err = new Error('A file already exists with this name');
    err.status = 409;

    const mapped = mapGitHubError(err, 'Could not create file');
    assert.equal(mapped.statusCode, 409);
    assert.equal(mapped.code, 'CONFLICT');
    assert.ok(mapped.message.includes('File conflict detected'));
  });

  it('extractOctokitRateLimit safely parses valid and missing header objects', () => {
    assert.equal(extractOctokitRateLimit(null), null);
    assert.equal(extractOctokitRateLimit({}), null);

    const parsed = extractOctokitRateLimit({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '12',
      'x-ratelimit-reset': '1700000000',
      'retry-after': '30'
    });
    assert.equal(parsed.limit, 60);
    assert.equal(parsed.remaining, 12);
    assert.equal(parsed.retryAfter, 30);
    assert.ok(parsed.resetAt.includes('T'));
  });
});
