/**
 * Open Workers — Automation Module Test Suite
 *
 * Covers Repository Setup Audits, CI Workflow Generators, Workflow Health Inspector,
 * Code Quality Generators, PR Previews & Conflicts, Authorization, and Mutation Safety.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_NODE_VERSIONS,
  SUPPORTED_PYTHON_VERSIONS,
  SUPPORTED_OPERATING_SYSTEMS,
  AUTOMATION_CHECKS,
  AUTOMATION_TEMPLATES,
  generateNodeCiWorkflow,
  generatePythonCiWorkflow,
  generateMatrixCiWorkflow,
  generatePrValidationWorkflow,
  generateMaintenanceWorkflow,
  generateEditorConfig,
  generatePrettierConfig,
  generateEslintConfig,
  generateGitAttributes,
  generateGitIgnore,
  generateAutomationFile,
  inspectWorkflowContent,
  evaluateRepositorySetup
} from '../src/modules/automation/engine.js';
import {
  listAutomationChecks,
  listAutomationTemplates,
  auditRepositorySetup,
  inspectRepositoryWorkflows,
  previewAutomationPr,
  createAutomationPullRequest
} from '../src/modules/automation/automationService.js';
import { createApp } from '../src/server.js';

describe('Automation Engine — Workflow & Configuration Generators', () => {
  it('exposes supported constants and template catalogs accurately', () => {
    assert.ok(SUPPORTED_NODE_VERSIONS.includes('20'));
    assert.ok(SUPPORTED_PYTHON_VERSIONS.includes('3.11'));
    assert.ok(SUPPORTED_OPERATING_SYSTEMS.includes('ubuntu-latest'));
    assert.equal(AUTOMATION_CHECKS.length, 8);
    assert.equal(AUTOMATION_TEMPLATES.length, 10);
    assert.equal(listAutomationChecks().length, 8);
    assert.equal(listAutomationTemplates().length, 10);
  });

  it('generates valid Node.js CI workflow with least-privilege permissions and timeouts', () => {
    const yaml = generateNodeCiWorkflow({
      nodeVersions: ['20', '22'],
      packageManager: 'npm',
      testCommand: 'npm test',
      includeLint: true,
      includeBuild: true
    });

    assert.ok(yaml.includes('name: Node.js CI'));
    assert.ok(yaml.includes('permissions:\n  contents: read'));
    assert.ok(yaml.includes('timeout-minutes: 15'));
    assert.ok(yaml.includes('node-version: [20, 22]'));
    assert.ok(yaml.includes('run: npm ci'));
    assert.ok(yaml.includes('run: npm run lint'));
    assert.ok(yaml.includes('run: npm run build'));
    assert.ok(yaml.includes('run: npm test'));
    assert.ok(yaml.includes('uses: actions/checkout@v4'));
    assert.ok(yaml.includes('uses: actions/setup-node@v4'));
  });

  it('supports pnpm and yarn in Node.js CI workflow', () => {
    const pnpmYaml = generateNodeCiWorkflow({ packageManager: 'pnpm' });
    assert.ok(pnpmYaml.includes('run: pnpm install --frozen-lockfile'));
    assert.ok(pnpmYaml.includes("cache: 'pnpm'"));

    const yarnYaml = generateNodeCiWorkflow({ packageManager: 'yarn' });
    assert.ok(yarnYaml.includes('run: yarn install --frozen-lockfile'));
    assert.ok(yarnYaml.includes("cache: 'yarn'"));
  });

  it('rejects command injection in workflow generator', () => {
    assert.throws(
      () => generateNodeCiWorkflow({ testCommand: 'npm test; rm -rf /' }),
      /contains unsafe shell syntax/
    );
    assert.throws(
      () => generateNodeCiWorkflow({ testCommand: 'npm test && echo ${{ github.event.issue.title }}' }),
      /contains unsafe shell syntax/
    );
  });

  it('generates Python CI workflow with version matrix, linting, and type checking', () => {
    const yaml = generatePythonCiWorkflow({
      pythonVersions: ['3.11', '3.12'],
      installCommand: 'pip install -r requirements-dev.txt',
      testCommand: 'pytest tests/',
      includeLint: true,
      includeTypeCheck: true
    });

    assert.ok(yaml.includes('name: Python CI'));
    assert.ok(yaml.includes("python-version: ['3.11', '3.12']"));
    assert.ok(yaml.includes('pip install -r requirements-dev.txt'));
    assert.ok(yaml.includes('run: ruff check .'));
    assert.ok(yaml.includes('run: mypy .'));
    assert.ok(yaml.includes('run: pytest tests/'));
    assert.ok(yaml.includes('uses: actions/setup-python@v5'));
  });

  it('generates multi-platform matrix CI workflow and enforces bounded job limits', () => {
    const yaml = generateMatrixCiWorkflow({
      operatingSystems: ['ubuntu-latest', 'windows-latest', 'macos-latest'],
      runtime: 'node',
      runtimeVersions: ['20', '22']
    });

    assert.ok(yaml.includes('name: Multi-Platform CI'));
    assert.ok(yaml.includes('os: [ubuntu-latest, windows-latest, macos-latest]'));
    assert.ok(yaml.includes('version: [20, 22]'));
    assert.ok(yaml.includes('timeout-minutes: 20'));

    // Matrix with too many jobs (3 OS * 4 versions = 12 > 9) must throw error
    assert.throws(
      () => generateMatrixCiWorkflow({
        operatingSystems: ['ubuntu-latest', 'windows-latest', 'macos-latest'],
        runtimeVersions: ['18', '20', '22', '24']
      }),
      /exceeds safe bound/
    );
  });

  it('generates PR validation workflow scoped strictly for pull requests', () => {
    const yaml = generatePrValidationWorkflow({ testCommand: 'npm test' });
    assert.ok(yaml.includes('name: PR Validation'));
    assert.ok(yaml.includes('pull_request:'));
    assert.ok(!yaml.includes('push:'));
    assert.ok(yaml.includes('permissions:\n  contents: read'));
  });

  it('generates scheduled maintenance workflow with validated cron', () => {
    const yaml = generateMaintenanceWorkflow({ task: 'npm-audit', cron: '0 2 * * 1' });
    assert.ok(yaml.includes('name: Scheduled Maintenance'));
    assert.ok(yaml.includes("cron: '0 2 * * 1'"));
    assert.ok(yaml.includes('npm audit --audit-level=moderate'));

    // Fallback to default cron on invalid syntax
    const fallbackYaml = generateMaintenanceWorkflow({ task: 'pip-check', cron: 'invalid cron' });
    assert.ok(fallbackYaml.includes("cron: '0 0 * * 1'"));
    assert.ok(fallbackYaml.includes('pip list --outdated'));
  });

  it('generates EditorConfig with customizable indentation and newline standards', () => {
    const ini = generateEditorConfig({ indentStyle: 'space', indentSize: 2, endOfLine: 'lf' });
    assert.ok(ini.includes('indent_style = space'));
    assert.ok(ini.includes('indent_size = 2'));
    assert.ok(ini.includes('end_of_line = lf'));
    assert.ok(ini.includes('insert_final_newline = true'));
  });

  it('generates valid Prettier JSON configuration', () => {
    const jsonStr = generatePrettierConfig({ tabWidth: 2, semi: true, singleQuote: true });
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.tabWidth, 2);
    assert.equal(parsed.semi, true);
    assert.equal(parsed.singleQuote, true);
  });

  it('generates ESLint flat configuration for JavaScript and TypeScript', () => {
    const jsConfig = generateEslintConfig({ typescript: false });
    assert.ok(jsConfig.includes("import js from '@eslint/js';"));
    assert.ok(jsConfig.includes('js.configs.recommended'));

    const tsConfig = generateEslintConfig({ typescript: true });
    assert.ok(tsConfig.includes("import tseslint from 'typescript-eslint';"));
    assert.ok(tsConfig.includes('tseslint.configs.recommended'));
  });

  it('generates Git attributes with line ending and binary normalization', () => {
    const ga = generateGitAttributes({ eolMode: 'lf', includeBinaryRules: true });
    assert.ok(ga.includes('* text=auto eol=lf'));
    assert.ok(ga.includes('*.png binary'));
    assert.ok(ga.includes('*.pdf binary'));
  });

  it('generates Git ignore starter and cleanly merges missing lines into existing file', () => {
    const starter = generateGitIgnore({ ecosystem: 'node' });
    assert.ok(starter.includes('node_modules/'));
    assert.ok(starter.includes('.env'));

    const existing = '# My Custom Ignore\ncustom_build/\nnode_modules/\n';
    const merged = generateGitIgnore({ ecosystem: 'node', existingContent: existing });
    assert.ok(merged.includes('custom_build/'));
    assert.ok(merged.includes('.env'));
    // node_modules/ should not be duplicated
    const matches = merged.match(/node_modules\//g);
    assert.equal(matches.length, 1);
  });

  it('generateAutomationFile dispatches by templateId and rejects unknown template', () => {
    const file = generateAutomationFile({ templateId: 'editorconfig' });
    assert.equal(file.filename, '.editorconfig');
    assert.equal(file.requiresWorkflowPermission, false);

    const wf = generateAutomationFile({ templateId: 'node-ci' });
    assert.equal(wf.filename, '.github/workflows/node-ci.yml');
    assert.equal(wf.requiresWorkflowPermission, true);

    assert.throws(
      () => generateAutomationFile({ templateId: 'nonexistent-template' }),
      /Unsupported automation template/
    );
  });
});

describe('Workflow Health Inspector (inspectWorkflowContent)', () => {
  it('identifies healthy workflow with high score and zero critical findings', () => {
    const content = `
name: CI
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/ci.yml', content });
    assert.equal(report.healthScore, 100);
    assert.equal(report.status, 'passed');
    assert.equal(report.findings.length, 0);
  });

  it('detects unpinned actions with mutable branch references (@master, @main)', () => {
    const content = `
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: custom-action/tool@master
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/ci.yml', content });
    assert.ok(report.findings.some((f) => f.id === 'mutable-branch-ref'));
  });

  it('detects deprecated action references (e.g. actions/checkout@v2)', () => {
    const content = `
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/ci.yml', content });
    assert.ok(report.findings.some((f) => f.id === 'deprecated-action'));
  });

  it('detects missing explicit permissions and broad write-all permissions', () => {
    const broadContent = `
name: CI
on: [push]
permissions: write-all
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const broadReport = inspectWorkflowContent({ path: '.github/workflows/broad.yml', content: broadContent });
    assert.ok(broadReport.findings.some((f) => f.id === 'broad-permissions'));

    const missingContent = `
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const missingReport = inspectWorkflowContent({ path: '.github/workflows/missing.yml', content: missingContent });
    assert.ok(missingReport.findings.some((f) => f.id === 'missing-permissions'));
  });

  it('detects missing job timeout-minutes', () => {
    const content = `
name: CI
on: [push]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/ci.yml', content });
    assert.ok(report.findings.some((f) => f.id === 'missing-timeout'));
  });

  it('detects dangerous pull_request_target trigger with head SHA checkout', () => {
    const content = `
name: Untrusted PR
on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm test
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/dangerous.yml', content });
    assert.ok(report.findings.some((f) => f.id === 'dangerous-pr-target-checkout' && f.severity === 'critical'));
  });

  it('detects untrusted expression interpolation inside run script blocks', () => {
    const content = `
name: Issue Greeter
on: issues
jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Title: \${{ github.event.issue.title }}"
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/greet.yml', content });
    assert.ok(report.findings.some((f) => f.id === 'untrusted-script-interpolation'));
  });

  it('detects malformed YAML syntax lacking on: or jobs:', () => {
    const content = `
name: Broken Workflow
key: value
`;
    const report = inspectWorkflowContent({ path: '.github/workflows/broken.yml', content });
    assert.ok(report.findings.some((f) => f.id === 'malformed-structure'));
  });
});

describe('Repository Setup Evaluation (evaluateRepositorySetup)', () => {
  it('evaluates complete repository setup with high health score', () => {
    const evalResult = evaluateRepositorySetup({
      repoMetadata: { default_branch: 'main', language: 'JavaScript', description: 'Sample repo', topics: ['tools'] },
      rootFiles: [
        { name: '.editorconfig' },
        { name: '.prettierrc.json' },
        { name: 'eslint.config.js' },
        { name: '.gitattributes' },
        { name: '.gitignore' }
      ],
      dotGithubFiles: [],
      workflowFiles: [{ name: 'node-ci.yml' }],
      workflowHealthReports: [{ findings: [] }]
    });

    assert.equal(evalResult.setupScore, 100);
    assert.equal(evalResult.findings.find((f) => f.id === 'ci-workflow').status, 'passed');
    assert.equal(evalResult.findings.find((f) => f.id === 'editorconfig').status, 'passed');
    assert.equal(evalResult.findings.find((f) => f.id === 'prettier').status, 'passed');
    assert.equal(evalResult.findings.find((f) => f.id === 'eslint').status, 'passed');
    assert.equal(evalResult.findings.find((f) => f.id === 'gitattributes').status, 'passed');
    assert.equal(evalResult.findings.find((f) => f.id === 'gitignore').status, 'passed');
  });

  it('detects missing configurations and provides actionable fix recommendations', () => {
    const evalResult = evaluateRepositorySetup({
      repoMetadata: { default_branch: 'main', language: 'JavaScript' },
      rootFiles: [],
      dotGithubFiles: [],
      workflowFiles: [],
      workflowHealthReports: []
    });

    assert.equal(evalResult.setupScore, 0);
    assert.equal(evalResult.findings.find((f) => f.id === 'ci-workflow').status, 'missing');
    assert.equal(evalResult.findings.find((f) => f.id === 'editorconfig').status, 'missing');
    assert.equal(evalResult.findings.find((f) => f.id === 'workflow-health').status, 'not_applicable');
  });
});

describe('Automation Service (Audits, PR Previews & Creation)', () => {
  function createMockGithubContext({
    installed = true,
    workflowPermission = 'write',
    existingFiles = {},
    isArchived = false
  } = {}) {
    const mockOctokit = {
      rest: {
        repos: {
          get: async ({ owner, repo }) => ({
            data: {
              name: repo,
              full_name: `${owner}/${repo}`,
              default_branch: 'main',
              archived: isArchived,
              language: 'JavaScript',
              description: 'Mock Repo',
              topics: ['open-workers']
            }
          }),
          getContent: async ({ owner, repo, path }) => {
            if (path === '') {
              return {
                data: [
                  { name: '.github', type: 'dir' },
                  { name: '.gitignore', type: 'file' }
                ]
              };
            }
            if (path === '.github') {
              return { data: [{ name: 'workflows', type: 'dir' }] };
            }
            if (path === '.github/workflows') {
              return {
                data: [
                  {
                    name: 'ci.yml',
                    path: '.github/workflows/ci.yml',
                    type: 'file'
                  }
                ]
              };
            }
            if (existingFiles[path]) {
              return {
                data: {
                  type: 'file',
                  sha: 'mock-sha-123',
                  content: Buffer.from(existingFiles[path]).toString('base64')
                }
              };
            }
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
          },
          getBranch: async () => ({
            data: { commit: { sha: 'base-commit-sha-456' } }
          }),
          getCollaboratorPermissionLevel: async ({ username }) => {
            if (username === 'unauthorized-user') return { data: { permission: 'read' } };
            return { data: { permission: 'admin' } };
          },
          createOrUpdateFileContents: async ({ path }) => ({
            data: { commit: { sha: `commit-sha-${path}` } }
          })
        },
        git: {
          createRef: async () => ({ data: { ref: 'refs/heads/ci/configure-automation' } })
        },
        pulls: {
          create: async ({ title, head }) => ({
            data: { number: 42, html_url: `https://github.com/mock/repo/pull/42`, head }
          }),
          list: async () => ({ data: [] })
        }
      }
    };

    return {
      isAppConfigured: true,
      createPublicOctokit: () => mockOctokit,
      resolveRepoInstallation: async (owner, repo) => {
        if (!installed) return { installed: false };
        return {
          installed: true,
          octokit: mockOctokit,
          installation: {
            id: 12345,
            permissions: {
              contents: 'write',
              pull_requests: 'write',
              workflows: workflowPermission
            }
          }
        };
      }
    };
  }

  it('audits repository setup and detects workflows and files', async () => {
    const githubContext = createMockGithubContext({
      existingFiles: {
        '.github/workflows/ci.yml': 'name: CI\non: [push]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n'
      }
    });

    const result = await auditRepositorySetup({
      repoInput: 'mock/repo',
      githubContext
    });

    assert.equal(result.repository, 'mock/repo');
    assert.equal(result.defaultBranch, 'main');
    assert.ok(result.setupScore > 0);
    assert.ok(result.findings.some((f) => f.id === 'ci-workflow' && f.status === 'passed'));
    assert.ok(result.recommendations.length > 0);
  });

  it('inspects repository workflows and generates per-workflow health report', async () => {
    const githubContext = createMockGithubContext({
      existingFiles: {
        '.github/workflows/ci.yml': 'name: CI\non: [push]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n'
      }
    });

    const result = await inspectRepositoryWorkflows({
      repoInput: 'mock/repo',
      githubContext
    });

    assert.equal(result.totalWorkflows, 1);
    assert.equal(result.reports[0].path, '.github/workflows/ci.yml');
    assert.equal(result.reports[0].healthScore, 100);
  });

  it('previews proposed automation PR, detecting conflicts when replaceExisting is false', async () => {
    const githubContext = createMockGithubContext({
      existingFiles: {
        '.editorconfig': 'root = true\n'
      }
    });

    const previewWithoutReplace = await previewAutomationPr({
      repoInput: 'mock/repo',
      files: [{ path: '.editorconfig', content: 'root = true\n' }],
      replaceExisting: false,
      githubContext
    });

    assert.equal(previewWithoutReplace.canProceed, false);
    assert.ok(previewWithoutReplace.conflicts.includes('.editorconfig'));

    const previewWithReplace = await previewAutomationPr({
      repoInput: 'mock/repo',
      files: [{ path: '.editorconfig', content: 'root = true\n' }],
      replaceExisting: true,
      githubContext
    });

    assert.equal(previewWithReplace.canProceed, true);
    assert.equal(previewWithReplace.conflicts.length, 0);
  });

  it('warns when GitHub App lacks workflows: write permission for workflow files in preview', async () => {
    const githubContext = createMockGithubContext({
      workflowPermission: 'read'
    });

    const preview = await previewAutomationPr({
      repoInput: 'mock/repo',
      files: [{ path: '.github/workflows/node-ci.yml', content: 'name: CI\n' }],
      githubContext
    });

    assert.ok(preview.requiresWorkflowPermission);
    assert.equal(preview.hasWorkflowPermission, false);
    assert.ok(preview.workflowWarning.includes('Workflows (Read & write)'));
  });

  it('creates an authorized pull request with generated automation files', async () => {
    const githubContext = createMockGithubContext({
      workflowPermission: 'write'
    });

    const result = await createAutomationPullRequest({
      repoInput: 'mock/repo',
      files: [
        { path: '.editorconfig', content: 'root = true\n' },
        { path: '.github/workflows/node-ci.yml', content: 'name: Node CI\n' }
      ],
      replaceExisting: true,
      githubContext
    });

    assert.equal(result.pullNumber, 42);
    assert.ok(result.createdFiles.includes('.editorconfig'));
    assert.ok(result.createdFiles.includes('.github/workflows/node-ci.yml'));
  });

  it('refuses to commit workflow files when GitHub App lacks workflows: write permission', async () => {
    const githubContext = createMockGithubContext({
      workflowPermission: 'read'
    });

    await assert.rejects(
      () => createAutomationPullRequest({
        repoInput: 'mock/repo',
        files: [{ path: '.github/workflows/node-ci.yml', content: 'name: Node CI\n' }],
        githubContext
      }),
      (err) => err.statusCode === 403 && err.code === 'WORKFLOW_PERMISSION_REQUIRED'
    );
  });

  it('allows committing non-workflow files even when workflows permission is missing', async () => {
    const githubContext = createMockGithubContext({
      workflowPermission: 'read'
    });

    const result = await createAutomationPullRequest({
      repoInput: 'mock/repo',
      files: [{ path: '.editorconfig', content: 'root = true\n' }],
      githubContext
    });

    assert.equal(result.pullNumber, 42);
    assert.ok(result.createdFiles.includes('.editorconfig'));
  });

  it('rejects PR creation on archived repositories', async () => {
    const githubContext = createMockGithubContext({ isArchived: true });

    await assert.rejects(
      () => createAutomationPullRequest({
        repoInput: 'mock/repo',
        files: [{ path: '.editorconfig', content: 'root = true\n' }],
        githubContext
      }),
      (err) => err.statusCode === 400 && err.code === 'REPOSITORY_ARCHIVED'
    );
  });
});

describe('Automation HTTP Integration Endpoints', () => {
  const githubContext = {
    isAppConfigured: true,
    createPublicOctokit: () => ({
      rest: {
        repos: {
          get: async () => ({
            data: { full_name: 'mock/repo', default_branch: 'main', archived: false }
          }),
          getContent: async () => ({ data: [] })
        }
      }
    }),
    resolveRepoInstallation: async () => ({
      installed: true,
      octokit: {
        rest: {
          repos: {
            get: async () => ({
              data: { full_name: 'mock/repo', default_branch: 'main', archived: false }
            }),
            getContent: async () => ({ data: [] }),
            getBranch: async () => ({ data: { commit: { sha: 'sha-123' } } }),
            getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }),
            createOrUpdateFileContents: async () => ({ data: { commit: { sha: 'commit-sha' } } })
          },
          git: {
            createRef: async () => ({ data: {} })
          },
          pulls: {
            create: async () => ({ data: { number: 99, html_url: 'https://github.com/mock/repo/pull/99' } })
          }
        }
      },
      installation: {
        id: 777,
        permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' }
      }
    })
  };

  const createUserClient = (token) => ({
    rest: {
      users: {
        getAuthenticated: async () => {
          if (token === 'invalid_token') {
            const err = new Error('Bad credentials');
            err.status = 401;
            throw err;
          }
          return { data: { login: 'authorized-dev', type: 'User' } };
        }
      }
    }
  });

  const { app } = createApp({ githubContext, createUserClient });

  it('GET /api/automation/checks returns supported checks', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/automation/checks`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.checks));
      assert.equal(data.checks.length, 8);
    } finally {
      server.close();
    }
  });

  it('GET /api/automation/templates returns supported templates', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/automation/templates`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.templates));
      assert.equal(data.templates.length, 10);
    } finally {
      server.close();
    }
  });

  it('POST /api/automation/generate generates configuration content', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/automation/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'editorconfig' })
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.filename, '.editorconfig');
      assert.ok(data.content.includes('root = true'));
    } finally {
      server.close();
    }
  });

  it('POST /api/automation/trigger-pr enforces Bearer token authentication', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/automation/trigger-pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'mock/repo', files: [{ path: '.editorconfig', content: 'root = true' }] })
      });
      assert.equal(unauthRes.status, 401);

      const authRes = await fetch(`http://127.0.0.1:${port}/api/automation/trigger-pr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid_token_123'
        },
        body: JSON.stringify({ repo: 'mock/repo', files: [{ path: '.editorconfig', content: 'root = true' }] })
      });
      assert.equal(authRes.status, 201);
      const data = await authRes.json();
      assert.equal(data.pullNumber, 99);
      assert.equal(data.caller, 'authorized-dev');
    } finally {
      server.close();
    }
  });
});
