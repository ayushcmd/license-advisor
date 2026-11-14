import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  listDocumentationChecks,
  listDocumentationTemplates,
  parseReadmeContent,
  generateReadme,
  improveExistingReadme,
  generateChangelog,
  generateBadge,
  extractMarkdownLinks,
  isPrivateIp,
  isSafeExternalUrl
} from '../src/modules/documentation/engine.js';
import {
  auditDocumentationRepository,
  checkDocumentationLinks,
  previewDocumentationPr,
  createDocumentationPullRequest
} from '../src/modules/documentation/documentationService.js';
import { createApp } from '../src/server.js';

// Mock GitHub Context factory
function createMockGitHubContext({
  permission = 'write',
  readmeFilename = 'README.md',
  readmeContent = '# Test Project\n\nA test repository description.\n\n## Installation\n\n```bash\nnpm install\n```\n\n## Usage\n\n```bash\nnpm start\n```\n\n## License\n\nMIT License\n',
  hasDocsDir = true,
  hasChangelog = false,
  archived = false
} = {}) {
  const fileStore = new Map();

  if (readmeFilename && readmeContent) {
    fileStore.set(readmeFilename, {
      sha: 'readme-sha-1',
      content: readmeContent
    });
  }

  if (hasChangelog) {
    fileStore.set('CHANGELOG.md', {
      sha: 'changelog-sha-1',
      content: '# Changelog\n\n## [0.9.0] - 2026-01-01\n\n### Features\n- Initial release\n'
    });
  }

  fileStore.set('docs/ARCHITECTURE.md', {
    sha: 'arch-sha-1',
    content: '# Architecture Overview'
  });

  const rootFiles = [
    ...(readmeFilename ? [{ name: readmeFilename, path: readmeFilename, type: 'file' }] : []),
    ...(hasChangelog ? [{ name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' }] : []),
    ...(hasDocsDir ? [{ name: 'docs', path: 'docs', type: 'dir' }] : [])
  ];

  const docsFiles = [
    { name: 'ARCHITECTURE.md', path: 'docs/ARCHITECTURE.md', type: 'file' }
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
            fork: false
          }
        }),
        getContent: async ({ path: filePath }) => {
          if (!filePath || filePath === '') return { data: rootFiles };
          if (filePath === 'docs') return { data: docsFiles };

          if (fileStore.has(filePath)) {
            const f = fileStore.get(filePath);
            return {
              data: {
                type: 'file',
                name: filePath.split('/').pop(),
                path: filePath,
                sha: f.sha,
                content: Buffer.from(f.content).toString('base64')
              }
            };
          }
          const err = new Error(`File ${filePath} not found`);
          err.status = 404;
          throw err;
        },
        createOrUpdateFileContents: async (args) => {
          createdFiles.push(args);
          fileStore.set(args.path, { sha: `sha-${args.path}`, content: args.content });
          return { data: { commit: { sha: `commit-${args.path}` } } };
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
            number: 10,
            html_url: 'https://github.com/owner/project/pull/10',
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
        id: 999,
        permissions: { contents: 'write', pull_requests: 'write' }
      }
    }),
    createPublicOctokit: () => mockOctokit
  };
}

