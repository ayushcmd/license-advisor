import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDocument, listTemplates } from '../src/modules/community/engine.js';
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

function authContext(permission = 'write') {
  return { resolveRepoInstallation: async () => ({ installed: true, octokit: { rest: { repos: { getCollaboratorPermissionLevel: async ({ username, owner, repo }) => {
    assert.equal(username, 'verified-user'); assert.equal(owner, 'owner'); assert.equal(repo, 'project');
    return { data: { permission } };
  } } } } }) };
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
test('HTTP capabilities and community APIs are public; writes require user authorization', async (t) => {
  let installationCalls = 0;
  const { app } = createApp({ env: {}, githubContext: { resolveRepoInstallation() { installationCalls += 1; throw new Error('Unexpected repository access'); } }, logger: { error() {} } });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/capabilities`)).json()).capabilities.length, 6);
  assert.equal((await fetch(`${base}/api/capabilities/unknown`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/community/templates`)).json()).templates.length, 4);
  for (const [templateId, options] of Object.entries(valid)) {
    const response = await fetch(`${base}/api/community/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId, options }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), generateDocument({ templateId, options }));
  }
  const rejected = await fetch(`${base}/api/trigger-pr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: 'owner/project', licenseId: 'MIT', holder: 'Example' }) });
  assert.equal(rejected.status, 401); assert.equal(installationCalls, 0);
  assert.equal((await fetch(`${base}/community.html`)).status, 200);
});
test('HTTP write endpoint rejects read-only users before any branch or file mutation', async (t) => {
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
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/trigger-pr`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' }, body: JSON.stringify({ repo: 'owner/project', licenseId: 'MIT', holder: 'Example' }) });
  assert.equal(response.status, 403); assert.equal(writes, 0);
});
