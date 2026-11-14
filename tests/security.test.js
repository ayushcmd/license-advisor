import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  listSecurityChecks,
  listSecurityTemplates,
  generateDependabotConfig,
  generateCodeQLWorkflow,
  generateSecurityConfig
} from '../src/modules/security/engine.js';
import {
  auditSecurityRepository,
  previewSecurityPr,
  createSecurityPullRequest
} from '../src/modules/security/securityService.js';
import { createApp } from '../src/server.js';

// Mock GitHub Context factory
function createMockGitHubContext({
  permission = 'write',
  branchProtection = 'full',
  hasSecurityMd = true,
  hasDependabot = false,
  hasCodeql = false,
  hasWorkflowPermission = false,
  archived = false
} = {}) {
  const fileStore = new Map();

  if (hasSecurityMd) {
    fileStore.set('SECURITY.md', { sha: 'sec-sha-1', content: '# Security Policy' });
  }
  if (hasDependabot) {
    fileStore.set('.github/dependabot.yml', { sha: 'dep-sha-1', content: 'version: 2\nupdates: []' });
  }
  if (hasCodeql) {
    fileStore.set('.github/workflows/codeql.yml', { sha: 'codeql-sha-1', content: 'name: CodeQL\nuses: github/codeql-action/init@v3' });
  }

  const rootFiles = [
    ...(hasSecurityMd ? [{ name: 'SECURITY.md', path: 'SECURITY.md', type: 'file' }] : []),
    { name: '.github', path: '.github', type: 'dir' }
  ];

  const dotGithubFiles = [
    ...(hasDependabot ? [{ name: 'dependabot.yml', path: '.github/dependabot.yml', type: 'file' }] : []),
    { name: 'workflows', path: '.github/workflows', type: 'dir' }
  ];

  const workflowFiles = [
    ...(hasCodeql ? [{ name: 'codeql.yml', path: '.github/workflows/codeql.yml', type: 'file' }] : [])
  ];

  const createdRefs = [];
  const createdFiles = [];
  const createdPrs = [];

  const mockOctokit = {
    rest: {
      repos: {
        get: async () => ({
          data: {
            name: 'project',
            full_name: 'owner/project',
            owner: { login: 'owner' },
            html_url: 'https://github.com/owner/project',
            default_branch: 'main',
            private: false,
            archived,
            fork: false,
            security_and_analysis: {
              secret_scanning: { status: 'enabled' },
              secret_scanning_push_protection: { status: 'enabled' },
              dependabot_security_updates: { status: 'enabled' }
            }
          }
        }),
        getBranchProtection: async () => {
          if (branchProtection === 'full') {
            return {
              data: {
                required_pull_request_reviews: { required_approving_review_count: 1 },
                required_status_checks: { contexts: ['build', 'test'] }
              }
            };
          }
          if (branchProtection === 'partial') {
            return {
              data: {
                required_pull_request_reviews: { required_approving_review_count: 1 },
                required_status_checks: null
              }
            };
          }
          if (branchProtection === 'none') {
            return {
              data: {
                required_pull_request_reviews: null,
                required_status_checks: null
              }
            };
          }
          if (branchProtection === 'forbidden') {
            const err = new Error('Must have admin rights');
            err.status = 403;
            throw err;
          }
          const notFound = new Error('Branch not protected');
          notFound.status = 404;
          throw notFound;
        },
        getContent: async ({ path }) => {
          if (!path || path === '') return { data: rootFiles };
          if (path === '.github') return { data: dotGithubFiles };
          if (path === '.github/workflows') return { data: workflowFiles };

          if (fileStore.has(path)) {
            const file = fileStore.get(path);
            return {
              data: {
                type: 'file',
                name: path.split('/').pop(),
                path,
                sha: file.sha,
                content: Buffer.from(file.content).toString('base64')
              }
            };
          }
          const err = new Error(`Path ${path} not found`);
          err.status = 404;
          throw err;
        },
        createOrUpdateFileContents: async (args) => {
          createdFiles.push(args);
          fileStore.set(args.path, { sha: `new-sha-${args.path}`, content: args.content });
          return { data: { commit: { sha: `commit-sha-${args.path}` } } };
        },
        getCollaboratorPermissionLevel: async () => ({
          data: { permission }
        })
      },
      git: {
        getRef: async () => ({ data: { object: { sha: 'base-commit-sha-main' } } }),
        createRef: async (args) => {
          createdRefs.push(args);
          return { data: { ref: args.ref } };
        }
      },
      pulls: {
        list: async () => ({ data: [] }),
        create: async ({ title, head, base, body }) => {
          const pr = {
            number: 42,
            html_url: 'https://github.com/owner/project/pull/42',
            title,
            head,
            base,
            body,
            state: 'open'
          };
          createdPrs.push(pr);
          return { data: pr };
        }
      }
    }
  };

  return {
    isAppConfigured: true,
    createdRefs,
    createdFiles,
    createdPrs,
    resolveRepoInstallation: async () => ({
      installed: true,
      octokit: mockOctokit,
      installation: {
        id: 1234,
        permissions: {
          contents: 'write',
          pull_requests: 'write',
          ...(hasWorkflowPermission ? { workflows: 'write' } : {})
        }
      }
    }),
    createPublicOctokit: () => mockOctokit
  };
}