describe('Documentation Engine (Checks, Templates & Parsers)', () => {
  it('exposes documentation checks and templates', () => {
    const checks = listDocumentationChecks();
    assert.ok(checks.length >= 7);
    assert.ok(checks.some((c) => c.id === 'readme-present'));
    assert.ok(checks.some((c) => c.id === 'readme-installation'));
    assert.ok(checks.some((c) => c.id === 'changelog-present'));

    const templates = listDocumentationTemplates();
    assert.equal(templates.length, 3);
    assert.ok(templates.some((t) => t.id === 'readme'));
    assert.ok(templates.some((t) => t.id === 'changelog'));
    assert.ok(templates.some((t) => t.id === 'badges'));
  });

  it('parses README headings and detects standard sections accurately', () => {
    const markdown = `# Awesome Tool\n\nA great command-line utility.\n\n## Getting Started\n\nSetup guide.\n\n## How to Use\n\nRun the CLI.\n\n## Development\n\nContributing.\n\n## Legal\n\nMIT License.\n`;
    const parsed = parseReadmeContent(markdown);

    assert.equal(parsed.detected.title, true);
    assert.equal(parsed.detected.titleText, 'Awesome Tool');
    assert.equal(parsed.detected.description, true);
    assert.equal(parsed.detected.installation, true); // Recognized 'Getting Started'
    assert.equal(parsed.detected.usage, true); // Recognized 'How to Use'
    assert.equal(parsed.detected.contributing, true); // Recognized 'Development'
    assert.equal(parsed.detected.license, true); // Recognized 'Legal'
  });

  it('generates a clean, deterministic README document', () => {
    const readme1 = generateReadme({
      projectName: 'Test Project',
      description: 'Useful tool for developers.',
      repositoryUrl: 'https://github.com/owner/project',
      features: ['Fast execution', 'Zero dependencies'],
      installation: 'npm install test-project',
      usage: 'import { test } from "test-project";',
      license: 'Apache-2.0'
    });

    const readme2 = generateReadme({
      projectName: 'Test Project',
      description: 'Useful tool for developers.',
      repositoryUrl: 'https://github.com/owner/project',
      features: ['Fast execution', 'Zero dependencies'],
      installation: 'npm install test-project',
      usage: 'import { test } from "test-project";',
      license: 'Apache-2.0'
    });

    assert.equal(readme1, readme2);
    assert.ok(readme1.includes('# Test Project'));
    assert.ok(readme1.includes('## Features'));
    assert.ok(readme1.includes('- Fast execution'));
    assert.ok(readme1.includes('## Installation'));
    assert.ok(readme1.includes('npm install test-project'));
    assert.ok(readme1.includes('Apache-2.0 License'));
  });

  it('improves existing README by adding missing sections without overwriting or duplicating', () => {
    const existing = `# Existing Project\n\nOverview description.\n\n## Usage\n\nRun the app.\n\n## License\n\nMIT\n`;
    const result = improveExistingReadme(existing, {
      installation: 'Run `npm install`',
      usage: 'This should be skipped because Usage already exists',
      testing: 'Run `npm test`'
    });

    assert.ok(result.addedSections.includes('Installation'));
    assert.ok(result.addedSections.includes('Running Tests'));
    assert.ok(result.skippedSections.includes('Usage'));
    assert.ok(result.content.includes('## Installation'));
    assert.ok(result.content.includes('## Running Tests'));
    assert.ok(!result.content.includes('This should be skipped'));
    // Ensures License section is preserved at the end
    assert.ok(result.content.endsWith('## License\n\nMIT\n'));
  });
});

describe('Changelog Generator (Conventional Commits)', () => {
  it('groups Conventional Commits into structured sections', () => {
    const commits = [
      { sha: 'abcdef1234', message: 'feat(auth): add OAuth2 provider', author: 'alice' },
      { sha: 'bcdef12345', message: 'fix(router): resolve crash on trailing slash', author: 'bob' },
      { sha: 'cdef123456', message: 'docs: update API setup guide', author: 'charlie' },
      { sha: 'def1234567', message: 'chore: bump dependencies', author: 'alice' },
      { sha: 'ef12345678', message: 'BREAKING CHANGE: drop Node 18 support', author: 'bob' },
      { sha: 'f123456789', message: 'random uncategorized commit', author: 'charlie' }
    ];

    const changelog = generateChangelog({
      version: '1.2.0',
      date: '2026-11-14',
      commits,
      repoUrl: 'https://github.com/owner/project'
    });

    assert.ok(changelog.includes('## [1.2.0] - 2026-11-14'));
    assert.ok(changelog.includes('### Features'));
    assert.ok(changelog.includes('**auth:** add OAuth2 provider'));
    assert.ok(changelog.includes('### Bug Fixes'));
    assert.ok(changelog.includes('### Breaking Changes'));
    assert.ok(changelog.includes('### Documentation'));
    assert.ok(changelog.includes('### Other Changes'));
    assert.ok(changelog.includes('([abcdef1](https://github.com/owner/project/commit/abcdef1))'));
  });

  it('prepends new release to an existing changelog under # Changelog', () => {
    const previous = `# Changelog\n\nAll notable changes.\n\n## [1.0.0] - 2026-01-01\n\n### Features\n- First release\n`;
    const updated = generateChangelog({
      version: '1.1.0',
      date: '2026-06-01',
      commits: [{ sha: '111', message: 'feat: add metrics' }],
      previousChangelog: previous
    });

    assert.ok(updated.startsWith('# Changelog\n\nAll notable changes.\n\n## [1.1.0] - 2026-06-01'));
    assert.ok(updated.includes('## [1.0.0] - 2026-01-01'));
  });
});

