import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LICENSE_CATALOG } from '../public/js/catalog-data.js';

import { createApp } from '../src/server.js';
import {
  ServiceError,
  analyzeRepositoryServer,
  validatePrRequest,
  validateRecommendationRequest
} from '../src/services/licenseService.js';
import {
  buildPullRequestBody,
  createLicensePullRequest,
  formatLicenseBranchName
} from '../src/services/prService.js';

function createMockInstallationOctokit(overrides = {}) {
  const calls = {
    getContent: [],
    createRef: [],
    createOrUpdateFileContents: [],
    pullsCreate: []
  };

  const octokit = {
    rest: {
      repos: {
        getReadme: async (params) => {
          if (overrides.onReadReadme) return overrides.onReadReadme(params);
          return { data: { type: 'file', path: 'README.md', sha: 'readme-sha', encoding: 'base64', content: Buffer.from('# Demo\n\nOriginal content.\n').toString('base64') } };
        },
        get: async () => ({
          data: {
            full_name: 'ayushcmd/demo-app',
            name: 'demo-app',
            owner: { login: 'ayushcmd' },
            default_branch: 'main',
            html_url: 'https://github.com/ayushcmd/demo-app',
            private: false,
            archived: false,
            fork: false,
            stargazers_count: 10,
            ...(overrides.repoData || {})
          },
          headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' }
        }),
        getContent: async (params) => {
          calls.getContent.push(params);
          if (params.path) {
            if (overrides.onReadFile) return overrides.onReadFile(params);
            return { data: { type: 'file', sha: 'existing-license-sha', path: params.path } };
          }
          return {
            data: overrides.rootEntries ?? [{ type: 'file', name: 'README.md', path: 'README.md' }],
            headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4989' }
          };
        },
        createOrUpdateFileContents: async (params) => {
          calls.createOrUpdateFileContents.push(params);
          if (overrides.onCreateFile) return overrides.onCreateFile(params);
          return { data: { commit: { sha: 'commit-sha-license-123' } } };
        }
      },
      licenses: {
        getForRepo: async () => {
          if (overrides.existingLicense) return { data: overrides.existingLicense };
          const err = new Error('Not Found');
          err.status = 404;
          throw err;
        }
      },
      git: {
        getRef: async ({ ref }) => {
          if (overrides.onGetRef) return overrides.onGetRef(ref);
          return { data: { object: { sha: 'base-sha-main-999' } } };
        },
        createRef: async (params) => {
          calls.createRef.push(params);
          if (overrides.onCreateRef) return overrides.onCreateRef(params);
          return { data: { ref: params.ref } };
        }
      },
      pulls: {
        list: async () => ({ data: overrides.openPulls || [] }),
        create: async (params) => {
          calls.pullsCreate.push(params);
          if (overrides.onCreatePull) return overrides.onCreatePull(params);
          return {
            data: {
              number: 17,
              html_url: 'https://github.com/ayushcmd/demo-app/pull/17',
              title: params.title
            }
          };
        }
      }
    }
  };

  return { octokit, calls };
}

function createMockGitHubContext({ installed = true, permissions, octokit, publicOctokit } = {}) {
  return {
    appId: '12345',
    appSlug: 'license-advisor',
    webhookSecret: 'secret',
    isAppConfigured: true,
    isWebhookConfigured: true,
    getInstallationUrl: () => 'https://github.com/apps/license-advisor/installations/new',
    async resolveRepoInstallation() {
      if (!installed) {
        return { installed: false, installation: null, octokit: null };
      }
      return {
        installed: true,
        installation: {
          id: 777,
          permissions: permissions || { metadata: 'read', contents: 'write', pull_requests: 'write' }
        },
        octokit
      };
    },
    createPublicOctokit() {
      return publicOctokit || octokit;
    }
  };
}