describe('Security Engine (Schemas, Templates & Generators)', () => {
  it('exposes supported checks and templates accurately', () => {
    const checks = listSecurityChecks();
    assert.ok(checks.length >= 6);
    assert.ok(checks.some((c) => c.id === 'security-policy'));
    assert.ok(checks.some((c) => c.id === 'dependabot-config'));
    assert.ok(checks.some((c) => c.id === 'codeql-analysis'));
    assert.ok(checks.some((c) => c.id === 'branch-protection'));

    const templates = listSecurityTemplates();
    assert.equal(templates.length, 2);
    assert.ok(templates.some((t) => t.id === 'dependabot'));
    assert.ok(templates.some((t) => t.id === 'codeql'));
  });

  it('generates valid, deterministic Dependabot YAML configuration', () => {
    const yaml1 = generateDependabotConfig({
      updates: [
        {
          packageEcosystem: 'npm',
          directory: '/',
          schedule: { interval: 'weekly', day: 'monday', time: '06:00', timezone: 'Etc/UTC' },
          openPullRequestsLimit: 10,
          labels: ['dependencies', 'security']
        },
        {
          packageEcosystem: 'github-actions',
          directory: '/',
          schedule: { interval: 'weekly' }
        }
      ]
    });

    const yaml2 = generateDependabotConfig({
      updates: [
        {
          packageEcosystem: 'npm',
          directory: '/',
          schedule: { interval: 'weekly', day: 'monday', time: '06:00', timezone: 'Etc/UTC' },
          openPullRequestsLimit: 10,
          labels: ['dependencies', 'security']
        },
        {
          packageEcosystem: 'github-actions',
          directory: '/',
          schedule: { interval: 'weekly' }
        }
      ]
    });

    assert.equal(yaml1, yaml2);
    assert.ok(yaml1.includes('version: 2'));
    assert.ok(yaml1.includes('package-ecosystem: "npm"'));
    assert.ok(yaml1.includes('package-ecosystem: "github-actions"'));
    assert.ok(yaml1.includes('open-pull-requests-limit: 10'));
    assert.ok(yaml1.includes('- "dependencies"'));
  });

  it('rejects unsupported ecosystems, invalid directories, and duplicate pairs in Dependabot', () => {
    assert.throws(
      () => generateDependabotConfig({ updates: [{ packageEcosystem: 'invalid-eco' }] }),
      /Unsupported package ecosystem/
    );
    assert.throws(
      () => generateDependabotConfig({ updates: [{ packageEcosystem: 'npm', directory: '/../secret' }] }),
      /clean relative path without traversal segments/
    );
    assert.throws(
      () => generateDependabotConfig({ updates: [{ packageEcosystem: 'npm', directory: 'no-leading-slash' }] }),
      /Directory path must start with "\/"/
    );
    assert.throws(
      () =>
        generateDependabotConfig({
          updates: [
            { packageEcosystem: 'npm', directory: '/' },
            { packageEcosystem: 'npm', directory: '/' }
          ]
        }),
      /Duplicate ecosystem\/directory combination/
    );
    assert.throws(
      () => generateDependabotConfig({ updates: [{ packageEcosystem: 'npm', openPullRequestsLimit: 99 }] }),
      /open-pull-requests-limit must be an integer between 1 and 50/
    );
  });

  it('generates valid, deterministic CodeQL GitHub Actions workflow', () => {
    const wf1 = generateCodeQLWorkflow({
      languages: ['javascript-typescript', 'go'],
      branches: ['main', 'develop'],
      cron: '0 6 * * 1'
    });

    const wf2 = generateCodeQLWorkflow({
      languages: ['javascript-typescript', 'go'],
      branches: ['main', 'develop'],
      cron: '0 6 * * 1'
    });

    assert.equal(wf1, wf2);
    assert.ok(wf1.includes('name: "CodeQL Analysis"'));
    assert.ok(wf1.includes('uses: actions/checkout@v4'));
    assert.ok(wf1.includes('uses: github/codeql-action/init@v3'));
    assert.ok(wf1.includes('uses: github/codeql-action/analyze@v3'));
    assert.ok(wf1.includes('language: javascript-typescript'));
    assert.ok(wf1.includes('build-mode: none'));
    assert.ok(wf1.includes('language: go'));
    assert.ok(wf1.includes('build-mode: autobuild'));
    assert.ok(wf1.includes('cron: "0 6 * * 1"'));
    assert.ok(wf1.includes('security-events: write'));
  });

  it('rejects unsupported languages in CodeQL workflow generator', () => {
    assert.throws(
      () => generateCodeQLWorkflow({ languages: ['fortran'] }),
      /Unsupported CodeQL language "fortran"/
    );
  });

  it('generateSecurityConfig dispatches by templateId and rejects unknown template', () => {
    const dep = generateSecurityConfig({ templateId: 'dependabot' });
    assert.equal(dep.filename, '.github/dependabot.yml');
    assert.ok(dep.content.includes('version: 2'));

    const codeql = generateSecurityConfig({ templateId: 'codeql' });
    assert.equal(codeql.filename, '.github/workflows/codeql.yml');
    assert.ok(codeql.content.includes('name: "CodeQL Analysis"'));

    assert.throws(() => generateSecurityConfig({ templateId: 'unknown' }), /Unknown security template/);
  });
});