describe('Badge Generator & Markdown Link Validation', () => {
  it('generates properly encoded Markdown status badges', () => {
    const licenseBadge = generateBadge({ type: 'license', spdx: 'Apache-2.0', repo: 'owner/project' });
    assert.ok(licenseBadge.includes('img.shields.io/badge/license-Apache-2.0-blue.svg'));
    assert.ok(licenseBadge.includes('https://github.com/owner/project/blob/main/LICENSE'));

    const workflowBadge = generateBadge({ type: 'workflow', owner: 'owner', repo: 'project', workflow: 'ci.yml' });
    assert.ok(workflowBadge.includes('actions/workflows/ci.yml/badge.svg'));

    const customBadge = generateBadge({ type: 'custom', label: 'build', message: 'passing', color: 'green', link: 'https://example.com' });
    assert.ok(customBadge.includes('img.shields.io/badge/build-passing-green'));
    assert.ok(customBadge.includes('https://example.com'));
  });

  it('extracts links and distinguishes internal, external, anchor, and mailto links', () => {
    const markdown = `
[Local Doc](./docs/ARCHITECTURE.md)
[Website](https://open-workers.onrender.com)
![Logo](images/logo.png)
[Anchor](#heading)
[Email](mailto:team@example.com)
`;
    const links = extractMarkdownLinks(markdown);
    assert.equal(links.length, 5);
    assert.equal(links[0].type, 'internal');
    assert.equal(links[0].url, './docs/ARCHITECTURE.md');
    assert.equal(links[1].type, 'external');
    assert.equal(links[2].type, 'internal');
    assert.equal(links[2].isImage, true);
    assert.equal(links[3].type, 'anchor');
    assert.equal(links[4].type, 'mailto');
  });

  it('blocks private, loopback, and metadata destinations from external checks (SSRF)', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('10.0.1.5'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('169.254.169.254'), true);
    assert.equal(isPrivateIp('8.8.8.8'), false);

    assert.equal(isSafeExternalUrl('http://localhost:3000/api').safe, false);
    assert.equal(isSafeExternalUrl('http://127.0.0.1/admin').safe, false);
    assert.equal(isSafeExternalUrl('http://169.254.169.254/latest/meta-data').safe, false);
    assert.equal(isSafeExternalUrl('http://metadata.google.internal').safe, false);
    assert.equal(isSafeExternalUrl('https://github.com/ayushcmd/open-workers').safe, true);
  });
});

describe('Documentation Repository Audit (auditDocumentationRepository)', () => {
  it('audits repository documentation, detects present sections, and scores completeness', async () => {
    const ctx = createMockGitHubContext({ hasChangelog: true });
    const report = await auditDocumentationRepository({ repoInput: 'owner/project', githubContext: ctx });

    assert.equal(report.repository.fullName, 'owner/project');
    assert.equal(report.readme.exists, true);
    assert.equal(report.readme.format, 'markdown');
    assert.equal(report.readme.sections.title, true);
    assert.equal(report.readme.sections.installation, true);
    assert.equal(report.readme.sections.usage, true);
    assert.equal(report.readme.sections.license, true);
    assert.equal(report.changelog.exists, true);
    assert.ok(report.summary.completenessScore >= 80);
  });

  it('handles missing README gracefully and recommends fix', async () => {
    const ctx = createMockGitHubContext({ readmeFilename: null, readmeContent: null });
    const report = await auditDocumentationRepository({ repoInput: 'owner/project', githubContext: ctx });

    assert.equal(report.readme.exists, false);
    const check = report.checks.find((c) => c.id === 'readme-present');
    assert.equal(check.status, 'missing');
    assert.equal(check.canGenerateFix, true);
    assert.ok(report.summary.completenessScore < 50);
  });

  it('recognizes non-markdown README formats (rst, txt) without failing', async () => {
    const ctx = createMockGitHubContext({
      readmeFilename: 'README.rst',
      readmeContent: 'Project\n=======\n\nRestructured text readme.'
    });
    const report = await auditDocumentationRepository({ repoInput: 'owner/project', githubContext: ctx });

    assert.equal(report.readme.exists, true);
    assert.equal(report.readme.format, 'rst');
    const titleCheck = report.checks.find((c) => c.id === 'readme-title-desc');
    assert.equal(titleCheck.status, 'not_verified');
  });
});

describe('Markdown Link Checker Service (checkDocumentationLinks)', () => {
  it('validates internal repository files and external HTTP targets', async () => {
    const readmeWithLinks = `
# Project
[Architecture Guide](./docs/ARCHITECTURE.md)
[Missing File](./docs/MISSING.md)
[Escaping Path](../secret.txt)
[GitHub](https://github.com)
`;
    const ctx = createMockGitHubContext({ readmeContent: readmeWithLinks });

    const mockFetch = async (url) => {
      if (url === 'https://github.com') return new Response('', { status: 200 });
      return new Response('', { status: 404 });
    };

    const report = await checkDocumentationLinks({
      repoInput: 'owner/project',
      path: 'README.md',
      githubContext: ctx,
      fetchImpl: mockFetch
    });

    assert.equal(report.totalLinks, 4);
    assert.equal(report.summary.working, 2); // ARCHITECTURE.md and github.com
    assert.equal(report.summary.broken, 2); // MISSING.md and escaping path
  });
});