describe('Backend License Validation Service', () => {
  it('validates recommendation and PR inputs cleanly', () => {
    assert.throws(() => validateRecommendationRequest([]), ServiceError);
    const rec = validateRecommendationRequest({
      copyleftPreference: 'permissive',
      patentProtection: 'required'
    });
    assert.equal(rec.topRecommendation?.id, 'Apache-2.0');

    assert.throws(
      () => validatePrRequest({ repo: 'invalid', licenseId: 'MIT', year: '2026', holder: 'ayushcmd' }),
      (err) => err instanceof ServiceError && err.statusCode === 400 && err.code === 'INVALID_REPO'
    );

    assert.throws(
      () => validatePrRequest({ repo: 'ayushcmd/demo', licenseId: 'NOT-REAL', year: '2026', holder: 'ayushcmd' }),
      (err) => err instanceof ServiceError && err.statusCode === 400 && err.code === 'INVALID_LICENSE'
    );

    assert.throws(
      () => validatePrRequest({ repo: 'ayushcmd/demo', licenseId: 'MIT', year: '2026', holder: '' }),
      (err) => err instanceof ServiceError && err.statusCode === 400 && err.code === 'INVALID_TEMPLATE_OPTIONS'
    );
  });

  it('analyzes App-installed private repositories and falls back to public API when uninstalled', async () => {
    const { octokit: privateClient } = createMockInstallationOctokit({
      repoData: { private: true, visibility: 'private' }
    });
    const installedCtx = createMockGitHubContext({ installed: true, octokit: privateClient });

    const privateReport = await analyzeRepositoryServer({
      repoInput: 'ayushcmd/demo-app',
      githubContext: installedCtx
    });
    assert.equal(privateReport.analysisSource, 'github-app-installation');
    assert.equal(privateReport.appInstalled, true);
    assert.equal(privateReport.repository.private, true);
    assert.equal(privateReport.licenseStatus, 'unlicensed');

    const { octokit: publicClient } = createMockInstallationOctokit({
      rootEntries: [{ type: 'file', name: 'LICENSE', path: 'LICENSE' }],
      existingLicense: { path: 'LICENSE', license: { spdx_id: 'MIT', name: 'MIT License' } }
    });
    const uninstalledCtx = createMockGitHubContext({
      installed: false,
      publicOctokit: publicClient
    });

    const publicReport = await analyzeRepositoryServer({
      repoInput: 'ayushcmd/demo-app',
      githubContext: uninstalledCtx
    });
    assert.equal(publicReport.analysisSource, 'public-api');
    assert.equal(publicReport.appInstalled, false);
    assert.equal(publicReport.licenseStatus, 'licensed');
    assert.equal(publicReport.detectedLicense.catalogId, 'MIT');
  });
});

