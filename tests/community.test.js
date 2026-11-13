import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDocument, listTemplates } from '../src/modules/community/engine.js';
import {
  auditCommunityRepository,
  previewCommunityPr,
  createCommunityPullRequest
} from '../src/modules/community/communityService.js';
import { CAPABILITIES, getCapability } from '../src/core/capabilities/registry.js';
import { authorizeRepositoryWrite } from '../src/core/github/authorize.js';
import { commitFiles } from '../src/core/pullRequests/files.js';
import { createApp } from '../src/server.js';

const valid = {
  contributing: { projectName: 'Example', setup: 'Run the documented setup.', testing: 'Run project tests.' },
  'code-of-conduct': { communityName: 'Example', enforcementContact: 'team@example.org' },
  security: { projectName: 'Example', supportedVersions: '1.x', reportingContact: 'security@example.org' },
  support: { projectName: 'Example', documentationUrl: 'https://example.org/docs' }
};

test('registry has unique capabilities and only implemented routes', () => {
  assert.equal(new Set(CAPABILITIES.map((item) => item.id)).size, 6);
  assert.equal(getCapability('missing'), null);
  for (const item of CAPABILITIES) {
    assert.ok(item.name && item.description && item.category);
    assert.equal(Boolean(item.routes.page), item.status === 'available');
    if (item.status === 'upcoming') assert.deepEqual(item.operations, []);
  }
});

for (const [templateId, options] of Object.entries(valid)) {
  test(`${templateId} generates deterministic Markdown with the correct filename`, () => {
    const result = generateDocument({ templateId, options });
    assert.deepEqual(result, generateDocument({ templateId, options }));
    assert.equal(result.filename, listTemplates().find((item) => item.id === templateId).filename);
    assert.ok(result.content.startsWith('# '));
    assert.ok(!result.content.includes('INSERT CONTACT'));
  });
}

test('conduct keeps full covenant attribution and enforcement, and requires a contact', () => {
  const result = generateDocument({ templateId: 'code-of-conduct', options: valid['code-of-conduct'] });
  assert.match(result.content, /version 3.0/);
  assert.match(result.content, /permanent ban/i);
  assert.match(result.content, /team@example/);
  assert.throws(() => generateDocument({ templateId: 'code-of-conduct', options: { communityName: 'Example' } }), /contact.*required/i);
});

test('security encourages private reports without invented response commitments', () => {
  const { content } = generateDocument({ templateId: 'security', options: valid.security });
  assert.match(content, /Do not disclose vulnerabilities in public issues/);
  assert.ok(!content.includes('Response Policy'));
  assert.ok(!content.includes('48 hours'));
});

test('escapes Markdown and HTML, preserving plain multiline instructions', () => {
  const { content } = generateDocument({ templateId: 'contributing', options: { projectName: '<script>*x*</script>', setup: '# bad\n[click](javascript:evil)' } });
  assert.ok(!content.includes('<script>'));
  assert.ok(content.includes('\\*x\\*'));
  assert.ok(content.includes('\\# bad\n\\[click\\]'));
});

test('rejects invalid schemas, unknown fields, oversized text and unsafe URLs', () => {
  for (const input of [null, [], {}, { templateId: 'unknown' }, { templateId: 'support', options: [] }, { templateId: 'support', options: { projectName: 5 } }, { templateId: 'support', options: { projectName: 'x'.repeat(501) } }, { templateId: 'support', options: { projectName: 'x', unexpected: 'y' } }]) {
    assert.throws(() => generateDocument(input), (error) => error.statusCode === 400);
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.org', 'https://example.org/<img>', 'not a url']) {
    assert.throws(() => generateDocument({ templateId: 'support', options: { projectName: 'x', documentationUrl: url } }), /URL/);
  }
});

// Phase 3: Issue and PR template generator tests
test('issue templates generate valid YAML front matter and Markdown under .github/ISSUE_TEMPLATE/', () => {
  const bugResult = generateDocument({
    templateId: 'issue-bug-report',
    options: {
      issueTitle: '[BUG] ',
      about: 'Report an issue',
      description: 'Something broke.',
      reproductionSteps: 'Run command.'
    }
  });
  assert.equal(bugResult.filename, '.github/ISSUE_TEMPLATE/bug_report.md');
  assert.ok(bugResult.content.startsWith('---\nname: Bug Report\n'));
  assert.ok(bugResult.content.includes("title: '[BUG] '"));
  assert.ok(bugResult.content.includes('## Steps to Reproduce'));

  const featureResult = generateDocument({
    templateId: 'issue-feature-request',
    options: {
      problemStatement: 'Need faster builds.',
      proposedSolution: 'Add cache.'
    }
  });
  assert.equal(featureResult.filename, '.github/ISSUE_TEMPLATE/feature_request.md');
  assert.ok(featureResult.content.startsWith('---\nname: Feature Request\n'));
  assert.ok(featureResult.content.includes('## Proposed Solution'));

  const docsResult = generateDocument({
    templateId: 'issue-documentation',
    options: {
      docLocation: 'README.md',
      problemDescription: 'Broken installation link.'
    }
  });
  assert.equal(docsResult.filename, '.github/ISSUE_TEMPLATE/documentation.md');
  assert.ok(docsResult.content.startsWith('---\nname: Documentation Improvement\n'));
  assert.ok(docsResult.content.includes('## Affected Documentation'));
});