describe('Documentation PR Previews & Creation', () => {
  it('previews changes and detects conflicts when replaceExisting is false', async () => {
    const ctx = createMockGitHubContext();

    const preview = await previewDocumentationPr({
      repoInput: 'owner/project',
      changes: [{ path: 'README.md', content: '# New README' }],
      replaceExisting: false,
      githubContext: ctx
    });

    assert.equal(preview.hasConflicts, true);
    assert.deepEqual(preview.conflicts, ['README.md']);
    assert.equal(preview.canProceed, false);
  });

  it('allows proceeding with update when replaceExisting is true', async () => {
    const ctx = createMockGitHubContext();

    const preview = await previewDocumentationPr({
      repoInput: 'owner/project',
      changes: [{ path: 'README.md', content: '# New README' }],
      replaceExisting: true,
      githubContext: ctx
    });

    assert.equal(preview.hasConflicts, false);
    assert.equal(preview.canProceed, true);
  });

  it('creates dedicated branch, commits documentation, and opens PR safely', async () => {
    const ctx = createMockGitHubContext({ hasChangelog: false });

    const result = await createDocumentationPullRequest({
      repoInput: 'owner/project',
      changes: [
        { path: 'CHANGELOG.md', content: '# Changelog\n\nInitial version' }
      ],
      replaceExisting: false,
      githubContext: ctx
    });

    assert.equal(result.success, true);
    assert.equal(result.pullRequest.number, 10);
    assert.ok(result.branch.startsWith('chore/improve-docs'));
    assert.deepEqual(result.files, ['CHANGELOG.md']);
    assert.equal(ctx.createdRefs.length, 1);
    assert.equal(ctx.createdFiles.length, 1);
  });

  it('refuses on archived repositories (409 REPO_ARCHIVED)', async () => {
    const ctx = createMockGitHubContext({ archived: true });

    await assert.rejects(
      createDocumentationPullRequest({
        repoInput: 'owner/project',
        changes: [{ path: 'README.md', content: 'New' }],
        githubContext: ctx
      }),
      (err) => err.statusCode === 409 && err.code === 'REPO_ARCHIVED'
    );
  });
});

describe('Documentation HTTP API Endpoints', () => {
  let server;
  let baseUrl;
  const mockCtx = createMockGitHubContext();

  const mockUserClient = (perm = 'write') => () => ({
    rest: {
      users: { getAuthenticated: async () => ({ data: { login: 'carol', type: 'User' } }) },
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

  it('GET /api/documentation/checks returns supported documentation checks', async () => {
    const res = await fetch(`${baseUrl}/api/documentation/checks`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.checks));
    assert.ok(json.checks.length >= 7);
  });

  it('GET /api/documentation/templates returns available templates', async () => {
    const res = await fetch(`${baseUrl}/api/documentation/templates`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.templates));
    assert.equal(json.templates.length, 3);
  });

  it('POST /api/documentation/generate generates README and Changelog', async () => {
    const res1 = await fetch(`${baseUrl}/api/documentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'readme', options: { projectName: 'Demo' } })
    });
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.ok(json1.content.includes('# Demo'));

    const res2 = await fetch(`${baseUrl}/api/documentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'changelog', options: { version: '1.0.0' } })
    });
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.ok(json2.content.includes('# Changelog'));
  });

  it('POST /api/documentation/analyze audits repository documentation', async () => {
    const res = await fetch(`${baseUrl}/api/documentation/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.repository.fullName, 'owner/project');
    assert.ok(Array.isArray(json.checks));
  });

  it('POST /api/documentation/check-links inspects Markdown links', async () => {
    const res = await fetch(`${baseUrl}/api/documentation/check-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', path: 'README.md' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.links));
  });

  it('POST /api/documentation/preview-pr checks proposed documentation files', async () => {
    const res = await fetch(`${baseUrl}/api/documentation/preview-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'owner/project',
        changes: [{ path: 'README.md', content: '# New' }],
        replaceExisting: false
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.hasConflicts, true);
  });

  it('POST /api/documentation/trigger-pr creates authorized documentation PR', async () => {
    const res = await fetch(`${baseUrl}/api/documentation/trigger-pr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user_pat_token'
      },
      body: JSON.stringify({
        repo: 'owner/project',
        changes: [{ path: 'CHANGELOG.md', content: '# Changelog' }],
        replaceExisting: false
      })
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.pullRequest.number, 10);
  });
});