describe('Automated Pull Request Service (prService.js)', () => {
  it('adds README mentions on the same PR branch for every placement', async () => {
    for (const readmePlacement of ['top', 'bottom', 'both']) {
      const { octokit, calls } = createMockInstallationOctokit({
        onReadReadme: async (params) => {
          assert.equal(params.ref, 'base-sha-main-999');
          return { data: { type: 'file', path: 'docs/Readme.md', sha: 'readme-sha', encoding: 'base64', content: Buffer.from('# Demo\n').toString('base64') } };
        }
      });
      await createLicensePullRequest({ repo: 'ayushcmd/demo-app', licenseId: 'Apache-2.0', holder: 'XYZ', readmePlacement, githubContext: createMockGitHubContext({ octokit }) });
      assert.equal(calls.createOrUpdateFileContents.length, 2);
      const [license, readme] = calls.createOrUpdateFileContents;
      assert.equal(readme.branch, license.branch);
      assert.equal(readme.path, 'docs/Readme.md');
      assert.equal(readme.sha, 'readme-sha');
      const text = Buffer.from(readme.content, 'base64').toString('utf8');
      assert.ok(text.includes('# Demo\n'));
      assert.ok(text.includes('(../LICENSE)'));
      assert.equal(text.includes('img.shields.io'), readmePlacement !== 'bottom');
      assert.equal(text.includes('## License'), readmePlacement !== 'top');
      assert.match(calls.pullsCreate[0].body, /docs\/Readme.md/);
    }
  });

  it('creates a missing README and does not open a PR if its write fails', async () => {
    const { octokit, calls } = createMockInstallationOctokit({
      onReadReadme: async () => { const err = new Error('Missing'); err.status = 404; throw err; },
      onCreateFile: async (params) => {
        if (params.path === 'README.md') { assert.equal(params.sha, undefined); throw new Error('Write failed'); }
        return { data: { commit: { sha: 'license-commit' } } };
      }
    });
    await assert.rejects(createLicensePullRequest({ repo: 'ayushcmd/demo-app', licenseId: 'MIT', holder: 'XYZ', readmePlacement: 'bottom', githubContext: createMockGitHubContext({ octokit }) }), (err) => err.code === 'README_WRITE_FAILED');
    assert.equal(calls.pullsCreate.length, 0);
  });

  it('rejects unsupported or unreadable READMEs before creating a branch', async () => {
    for (const onReadReadme of [
      async () => ({ data: { path: 'README.rst', type: 'file' } }),
      async () => { throw new Error('Network failure'); }
    ]) {
      const { octokit, calls } = createMockInstallationOctokit({ onReadReadme });
      await assert.rejects(createLicensePullRequest({ repo: 'ayushcmd/demo-app', licenseId: 'MIT', holder: 'XYZ', readmePlacement: 'both', githubContext: createMockGitHubContext({ octokit }) }), (err) => ['UNSUPPORTED_README', 'README_READ_FAILED'].includes(err.code));
      assert.equal(calls.createRef.length, 0);
    }
    await assert.rejects(createLicensePullRequest({ readmePlacement: 'bad' }), (err) => err.code === 'INVALID_INPUT');
  });
  it('replaces an existing MIT license with Apache in place on a separate branch', async () => {
    for (const path of ['LICENSE', 'LICENSE.md', 'COPYING']) {
      const { octokit, calls } = createMockInstallationOctokit({
        rootEntries: [{ type: 'file', name: path, path }],
        existingLicense: { path, license: { spdx_id: 'MIT' } }
      });
      const result = await createLicensePullRequest({
        repo: 'ayushcmd/demo-app', licenseId: 'Apache-2.0', year: '2026', holder: 'XYZ',
        replaceExisting: true, githubContext: createMockGitHubContext({ octokit })
      });
      assert.equal(result.branch, 'chore/replace-license-apache-2.0');
      assert.equal(calls.createRef[0].sha, 'base-sha-main-999');
      assert.ok(calls.getContent.every((call) => call.ref === 'base-sha-main-999'));
      const commit = calls.createOrUpdateFileContents[0];
      assert.equal(commit.path, path);
      assert.equal(commit.sha, 'existing-license-sha');
      assert.equal(commit.branch, result.branch);
      assert.match(Buffer.from(commit.content, 'base64').toString('utf8'), /Copyright 2026 XYZ/);
      assert.equal(calls.pullsCreate[0].base, 'main');
      assert.match(calls.pullsCreate[0].body, /replaces the existing license/);
      assert.ok(calls.pullsCreate[0].body.includes(path));
    }
  });

  it('rejects ambiguous, missing, or unreadable replacement targets before creating a branch', async () => {
    for (const [overrides, code] of [
      [{}, 'LICENSE_NOT_FOUND'],
      [{ rootEntries: ['LICENSE', 'COPYING'].map((name) => ({ type: 'file', name })) }, 'MULTIPLE_LICENSE_FILES'],
      [{ existingLicense: { path: 'LICENSE' }, onReadFile: async () => ({ data: { type: 'symlink' } }) }, 'INVALID_LICENSE_FILE'],
      [{ existingLicense: { path: 'LICENSE' }, onReadFile: async () => { throw new Error('Unavailable'); } }, 'GITHUB_API_ERROR']
    ]) {
      const { octokit, calls } = createMockInstallationOctokit(overrides);
      await assert.rejects(createLicensePullRequest({
        repo: 'ayushcmd/demo-app', licenseId: 'Apache-2.0', holder: 'XYZ', replaceExisting: true,
        githubContext: createMockGitHubContext({ octokit })
      }), (err) => err.code === code);
      assert.equal(calls.createRef.length, 0);
      assert.equal(calls.createOrUpdateFileContents.length, 0);
    }
    await assert.rejects(createLicensePullRequest({ replaceExisting: 'true' }), (err) => err.code === 'INVALID_INPUT');
  });

  it('commits personalized license content for every supported license', async () => {
    for (const license of LICENSE_CATALOG) {
      const { octokit, calls } = createMockInstallationOctokit();
      await createLicensePullRequest({
        repo: 'ayushcmd/demo-app',
        licenseId: license.id,
        year: '2026',
        holder: 'XYZ',
        githubContext: createMockGitHubContext({ octokit })
      });
      const content = Buffer.from(calls.createOrUpdateFileContents[0].content, 'base64').toString('utf8');
      if (license.id === 'Unlicense') {
        assert.equal(content, license.licenseText);
      } else {
        assert.match(content, /Copyright[^\n]*2026\s+XYZ/, license.id);
        assert.doesNotMatch(content, /<year>|\[yyyy\]|name of author|name of copyright owner/, license.id);
      }
    }
  });

  it('formats feature branch names and builds detailed explanatory PR descriptions', () => {
    assert.equal(formatLicenseBranchName('MIT'), 'chore/add-license-mit');
    assert.equal(formatLicenseBranchName('GPL-3.0-only'), 'chore/add-license-gpl-3.0-only');

    const validated = validatePrRequest({
      repo: 'ayushcmd/demo-app',
      licenseId: 'Apache-2.0',
      year: '2026',
      holder: 'ayushcmd'
    });
    const body = buildPullRequestBody({
      explanation: validated.explanation,
      licensePackage: validated.licensePackage,
      defaultBranch: 'main'
    });
    assert.ok(body.includes('Apache License 2.0'));
    assert.ok(body.includes('### Permissions'));
    assert.ok(body.includes('### Conditions'));
    assert.ok(body.includes('### Limitations'));
    assert.ok(body.includes('https://spdx.org/licenses/Apache-2.0.html'));
  });

  it('creates feature branch, commits generated LICENSE without touching default branch, and opens PR', async () => {
    const { octokit, calls } = createMockInstallationOctokit();
    const githubContext = createMockGitHubContext({ installed: true, octokit });

    const result = await createLicensePullRequest({
      repo: 'ayushcmd/demo-app',
      licenseId: 'MIT',
      year: '2026',
      holder: 'ayushcmd',
      githubContext
    });

    assert.equal(result.ok, true);
    assert.equal(result.branch, 'chore/add-license-mit');
    assert.equal(result.baseBranch, 'main');
    assert.equal(result.pullNumber, 17);
    assert.equal(result.pullUrl, 'https://github.com/ayushcmd/demo-app/pull/17');

    assert.equal(calls.createRef.length, 1);
    assert.equal(calls.createRef[0].ref, 'refs/heads/chore/add-license-mit');
    assert.equal(calls.createRef[0].sha, 'base-sha-main-999');

    assert.equal(calls.createOrUpdateFileContents.length, 1);
    assert.equal(calls.createOrUpdateFileContents[0].branch, 'chore/add-license-mit');
    assert.notEqual(calls.createOrUpdateFileContents[0].branch, 'main');
    assert.equal(calls.createOrUpdateFileContents[0].path, 'LICENSE');

    const decoded = Buffer.from(calls.createOrUpdateFileContents[0].content, 'base64').toString('utf8');
    assert.ok(decoded.includes('Copyright (c) 2026 ayushcmd'));

    assert.equal(calls.pullsCreate.length, 1);
    assert.equal(calls.pullsCreate[0].head, 'chore/add-license-mit');
    assert.equal(calls.pullsCreate[0].base, 'main');
    assert.ok(calls.pullsCreate[0].body.includes('MIT License'));
  });

  it('refuses with 409 Conflict when LICENSE or LICENSE.md already exists on default branch', async () => {
    const { octokit, calls } = createMockInstallationOctokit({
      rootEntries: [
        { type: 'file', name: 'README.md', path: 'README.md' },
        { type: 'file', name: 'LICENSE.md', path: 'LICENSE.md' }
      ]
    });
    const githubContext = createMockGitHubContext({ installed: true, octokit });

    await assert.rejects(
      () =>
        createLicensePullRequest({
          repo: 'ayushcmd/demo-app',
          licenseId: 'MIT',
          year: '2026',
          holder: 'ayushcmd',
          githubContext
        }),
      (err) => err instanceof ServiceError && err.statusCode === 409 && err.code === 'LICENSE_EXISTS'
    );

    assert.equal(calls.createRef.length, 0);
    assert.equal(calls.createOrUpdateFileContents.length, 0);
    assert.equal(calls.pullsCreate.length, 0);
  });

  it('handles missing App installation, unconfigured App, and insufficient permissions gracefully', async () => {
    await assert.rejects(
      () =>
        createLicensePullRequest({
          repo: 'ayushcmd/demo-app',
          licenseId: 'MIT',
          year: '2026',
          holder: 'ayushcmd',
          githubContext: { isAppConfigured: false }
        }),
      (err) => err instanceof ServiceError && err.statusCode === 503 && err.code === 'APP_NOT_CONFIGURED'
    );

    const notInstalledCtx = createMockGitHubContext({ installed: false });
    await assert.rejects(
      () =>
        createLicensePullRequest({
          repo: 'ayushcmd/demo-app',
          licenseId: 'MIT',
          year: '2026',
          holder: 'ayushcmd',
          githubContext: notInstalledCtx
        }),
      (err) => err instanceof ServiceError && err.statusCode === 404 && err.code === 'APP_NOT_INSTALLED'
    );

    const { octokit, calls } = createMockInstallationOctokit();
    const readOnlyCtx = createMockGitHubContext({
      installed: true,
      permissions: { metadata: 'read', contents: 'read', pull_requests: 'write' },
      octokit
    });
    await assert.rejects(
      () =>
        createLicensePullRequest({
          repo: 'ayushcmd/demo-app',
          licenseId: 'MIT',
          year: '2026',
          holder: 'ayushcmd',
          githubContext: readOnlyCtx
        }),
      (err) => err instanceof ServiceError && err.statusCode === 403 && err.code === 'INSUFFICIENT_PERMISSIONS'
    );
    assert.equal(calls.createRef.length, 0);
  });

  it('rejects duplicate open PRs cleanly and falls back to unique branch for orphaned branches', async () => {
    const duplicateBranchErr = Object.assign(new Error('Reference already exists'), { status: 422 });
    const { octokit: openPrOctokit } = createMockInstallationOctokit({
      onCreateRef: async () => {
        throw duplicateBranchErr;
      },
      openPulls: [{ number: 5, html_url: 'https://github.com/ayushcmd/demo-app/pull/5' }]
    });

    await assert.rejects(
      () =>
        createLicensePullRequest({
          repo: 'ayushcmd/demo-app',
          licenseId: 'MIT',
          year: '2026',
          holder: 'ayushcmd',
          githubContext: createMockGitHubContext({ installed: true, octokit: openPrOctokit })
        }),
      (err) => err instanceof ServiceError && err.statusCode === 409 && err.code === 'PR_ALREADY_EXISTS'
    );

    let attempt = 0;
    const { octokit: orphanOctokit, calls } = createMockInstallationOctokit({
      onCreateRef: async (params) => {
        attempt += 1;
        if (attempt === 1) throw duplicateBranchErr;
        return { data: { ref: params.ref } };
      },
      openPulls: []
    });

    const recovered = await createLicensePullRequest({
      repo: 'ayushcmd/demo-app',
      licenseId: 'MIT',
      year: '2026',
      holder: 'ayushcmd',
      githubContext: createMockGitHubContext({ installed: true, octokit: orphanOctokit })
    });
    assert.equal(recovered.ok, true);
    assert.match(recovered.branch, /^chore\/add-license-mit-/);
    assert.equal(calls.createOrUpdateFileContents[0].branch, recovered.branch);
  });
});