describe('Repository Security Audit (auditSecurityRepository)', () => {
  it('identifies present security policy, full branch protection, and calculates score', async () => {
    const ctx = createMockGitHubContext({
      hasSecurityMd: true,
      hasDependabot: false,
      hasCodeql: false,
      branchProtection: 'full'
    });

    const report = await auditSecurityRepository({ repoInput: 'owner/project', githubContext: ctx });
    assert.equal(report.repository.fullName, 'owner/project');
    assert.ok(report.summary.healthScore > 0);

    const secCheck = report.checks.find((c) => c.id === 'security-policy');
    assert.equal(secCheck.status, 'passed');
    assert.equal(secCheck.path, 'SECURITY.md');

    const depCheck = report.checks.find((c) => c.id === 'dependabot-config');
    assert.equal(depCheck.status, 'missing');
    assert.equal(depCheck.canGenerateFix, true);

    const bpCheck = report.checks.find((c) => c.id === 'branch-protection');
    assert.equal(bpCheck.status, 'passed');

    assert.ok(report.recommendations.length > 0);
    assert.ok(report.summary.assessmentNotice.includes('hygiene'));
  });

  it('handles missing branch protection (404) as missing and forbidden (403) as not_verified', async () => {
    const notProtectedCtx = createMockGitHubContext({ branchProtection: 'missing' });
    const rep1 = await auditSecurityRepository({ repoInput: 'owner/project', githubContext: notProtectedCtx });
    const bp1 = rep1.checks.find((c) => c.id === 'branch-protection');
    assert.equal(bp1.status, 'missing');

    const forbiddenCtx = createMockGitHubContext({ branchProtection: 'forbidden' });
    const rep2 = await auditSecurityRepository({ repoInput: 'owner/project', githubContext: forbiddenCtx });
    const bp2 = rep2.checks.find((c) => c.id === 'branch-protection');
    assert.equal(bp2.status, 'not_verified');
  });

  it('detects existing Dependabot and CodeQL workflow configurations', async () => {
    const fullCtx = createMockGitHubContext({
      hasSecurityMd: true,
      hasDependabot: true,
      hasCodeql: true,
      branchProtection: 'full'
    });

    const report = await auditSecurityRepository({ repoInput: 'owner/project', githubContext: fullCtx });
    const depCheck = report.checks.find((c) => c.id === 'dependabot-config');
    assert.equal(depCheck.status, 'passed');
    assert.equal(depCheck.path, '.github/dependabot.yml');

    const codeqlCheck = report.checks.find((c) => c.id === 'codeql-analysis');
    assert.equal(codeqlCheck.status, 'passed');
    assert.equal(codeqlCheck.path, '.github/workflows/codeql.yml');
  });
});

