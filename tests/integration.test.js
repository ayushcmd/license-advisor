/**
 * Platform Integration, Private Repo Authorization & Endpoint Verification Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { authorizeRepositoryRead } from '../src/core/github/authorize.js';
import { ServiceError } from '../src/services/licenseService.js';
import { handleIssueEvent } from '../src/modules/issues/automationService.js';

describe('Private Repository Read Authorization (authorizeRepositoryRead)', () => {
  const createUserClient = (type = 'User', permission = 'read') => () => ({
    rest: {
      users: {
        getAuthenticated: async () => ({
          data: { login: 'octocat', type }
        })
      },
      repos: {
        get: async () => ({
          data: { name: 'private-repo', full_name: 'owner/private-repo', private: true }
        }),
        getCollaboratorPermissionLevel: async () => ({
          data: { permission }
        })
      }
    }
  });

  const githubContextWithPerm = (permission = 'read') => ({
    resolveRepoInstallation: async () => ({
      installed: true,
      octokit: {
        rest: {
          repos: {
            getCollaboratorPermissionLevel: async () => ({ data: { permission } })
          }
        }
      }
    })
  });

  it('rejects calls without an authorization token (401)', async () => {
    await assert.rejects(
      async () => {
        await authorizeRepositoryRead({
          authorization: null,
          repoInput: 'owner/private-repo'
        });
      },
      (err) => err instanceof ServiceError && err.statusCode === 401 && err.code === 'AUTH_REQUIRED'
    );
  });

  it('rejects bot user tokens (403)', async () => {
    await assert.rejects(
      async () => {
        await authorizeRepositoryRead({
          authorization: 'Bearer valid_token',
          repoInput: 'owner/private-repo',
          createUserClient: createUserClient('Bot')
        });
      },
      (err) => err instanceof ServiceError && err.statusCode === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('allows read, triage, write, admin, and maintain collaborator permissions', async () => {
    for (const permission of ['read', 'triage', 'write', 'admin', 'maintain']) {
      const res = await authorizeRepositoryRead({
        authorization: 'Bearer valid_token',
        repoInput: 'owner/private-repo',
        githubContext: githubContextWithPerm(permission),
        createUserClient: createUserClient('User', permission)
      });
      assert.equal(res.login, 'octocat');
      assert.equal(res.permission, permission);
    }
  });

  it('rejects collaborator with "none" or unauthorized permissions (403)', async () => {
    for (const permission of ['none', 'custom_unauthorized']) {
      await assert.rejects(
        async () => {
          await authorizeRepositoryRead({
            authorization: 'Bearer valid_token',
            repoInput: 'owner/private-repo',
            githubContext: githubContextWithPerm(permission),
            createUserClient: createUserClient('User', permission)
          });
        },
        (err) => err instanceof ServiceError && err.statusCode === 403 && err.code === 'FORBIDDEN'
      );
    }
  });
});

describe('HTTP Endpoints — License Catalog & Private Repo Read Guards', () => {
  const privateOctokit = {
    rest: {
      repos: {
        get: async () => ({
          data: {
            name: 'secret-repo',
            owner: { login: 'owner' },
            full_name: 'owner/secret-repo',
            private: true,
            default_branch: 'main'
          }
        }),
        getContent: async () => ({ data: [] }),
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'none' } })
      },
      licenses: {
        getForRepo: async () => null
      },
      issues: {
        listForRepo: async () => ({ data: [] })
      }
    }
  };

  const mockGithubContext = {
    isAppConfigured: true,
    createPublicOctokit: () => privateOctokit,
    getPublicOctokit: () => privateOctokit,
    resolveRepoInstallation: async () => ({
      installed: true,
      octokit: privateOctokit,
      installation: { id: 999 }
    })
  };

  it('GET /api/licenses returns 200 with full license catalog', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://localhost:${port}/api/licenses`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.licenses));
      assert.ok(data.total > 0);
      assert.equal(data.licenses.length, data.total);
    } finally {
      server.close();
    }
  });

  it('GET /api/licenses/:id returns individual license details or 404', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const mitRes = await fetch(`http://localhost:${port}/api/licenses/mit`);
      assert.equal(mitRes.status, 200);
      const mitData = await mitRes.json();
      assert.equal(mitData.id, 'MIT');
      assert.equal(mitData.shortName, 'MIT');
      assert.equal(mitData.name, 'MIT License');

      const notFoundRes = await fetch(`http://localhost:${port}/api/licenses/non-existent-xyz`);
      assert.equal(notFoundRes.status, 404);
      const notFoundData = await notFoundRes.json();
      assert.equal(notFoundData.code, 'LICENSE_NOT_FOUND');
    } finally {
      server.close();
    }
  });

  it('POST /api/analyze rejects unauthenticated inspection of private repositories (401)', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://localhost:${port}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'owner/secret-repo' })
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.code, 'AUTH_REQUIRED');
    } finally {
      server.close();
    }
  });

  it('POST /api/community/audit rejects unauthenticated inspection of private repositories (401)', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://localhost:${port}/api/community/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'owner/secret-repo' })
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.code, 'AUTH_REQUIRED');
    } finally {
      server.close();
    }
  });

  it('POST /api/security/audit rejects unauthenticated inspection of private repositories (401)', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://localhost:${port}/api/security/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'owner/secret-repo' })
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.code, 'AUTH_REQUIRED');
    } finally {
      server.close();
    }
  });

  it('POST /api/documentation/audit rejects unauthenticated inspection of private repositories (401)', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://localhost:${port}/api/documentation/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'owner/secret-repo' })
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.code, 'AUTH_REQUIRED');
    } finally {
      server.close();
    }
  });

  it('POST /api/automation/audit rejects unauthenticated inspection of private repositories (401)', async () => {
    const { app } = createApp({ githubContext: mockGithubContext });
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://localhost:${port}/api/automation/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'owner/secret-repo' })
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.code, 'AUTH_REQUIRED');
    } finally {
      server.close();
    }
  });
});

describe('Webhook Delivery Idempotency — Label De-duplication', () => {
  it('skips label mutation when suggested labels already exist on the issue', async () => {
    let addLabelsCalled = false;
    const configJson = JSON.stringify({
      enabled: true,
      issues: {
        labeling: { enabled: true }
      }
    });

    const mockOctokit = {
      rest: {
        repos: {
          getContent: async () => ({
            data: {
              content: Buffer.from(configJson).toString('base64')
            }
          })
        },
        issues: {
          addLabels: async () => {
            addLabelsCalled = true;
            return { data: [{ name: 'bug' }] };
          }
        }
      }
    };

    const mockContext = {
      githubContext: {
        getInstallationOctokit: async () => mockOctokit
      }
    };

    // Issue title clearly indicates a bug ticket, but labels already contains 'bug'
    const payload = {
      action: 'opened',
      repository: {
        name: 'test-repo',
        full_name: 'owner/test-repo',
        owner: { login: 'owner' },
        default_branch: 'main'
      },
      installation: { id: 123 },
      sender: { login: 'developer', type: 'User' },
      issue: {
        number: 42,
        title: 'Fix application crash on startup (bug report)',
        body: 'Steps to reproduce the crash bug in production...',
        labels: [{ name: 'bug' }, { name: 'needs-triage' }],
        user: { login: 'developer', type: 'User' }
      }
    };

    const result = await handleIssueEvent(payload, mockContext);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'LABELS_ALREADY_PRESENT');
    assert.equal(addLabelsCalled, false);
  });
});