describe('HTTP Integration: POST /api/analyze & POST /api/trigger-pr', () => {
  let activeServer = null;

  afterEach(async () => {
    if (activeServer) {
      await new Promise((resolve) => activeServer.close(resolve));
      activeServer = null;
    }
  });

  it('requires explicit replacement opt-in over HTTP and forwards it to the service', async () => {
    const { octokit, calls } = createMockInstallationOctokit({ existingLicense: { path: 'LICENSE.md', license: { spdx_id: 'MIT' } } });
    const { app } = createApp({
      silentConfig: true, githubContext: createMockGitHubContext({ octokit }),
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });
    activeServer = await new Promise((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const url = `http://127.0.0.1:${activeServer.address().port}/api/trigger-pr`;
    const payload = { repo: 'ayushcmd/demo-app', licenseId: 'Apache-2.0', year: '2026', holder: 'XYZ' };
    const send = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await send(payload)).status, 409);
    assert.equal(calls.createRef.length, 0);
    assert.equal((await send({ ...payload, replaceExisting: 'true' })).status, 400);
    const response = await send({ ...payload, replaceExisting: true, readmePlacement: 'both' });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).branch, 'chore/replace-license-apache-2.0');
    assert.equal(calls.createOrUpdateFileContents[0].path, 'LICENSE.md');
    const readme = calls.createOrUpdateFileContents[1];
    assert.equal(readme.path, 'README.md');
    assert.match(Buffer.from(readme.content, 'base64').toString('utf8'), /\]\(LICENSE.md\)/);
  });

  it('executes /api/analyze and /api/trigger-pr end-to-end over HTTP with accurate status codes', async () => {
    const { octokit } = createMockInstallationOctokit();
    const githubContext = createMockGitHubContext({ installed: true, octokit });
    const { app } = createApp({
      silentConfig: true,
      githubContext,
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    activeServer = await new Promise((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const baseUrl = `http://127.0.0.1:${activeServer.address().port}`;

    // 1. Analyze repo
    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'ayushcmd/demo-app' })
    });
    assert.equal(analyzeRes.status, 200);
    const report = await analyzeRes.json();
    assert.equal(report.licenseStatus, 'unlicensed');
    assert.equal(report.appInstalled, true);

    // 2. Trigger automated PR
    const prRes = await fetch(`${baseUrl}/api/trigger-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'https://github.com/ayushcmd/demo-app',
        licenseId: 'MIT',
        year: '2026',
        holder: 'ayushcmd'
      })
    });
    assert.equal(prRes.status, 201);
    const prPayload = await prRes.json();
    assert.equal(prPayload.ok, true);
    assert.equal(prPayload.pullNumber, 17);
    assert.equal(prPayload.branch, 'chore/add-license-mit');

    // 3. Invalid request body returns HTTP 400
    const badRes = await fetch(`${baseUrl}/api/trigger-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'ayushcmd/demo-app', licenseId: 'MIT', year: '2026', holder: '' })
    });
    assert.equal(badRes.status, 400);
  });
});