describe('Security PR Previews & Conflicts (previewSecurityPr)', () => {
  it('detects existing files and reports conflicts when replaceExisting is false', async () => {
    const ctx = createMockGitHubContext({ hasDependabot: true });

    const preview = await previewSecurityPr({
      repoInput: 'owner/project',
      configs: [{ templateId: 'dependabot', options: {} }],
      replaceExisting: false,
      githubContext: ctx
    });

    assert.equal(preview.hasConflicts, true);
    assert.deepEqual(preview.conflicts, ['.github/dependabot.yml']);
    assert.equal(preview.canProceed, false);
    assert.equal(preview.files[0].action, 'replace');
    assert.equal(preview.files[0].exists, true);
  });

  it('allows proceeding when replaceExisting is true', async () => {
    const ctx = createMockGitHubContext({ hasDependabot: true });

    const preview = await previewSecurityPr({
      repoInput: 'owner/project',
      configs: [{ templateId: 'dependabot', options: {} }],
      replaceExisting: true,
      githubContext: ctx
    });

    assert.equal(preview.hasConflicts, false);
    assert.equal(preview.canProceed, true);
  });

  it('identifies workflow permission requirement and surfaces warning when workflows: write is missing', async () => {
    const ctxWithoutWorkflowPerm = createMockGitHubContext({ hasWorkflowPermission: false });

    const preview = await previewSecurityPr({
      repoInput: 'owner/project',
      configs: [{ templateId: 'codeql', options: {} }],
      replaceExisting: true,
      githubContext: ctxWithoutWorkflowPerm
    });

    assert.equal(preview.requiresWorkflowPermission, true);
    assert.equal(preview.hasWorkflowPermission, false);
    assert.ok(preview.workflowWarning.includes('Workflows (Read & write)'));
    assert.equal(preview.canProceed, false);
  });

  it('allows proceeding with CodeQL when installation has workflows: write permission', async () => {
    const ctxWithWorkflowPerm = createMockGitHubContext({ hasWorkflowPermission: true });

    const preview = await previewSecurityPr({
      repoInput: 'owner/project',
      configs: [{ templateId: 'codeql', options: {} }],
      replaceExisting: true,
      githubContext: ctxWithWorkflowPerm
    });

    assert.equal(preview.requiresWorkflowPermission, true);
    assert.equal(preview.hasWorkflowPermission, true);
    assert.equal(preview.workflowWarning, null);
    assert.equal(preview.canProceed, true);
  });
});