test('pull request template generates comprehensive sections and interactive checklist', () => {
  const prResult = generateDocument({
    templateId: 'pull-request-template',
    options: {
      summary: 'Add feature X.',
      testing: 'npm test passes.',
      relatedIssues: 'Fixes #42',
      checklist: 'Code follows style\nTests pass\nDocs updated'
    }
  });
  assert.equal(prResult.filename, '.github/PULL_REQUEST_TEMPLATE.md');
  assert.ok(prResult.content.startsWith('## Summary\n\nAdd feature X\\.'));
  assert.ok(prResult.content.includes('## Related Issues\n\nFixes \\#42'));
  assert.ok(prResult.content.includes('- [ ] Code follows style\n- [ ] Tests pass\n- [ ] Docs updated'));
});

test('listTemplates supports category filtering and returns all 8 templates by default', () => {
  assert.equal(listTemplates().length, 8);
  assert.equal(listTemplates({ category: 'document' }).length, 4);
  assert.equal(listTemplates({ category: 'issue-template' }).length, 3);
  assert.equal(listTemplates({ category: 'pr-template' }).length, 1);
});

function authContext(permission = 'write') {
  return {
    isAppConfigured: true,
    resolveRepoInstallation: async () => ({
      installed: true,
      installation: { id: 12345, permissions: { contents: 'write', pull_requests: 'write' } },
      octokit: {
        rest: {
          repos: {
            getCollaboratorPermissionLevel: async ({ username, owner, repo }) => {
              assert.equal(username, 'verified-user');
              assert.equal(owner, 'owner');
              assert.equal(repo, 'project');
              return { data: { permission } };
            },
            get: async () => ({
              data: {
                full_name: 'owner/project',
                name: 'project',
                owner: { login: 'owner' },
                default_branch: 'main',
                private: false,
                archived: false,
                html_url: 'https://github.com/owner/project'
              }
            }),
            getContent: async ({ path }) => {
              if (path === '') {
                return {
                  data: [
                    { name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', type: 'file' },
                    { name: '.github', path: '.github', type: 'dir' }
                  ]
                };
              }
              if (path === 'CONTRIBUTING.md') {
                return {
                  data: {
                    type: 'file',
                    name: 'CONTRIBUTING.md',
                    path: 'CONTRIBUTING.md',
                    sha: 'contrib-file-sha-123'
                  }
                };
              }
              if (path === '.github') {
                return {
                  data: [
                    { name: 'ISSUE_TEMPLATE', path: '.github/ISSUE_TEMPLATE', type: 'dir' },
                    { name: 'PULL_REQUEST_TEMPLATE.md', path: '.github/PULL_REQUEST_TEMPLATE.md', type: 'file' }
                  ]
                };
              }
              if (path === '.github/PULL_REQUEST_TEMPLATE.md') {
                return {
                  data: {
                    type: 'file',
                    name: 'PULL_REQUEST_TEMPLATE.md',
                    path: '.github/PULL_REQUEST_TEMPLATE.md',
                    sha: 'pr-template-sha-123'
                  }
                };
              }
              if (path === '.github/ISSUE_TEMPLATE') {
                return {
                  data: [
                    { name: 'bug_report.md', path: '.github/ISSUE_TEMPLATE/bug_report.md', type: 'file' }
                  ]
                };
              }
              if (path === '.github/ISSUE_TEMPLATE/bug_report.md') {
                return {
                  data: {
                    type: 'file',
                    name: 'bug_report.md',
                    path: '.github/ISSUE_TEMPLATE/bug_report.md',
                    sha: 'bug-report-sha-123'
                  }
                };
              }
              const notFound = new Error('Not found');
              notFound.status = 404;
              throw notFound;
            },
            createOrUpdateFileContents: async (args) => ({ data: { commit: { sha: `commit-${args.path}` } } })
          },
          git: {
            getRef: async () => ({ data: { object: { sha: 'base-commit-sha' } } }),
            createRef: async () => ({ data: { ref: 'refs/heads/chore/add-community-files' } })
          },
          pulls: {
            list: async () => ({ data: [] }),
            create: async ({ title, head, base }) => ({
              data: {
                number: 101,
                html_url: 'https://github.com/owner/project/pull/101',
                title,
                head,
                base
              }
            })
          }
        }
      }
    })
  };
}

const createUserClient = () => ({ rest: { users: { getAuthenticated: async () => ({ data: { login: 'verified-user', type: 'User' } }) } } });

test('caller authorization verifies user identity and target repository write permission', async () => {
  for (const permission of ['write', 'admin', 'maintain']) {
    assert.equal((await authorizeRepositoryWrite({ authorization: 'Bearer test_token', repoInput: 'owner/project', githubContext: authContext(permission), createUserClient })).login, 'verified-user');
  }
  for (const permission of ['read', 'triage', 'none', undefined]) {
    const context = authContext(permission === undefined ? 'unknown' : permission);
    await assert.rejects(authorizeRepositoryWrite({ authorization: 'Bearer test_token', repoInput: 'owner/project', githubContext: context, createUserClient }), (error) => error.statusCode === 403);
  }
});

test('missing tokens, bot tokens and upstream failures fail closed', async () => {
  await assert.rejects(authorizeRepositoryWrite({ repoInput: 'owner/project' }), (error) => error.statusCode === 401);
  await assert.rejects(authorizeRepositoryWrite({ authorization: 'Bearer token', repoInput: 'owner/project', createUserClient: () => ({ rest: { users: { getAuthenticated: async () => ({ data: { type: 'Bot', login: 'bot' } }) } } }) }), (error) => error.statusCode === 403);
  await assert.rejects(authorizeRepositoryWrite({ authorization: 'Bearer token', repoInput: 'owner/project', createUserClient: () => { throw new Error('secret must not leak'); } }), (error) => error.code === 'AUTH_UNAVAILABLE' && !error.message.includes('secret'));
});

test('expired tokens and uninstalled repositories are rejected', async () => {
  await assert.rejects(authorizeRepositoryWrite({ authorization: 'Bearer expired', repoInput: 'owner/project', createUserClient: () => ({ rest: { users: { getAuthenticated: async () => { throw Object.assign(new Error('invalid'), { status: 401 }); } } } }) }), (error) => error.statusCode === 401);
  await assert.rejects(authorizeRepositoryWrite({ authorization: 'Bearer token', repoInput: 'owner/project', githubContext: { resolveRepoInstallation: async () => ({ installed: false }) }, createUserClient }), (error) => error.statusCode === 403);
});

test('shared file commits reject unsafe targets before mutation and preserve expected SHAs', async () => {
  const calls = [];
  const client = { rest: { repos: { createOrUpdateFileContents: async (args) => { calls.push(args); return { data: { commit: { sha: 'next' } } }; } } } };
  await assert.rejects(commitFiles(client, { branch: 'main', defaultBranch: 'main', files: [] }));
  await assert.rejects(commitFiles(client, { branch: 'feat/docs', defaultBranch: 'main', files: [{ path: '../bad', content: '', message: 'bad' }] }));
  assert.equal(calls.length, 0);
  await commitFiles(client, { owner: 'owner', repo: 'project', branch: 'feat/docs', defaultBranch: 'main', files: [{ path: 'A.md', content: 'A', message: 'docs' }, { path: 'B.md', sha: 'expected', content: 'B', message: 'docs' }] });
  assert.equal(calls.length, 2); assert.equal(calls[1].sha, 'expected');
});

// Phase 3: Community health repository audit tests
test('auditCommunityRepository detects existing community documents and calculates score', async () => {
  const context = authContext();
  const report = await auditCommunityRepository({ repoInput: 'owner/project', githubContext: context });
  assert.equal(report.repository.fullName, 'owner/project');
  assert.equal(report.files.contributing.status, 'present');
  assert.equal(report.files.contributing.path, 'CONTRIBUTING.md');
  assert.equal(report.files.codeOfConduct.status, 'missing');
  assert.equal(report.files.pullRequestTemplate.status, 'present');
  assert.equal(report.files.pullRequestTemplate.path, '.github/PULL_REQUEST_TEMPLATE.md');
  assert.equal(report.files.issueTemplates.status, 'present');
  assert.deepEqual(report.files.issueTemplates.paths, ['.github/ISSUE_TEMPLATE/bug_report.md']);
  assert.equal(report.summary.total, 6);
  assert.equal(report.summary.present, 3);
  assert.equal(report.summary.missing, 3);
  assert.equal(report.summary.score, 50);
});

// Phase 3: Community PR preview tests
test('previewCommunityPr checks conflicts for existing files and formats file list', async () => {
  const context = authContext();
  // CONTRIBUTING.md exists in mock, SECURITY.md does not
  const preview = await previewCommunityPr({
    repoInput: 'owner/project',
    documents: [
      { templateId: 'contributing', options: { projectName: 'Test' } },
      { templateId: 'security', options: { projectName: 'Test', supportedVersions: '1.0', reportingContact: 'sec@test.org' } }
    ],
    replaceExisting: false,
    githubContext: context
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.files.length, 2);
  assert.equal(preview.hasConflicts, true);
  assert.deepEqual(preview.conflicts, ['CONTRIBUTING.md']);
});

// Phase 3: Community Pull Request creation tests
test('createCommunityPullRequest creates branch, commits multiple files, and opens PR', async () => {
  const context = authContext();
  const result = await createCommunityPullRequest({
    repoInput: 'owner/project',
    documents: [
      { templateId: 'security', options: { projectName: 'Test', supportedVersions: '1.0', reportingContact: 'sec@test.org' } },
      { templateId: 'support', options: { projectName: 'Test' } }
    ],
    replaceExisting: false,
    githubContext: context
  });
  assert.equal(result.ok, true);
  assert.equal(result.pullNumber, 101);
  assert.ok(result.branch.startsWith('chore/add-community-files'));
  assert.deepEqual(result.files, ['SECURITY.md', 'SUPPORT.md']);
});

test('createCommunityPullRequest refuses with 409 when file exists and replaceExisting is false', async () => {
  const context = authContext();
  // CONTRIBUTING.md exists in our mock repository
  await assert.rejects(
    createCommunityPullRequest({
      repoInput: 'owner/project',
      documents: [{ templateId: 'contributing', options: { projectName: 'Test' } }],
      replaceExisting: false,
      githubContext: context
    }),
    (error) => error.statusCode === 409 && error.code === 'FILE_EXISTS'
  );
});

test('HTTP capabilities and community APIs are public; writes require user authorization', async (t) => {
  let installationCalls = 0;
  const { app } = createApp({ env: {}, githubContext: { resolveRepoInstallation() { installationCalls += 1; throw new Error('Unexpected repository access'); } }, logger: { error() {} } });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/capabilities`)).json()).capabilities.length, 6);
  assert.equal((await fetch(`${base}/api/capabilities/unknown`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/community/templates`)).json()).templates.length, 8);
  assert.equal((await (await fetch(`${base}/api/community/templates?category=document`)).json()).templates.length, 4);
  assert.equal((await (await fetch(`${base}/api/community/templates?category=issue-template`)).json()).templates.length, 3);
  assert.equal((await (await fetch(`${base}/api/community/templates?category=pr-template`)).json()).templates.length, 1);

  for (const [templateId, options] of Object.entries(valid)) {
    const response = await fetch(`${base}/api/community/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId, options }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), generateDocument({ templateId, options }));
  }
  const rejected = await fetch(`${base}/api/trigger-pr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'owner/project', licenseId: 'MIT', holder: 'Example' }) });
  assert.equal(rejected.status, 401); assert.equal(installationCalls, 0);

  // Phase 3 community PR trigger also requires authorization
  const rejectedCommPr = await fetch(`${base}/api/community/trigger-pr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'owner/project', documents: [] }) });
  assert.equal(rejectedCommPr.status, 401);

  assert.equal((await fetch(`${base}/community.html`)).status, 200);
});

test('HTTP community write endpoint rejects read-only users before any branch or file mutation', async (t) => {
  let writes = 0;
  const context = authContext('read');
  const original = context.resolveRepoInstallation;
  context.resolveRepoInstallation = async () => {
    const resolution = await original();
    resolution.octokit.rest.git = { createRef: async () => { writes += 1; } };
    resolution.octokit.rest.repos.createOrUpdateFileContents = async () => { writes += 1; };
    return resolution;
  };
  const { app } = createApp({ env: {}, githubContext: context, createUserClient, logger: { error() {} } });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/community/trigger-pr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify({
      repo: 'owner/project',
      documents: [{ templateId: 'security', options: { projectName: 'Test', supportedVersions: '1.0', reportingContact: 'sec@test.org' } }]
    })
  });
  assert.equal(response.status, 403);
  assert.equal(writes, 0);
});