describe('Security Pull Request Creation (createSecurityPullRequest)', () => {
  it('creates dedicated branch, commits Dependabot config, and opens PR safely', async () => {
    const ctx = createMockGitHubContext({ hasDependabot: false });

    const result = await createSecurityPullRequest({
      repoInput: 'owner/project',
      configs: [{ templateId: 'dependabot', options: {} }],
      replaceExisting: false,
      githubContext: ctx
    });

    assert.equal(result.success, true);
    assert.equal(result.pullRequest.number, 42);
    assert.ok(result.branch.startsWith('chore/configure-security'));
    assert.deepEqual(result.files, ['.github/dependabot.yml']);
    assert.equal(ctx.createdRefs.length, 1);
    assert.equal(ctx.createdFiles.length, 1);
    assert.equal(ctx.createdPrs.length, 1);
    assert.ok(ctx.createdPrs[0].title.includes('Dependabot'));
  });

  it('throws 409 conflict when file exists and replaceExisting is false', async () => {
    const ctx = createMockGitHubContext({ hasDependabot: true });

    await assert.rejects(
      createSecurityPullRequest({
        repoInput: 'owner/project',
        configs: [{ templateId: 'dependabot', options: {} }],
        replaceExisting: false,
        githubContext: ctx
      }),
      (err) => err.statusCode === 409 && err.code === 'FILE_ALREADY_EXISTS'
    );
  });

  it('updates existing file with SHA when replaceExisting is true', async () => {
    const ctx = createMockGitHubContext({ hasDependabot: true });

    const result = await createSecurityPullRequest({
      repoInput: 'owner/project',
      configs: [{ templateId: 'dependabot', options: {} }],
      replaceExisting: true,
      githubContext: ctx
    });

    assert.equal(result.success, true);
    assert.equal(ctx.createdFiles[0].sha, 'dep-sha-1');
  });

  it('refuses to commit CodeQL workflow if GitHub App lacks workflows: write permission', async () => {
    const ctx = createMockGitHubContext({ hasWorkflowPermission: false });

    await assert.rejects(
      createSecurityPullRequest({
        repoInput: 'owner/project',
        configs: [{ templateId: 'codeql', options: {} }],
        replaceExisting: false,
        githubContext: ctx
      }),
      (err) => err.statusCode === 403 && err.code === 'WORKFLOW_PERMISSION_REQUIRED'
    );
  });

  it('commits CodeQL workflow when GitHub App has workflows: write permission', async () => {
    const ctx = createMockGitHubContext({ hasWorkflowPermission: true });

    const result = await createSecurityPullRequest({
      repoInput: 'owner/project',
      configs: [{ templateId: 'codeql', options: {} }],
      replaceExisting: false,
      githubContext: ctx
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.files, ['.github/workflows/codeql.yml']);
  });

  it('refuses on archived repositories', async () => {
    const ctx = createMockGitHubContext({ archived: true });

    await assert.rejects(
      createSecurityPullRequest({
        repoInput: 'owner/project',
        configs: [{ templateId: 'dependabot', options: {} }],
        githubContext: ctx
      }),
      (err) => err.statusCode === 409 && err.code === 'REPO_ARCHIVED'
    );
  });
});

describe('Security HTTP Integration Endpoints', () => {
  let server;
  let baseUrl;
  const mockCtx = createMockGitHubContext();

  const mockUserClient = (perm = 'write') => () => ({
    rest: {
      users: { getAuthenticated: async () => ({ data: { login: 'alice', type: 'User' } }) },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: perm } }) }
    }
  });

  before(async () => {
    const { app } = createApp({
      githubContext: mockCtx,
      createUserClient: mockUserClient('write'),
      silentConfig: true,
      logger: { info() {}, warn() {}, error() {} }
    });
    server = await new Promise((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    if (server) server.close();
  });

  it('GET /api/security/checks returns supported checks', async () => {
    const res = await fetch(`${baseUrl}/api/security/checks`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.checks));
    assert.ok(json.checks.length >= 6);
  });

  it('GET /api/security/templates returns supported templates', async () => {
    const res = await fetch(`${baseUrl}/api/security/templates`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.templates));
    assert.equal(json.templates.length, 2);
  });

  it('POST /api/security/generate returns generated configuration YAML', async () => {
    const res = await fetch(`${baseUrl}/api/security/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'dependabot' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.templateId, 'dependabot');
    assert.ok(json.content.includes('version: 2'));
  });

  it('POST /api/security/analyze audits repository configuration', async () => {
    const res = await fetch(`${baseUrl}/api/security/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.repository.fullName, 'owner/project');
    assert.ok(Array.isArray(json.checks));
  });

  it('POST /api/security/preview-pr checks proposed files and conflicts', async () => {
    const res = await fetch(`${baseUrl}/api/security/preview-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'owner/project',
        configs: [{ templateId: 'dependabot' }],
        replaceExisting: false
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.repository.fullName, 'owner/project');
    assert.ok(Array.isArray(json.files));
  });

  it('POST /api/security/trigger-pr rejects requests without authorization token (401)', async () => {
    const res = await fetch(`${baseUrl}/api/security/trigger-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'owner/project',
        configs: [{ templateId: 'dependabot' }]
      })
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/security/trigger-pr creates PR for authorized caller (201)', async () => {
    const res = await fetch(`${baseUrl}/api/security/trigger-pr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_user_token'
      },
      body: JSON.stringify({
        repo: 'owner/project',
        configs: [{ templateId: 'dependabot' }]
      })
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.pullRequest.number, 42);
  });
});
