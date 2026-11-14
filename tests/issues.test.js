import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorizeIssue,
  evaluatePullRequestQuality,
  classifyPullRequestSize,
  formatWelcomeMessage,
  findDuplicateCandidates,
  evaluateStaleIssue,
  generateReleaseNotesFromPulls,
  parseOpenWorkersConfig,
  ISSUE_CATEGORIES,
  PR_SIZE_THRESHOLDS
} from '../src/modules/issues/engine.js';
import {
  listIssueCapabilities,
  analyzeIssue,
  findDuplicateIssues,
  inspectStaleIssues,
  previewIssueLabels,
  applyIssueLabels
} from '../src/modules/issues/issueService.js';
import {
  analyzePullRequest,
  classifyPullRequest,
  generateReleaseNotes,
  previewPullRequestAction,
  executePullRequestAction
} from '../src/modules/issues/pullRequestService.js';
import {
  handleIssueEvent,
  handlePullRequestEvent,
  registerAutomationHandlers
} from '../src/modules/issues/automationService.js';
import {
  hasMarker,
  appendMarker,
  isBotSender,
  createDeliveryTracker,
  MARKERS
} from '../src/core/events/idempotency.js';
import { EventDispatcher } from '../src/core/events/dispatcher.js';
import { createApp } from '../src/server.js';

// Mock GitHub context helper for tests
function createMockGitHubContext({
  permission = 'write',
  isInstalled = true,
  issueNotFound = false,
  pullNotFound = false,
  forbidden = false,
  appLacksIssuesPermission = false,
  configContent = null
} = {}) {
  const labelsStore = new Map();
  const commentsStore = [];

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
            private: false
          }
        }),
        getContent: async ({ path }) => {
          if (configContent && (path === '.github/open-workers.yml' || path === '.github/open-workers.yaml')) {
            return {
              data: {
                type: 'file',
                content: Buffer.from(configContent).toString('base64')
              }
            };
          }
          const err = new Error('Not found');
          err.status = 404;
          throw err;
        },
        getCollaboratorPermissionLevel: async () => {
          if (forbidden) {
            const err = new Error('Access denied');
            err.status = 403;
            throw err;
          }
          return { data: { permission } };
        }
      },
      issues: {
        get: async ({ issue_number }) => {
          if (issueNotFound) {
            const err = new Error('Issue not found');
            err.status = 404;
            throw err;
          }
          if (issue_number === 999) {
            // Simulate a pull request returned via issues API
            return {
              data: {
                number: 999,
                title: 'A pull request as issue',
                body: 'PR body',
                state: 'open',
                html_url: 'https://github.com/owner/project/pull/999',
                labels: ['enhancement'],
                user: { login: 'author', type: 'User' },
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-02T00:00:00Z',
                pull_request: { url: 'https://api.github.com/repos/owner/project/pulls/999' }
              }
            };
          }
          return {
            data: {
              number: issue_number,
              title: 'Unexpected server crash on startup',
              body: '### Steps to reproduce\n1. Run npm start\n2. Crash with error code 1',
              state: 'open',
              html_url: `https://github.com/owner/project/issues/${issue_number}`,
              labels: labelsStore.get(issue_number) || [{ name: 'bug' }],
              user: { login: 'testuser', type: 'User' },
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z'
            }
          };
        },
        listForRepo: async () => ({
          data: [
            {
              number: 10,
              title: 'Crash on startup when port is in use',
              body: 'Server crash on startup with EADDRINUSE error',
              state: 'open',
              html_url: 'https://github.com/owner/project/issues/10',
              labels: [{ name: 'bug' }],
              updated_at: '2026-01-01T00:00:00Z'
            },
            {
              number: 11,
              title: 'Documentation typo in getting started',
              body: 'Spelling error in readme file instructions',
              state: 'open',
              html_url: 'https://github.com/owner/project/issues/11',
              labels: [{ name: 'documentation' }],
              updated_at: new Date(Date.now() - 40 * 86400000).toISOString() // 40 days ago
            },
            {
              number: 12,
              title: 'Critical CVE vulnerability in parser',
              body: 'Buffer overflow exploit advisory',
              state: 'open',
              html_url: 'https://github.com/owner/project/issues/12',
              labels: [{ name: 'security' }],
              updated_at: new Date(Date.now() - 60 * 86400000).toISOString()
            }
          ]
        }),
        listLabelsForRepo: async () => ({
          data: [{ name: 'bug' }, { name: 'enhancement' }, { name: 'documentation' }]
        }),
        addLabels: async ({ issue_number, labels }) => {
          if (appLacksIssuesPermission) {
            const err = new Error('Resource not accessible by integration');
            err.status = 403;
            throw err;
          }
          const existing = labelsStore.get(issue_number) || [];
          const merged = [...existing, ...labels.map((l) => ({ name: l }))];
          labelsStore.set(issue_number, merged);
          return { data: merged };
        },
        removeLabel: async ({ issue_number, name }) => {
          const existing = labelsStore.get(issue_number) || [];
          labelsStore.set(issue_number, existing.filter((l) => l.name !== name));
          return { data: {} };
        },
        listComments: async () => ({
          data: commentsStore
        }),
        createComment: async ({ body }) => {
          if (appLacksIssuesPermission) {
            const err = new Error('Resource not accessible by integration');
            err.status = 403;
            throw err;
          }
          const comment = { id: commentsStore.length + 1, body, html_url: 'https://github.com/comment/1' };
          commentsStore.push(comment);
          return { data: comment };
        }
      },
      pulls: {
        get: async ({ pull_number }) => {
          if (pullNotFound) {
            const err = new Error('PR not found');
            err.status = 404;
            throw err;
          }
          return {
            data: {
              number: pull_number,
              title: 'feat: add user profile page',
              body: '## Description\nImplements user profile page.\n\nFixes #42\n\n## Testing\nTested with npm test and manual verification.\n\n- [x] Tests added\n- [ ] Update docs',
              state: 'open',
              draft: false,
              html_url: `https://github.com/owner/project/pull/${pull_number}`,
              user: { login: 'alice', type: 'User' },
              author_association: 'FIRST_TIME_CONTRIBUTOR',
              additions: 120,
              deletions: 30,
              changed_files: 4,
              labels: labelsStore.get(pull_number) || [{ name: 'enhancement' }]
            }
          };
        },
        listFiles: async () => ({
          data: [
            { filename: 'src/profile.js', additions: 100, deletions: 20 },
            { filename: 'package-lock.json', additions: 20, deletions: 10 }
          ]
        }),
        list: async () => ({
          data: [
            {
              number: 1,
              title: 'feat: initial server implementation',
              body: 'Initial server code',
              merged_at: '2026-01-01T00:00:00Z',
              html_url: 'https://github.com/owner/project/pull/1',
              user: { login: 'maintainer' },
              labels: ['feature']
            },
            {
              number: 2,
              title: 'fix: resolve memory leak in worker',
              body: 'Fixes leak',
              merged_at: '2026-01-02T00:00:00Z',
              html_url: 'https://github.com/owner/project/pull/2',
              user: { login: 'bob' },
              labels: ['bug']
            },
            {
              number: 3,
              title: 'chore: unmerged experimental branch',
              body: 'Work in progress',
              merged_at: null, // Not merged!
              html_url: 'https://github.com/owner/project/pull/3',
              user: { login: 'charlie' },
              labels: []
            }
          ]
        })
      }
    }
  };

  return {
    isAppConfigured: true,
    isWebhookConfigured: true,
    appSlug: 'open-workers',
    resolveRepoInstallation: async () => ({
      installed: isInstalled,
      installation: isInstalled ? { id: 12345 } : null,
      octokit: isInstalled ? mockOctokit : null
    }),
    getInstallationOctokit: async () => mockOctokit,
    createPublicOctokit: () => mockOctokit,
    getInstallationUrl: () => 'https://github.com/apps/open-workers/installations/new',
    mockOctokit,
    commentsStore
  };
}

describe('PR & Issue Management Engine — Issue Categorization', () => {
  it('categorizes bug reports accurately with reproduction details', () => {
    const issue = {
      number: 1,
      title: 'Crash on initialization with TypeError',
      body: 'Steps to reproduce:\n1. run app\n2. unexpected failure occurs'
    };
    const res = categorizeIssue(issue);
    assert.equal(res.primaryCategory, 'bug');
    assert.ok(res.suggestedCategories.includes('bug'));
    assert.ok(res.suggestedLabels.includes('bug'));
    assert.equal(res.confidence, 'high');
    assert.equal(res.isSecuritySensitive, false);
  });

  it('categorizes feature requests accurately', () => {
    const issue = {
      number: 2,
      title: 'Feature proposal: Add webhook support for issues',
      body: 'I would like to propose adding support for incoming webhooks.'
    };
    const res = categorizeIssue(issue);
    assert.equal(res.primaryCategory, 'feature');
    assert.ok(res.suggestedLabels.includes('enhancement'));
  });

  it('identifies security vulnerability mentions and flags private disclosure advice', () => {
    const issue = {
      number: 3,
      title: 'Remote code execution vulnerability via CVE-2026-9999',
      body: 'Found an exploit payload leading to RCE in parser.'
    };
    const res = categorizeIssue(issue);
    assert.equal(res.primaryCategory, 'security');
    assert.equal(res.isSecuritySensitive, true);
    assert.ok(res.reasons.some((r) => r.includes('coordinated private disclosure')));
    assert.equal(res.requiresConfirmation, true);
  });

  it('handles empty descriptions and ambiguous titles with low confidence', () => {
    const issue = {
      number: 4,
      title: 'Help',
      body: ''
    };
    const res = categorizeIssue(issue);
    assert.equal(res.confidence, 'low');
    assert.equal(res.requiresConfirmation, true);
  });
});

describe('PR Quality & Size Evaluation', () => {
  it('evaluates pull request quality and identifies incomplete checklists and missing descriptions', () => {
    const incompletePr = {
      number: 5,
      title: 'update code',
      body: 'TODO',
      draft: false,
      additions: 10,
      deletions: 5
    };
    const res = evaluatePullRequestQuality(incompletePr);
    assert.equal(res.status, 'needs_attention');
    const descCheck = res.checks.find((c) => c.id === 'description');
    assert.equal(descCheck.status, 'missing');
    const titleCheck = res.checks.find((c) => c.id === 'title_convention');
    assert.equal(titleCheck.status, 'needs_attention');
  });

  it('passes comprehensive PRs adhering to standards', () => {
    const completePr = {
      number: 6,
      title: 'feat(api): add issue endpoints',
      body: 'Implements REST API routes.\n\nFixes #12\n\nTested with npm test.\n\n- [x] Tests passing\n- [x] Docs updated',
      draft: false,
      additions: 40,
      deletions: 10
    };
    const res = evaluatePullRequestQuality(completePr);
    assert.equal(res.status, 'passed');
    const checklist = res.checks.find((c) => c.id === 'checklist');
    assert.equal(checklist.status, 'passed');
    assert.equal(checklist.incompleteTasks, 0);
  });

  it('classifies PR size accurately across XS to XL boundaries', () => {
    assert.equal(classifyPullRequestSize({ additions: 0, deletions: 0 }).classification, 'NONE');
    assert.equal(classifyPullRequestSize({ additions: 5, deletions: 3 }).classification, 'XS');
    assert.equal(classifyPullRequestSize({ additions: 25, deletions: 10 }).classification, 'S');
    assert.equal(classifyPullRequestSize({ additions: 100, deletions: 50 }).classification, 'M');
    assert.equal(classifyPullRequestSize({ additions: 250, deletions: 100 }).classification, 'L');
    assert.equal(classifyPullRequestSize({ additions: 400, deletions: 200 }).classification, 'XL');
  });

  it('identifies lockfiles inflating line counts', () => {
    const size = classifyPullRequestSize({
      additions: 600,
      deletions: 100,
      fileNames: ['src/index.js', 'package-lock.json']
    });
    assert.equal(size.hasGeneratedFiles, true);
    assert.ok(size.notice.includes('package-lock.json'));
  });
});

describe('Contributor Welcome & Idempotency', () => {
  it('formats welcome messages with variable substitution and appends idempotency marker', () => {
    const msg = formatWelcomeMessage({
      username: 'alice',
      repo: 'owner/project'
    });
    assert.ok(msg.includes('@alice'));
    assert.ok(msg.includes('owner/project'));
    assert.ok(hasMarker(msg, MARKERS.WELCOME));
  });

  it('prevents duplicate welcome markers using appendMarker', () => {
    const base = 'Hello <!-- open-workers:welcome -->';
    const appended = appendMarker(base, MARKERS.WELCOME);
    assert.equal(appended, base);
  });

  it('detects bot accounts accurately to prevent comment loops', () => {
    assert.equal(isBotSender({ type: 'Bot', login: 'dependabot[bot]' }), true);
    assert.equal(isBotSender({ type: 'User', login: 'open-workers[bot]' }), true);
    assert.equal(isBotSender({ type: 'User', login: 'developer-jane' }), false);
    assert.equal(isBotSender(null), false);
  });

  it('maintains bounded delivery cache', () => {
    const tracker = createDeliveryTracker(2);
    tracker.add('del-1');
    tracker.add('del-2');
    assert.equal(tracker.has('del-1'), true);
    tracker.add('del-3');
    assert.equal(tracker.has('del-1'), false); // Evicted oldest
    assert.equal(tracker.has('del-3'), true);
  });
});

describe('Duplicates, Stale Issues & Release Notes', () => {
  it('finds duplicate candidate issues sharing title keywords', () => {
    const target = { number: 1, title: 'Server crash on startup with port error' };
    const candidates = [
      { number: 2, title: 'Crash on startup when port is in use' },
      { number: 3, title: 'Add dark mode theme to website' }
    ];
    const matches = findDuplicateCandidates(target, candidates);
    assert.ok(matches.length > 0);
    assert.equal(matches[0].number, 2);
    assert.ok(matches[0].similarityScore > 30);
  });

  it('evaluates stale issues and protects security issues or exempt labels', () => {
    const staleIssue = {
      number: 10,
      title: 'Old feature discussion',
      updated_at: new Date(Date.now() - 45 * 86400000).toISOString(),
      labels: []
    };
    const res1 = evaluateStaleIssue(staleIssue, { daysInactive: 30 });
    assert.equal(res1.isStale, true);

    const pinnedIssue = {
      number: 11,
      title: 'Important roadmap',
      updated_at: new Date(Date.now() - 45 * 86400000).toISOString(),
      labels: [{ name: 'pinned' }]
    };
    const res2 = evaluateStaleIssue(pinnedIssue, { daysInactive: 30 });
    assert.equal(res2.isStale, false);
    assert.equal(res2.isExempt, true);
  });

  it('generates categorized release notes from merged pull requests only', () => {
    const pulls = [
      { number: 1, title: 'feat: add issue triage', user: { login: 'alice' }, merged_at: '2026-01-01' },
      { number: 2, title: 'fix: resolve race condition', user: { login: 'bob' }, merged_at: '2026-01-02' }
    ];
    const notes = generateReleaseNotesFromPulls({ pulls, releaseTitle: 'v1.3.0 Release' });
    assert.ok(notes.includes('# v1.3.0 Release'));
    assert.ok(notes.includes('Features & Enhancements'));
    assert.ok(notes.includes('Bug Fixes'));
    assert.ok(notes.includes('feat: add issue triage ([#1](#1)) by @alice'));
  });

  it('parses repository configuration safely', () => {
    const configStr = 'version: 1\nenabled: true\nissues:\n  labeling:\n    enabled: true\npullRequests:\n  welcome:\n    enabled: true';
    const config = parseOpenWorkersConfig(configStr);
    assert.equal(config.enabled, true);
    assert.equal(config.issues.labeling.enabled, true);
    assert.equal(config.pullRequests.welcome.enabled, true);
  });
});

describe('Issue & PR Services (Unit & Permission Safety)', () => {
  it('analyzes issue and detects when item is a pull request', async () => {
    const ctx = createMockGitHubContext();
    const res = await analyzeIssue({ repoInput: 'owner/project', issueNumber: 999, githubContext: ctx });
    assert.equal(res.issue.isPullRequest, true);
    assert.ok(res.notice.includes('Pull Request Checks'));
  });

  it('finds duplicate issues via GitHub API scan', async () => {
    const ctx = createMockGitHubContext();
    const res = await findDuplicateIssues({ repoInput: 'owner/project', issueNumber: 1, candidateLimit: 10, githubContext: ctx });
    assert.equal(res.targetIssue.number, 1);
    assert.ok(Array.isArray(res.suggestions));
  });

  it('inspects stale issues without flagging security issues as stale', async () => {
    const ctx = createMockGitHubContext();
    const res = await inspectStaleIssues({ repoInput: 'owner/project', daysInactive: 30, githubContext: ctx });
    assert.ok(res.scannedIssues >= 1);
    // Issue #12 has label security -> must not be marked stale
    const secIssue = res.staleIssues.find((s) => s.issueNumber === 12);
    assert.equal(secIssue, undefined);
  });

  it('previews issue labels and identifies missing repo labels', async () => {
    const ctx = createMockGitHubContext();
    const preview = await previewIssueLabels({
      repoInput: 'owner/project',
      issueNumber: 1,
      labelsToAdd: ['bug', 'new-custom-label'],
      githubContext: ctx
    });
    assert.ok(preview.labelsAlreadyPresent.includes('bug'));
    assert.ok(preview.missingFromRepo.includes('new-custom-label'));
  });

  it('applies issue labels when authorized with write permissions', async () => {
    const ctx = createMockGitHubContext();
    const res = await applyIssueLabels({
      repoInput: 'owner/project',
      issueNumber: 1,
      labelsToAdd: ['needs-review'],
      authorization: 'Bearer test_token_123',
      githubContext: ctx,
      createUserClient: () => ({
        rest: {
          users: { getAuthenticated: async () => ({ data: { login: 'admin-user', type: 'User' } }) }
        }
      })
    });
    assert.equal(res.success, true);
    assert.ok(res.appliedLabels.includes('needs-review'));
  });

  it('refuses label mutation when caller has read-only permission (403)', async () => {
    const ctx = createMockGitHubContext({ permission: 'read' });
    await assert.rejects(
      async () => {
        await applyIssueLabels({
          repoInput: 'owner/project',
          issueNumber: 1,
          labelsToAdd: ['bug'],
          authorization: 'Bearer read_only_token',
          githubContext: ctx,
          createUserClient: () => ({
            rest: {
              users: { getAuthenticated: async () => ({ data: { login: 'viewer', type: 'User' } }) }
            }
          })
        });
      },
      (err) => err.statusCode === 403
    );
  });

  it('surfaces explicit guidance when GitHub App lacks issues: write permission', async () => {
    const ctx = createMockGitHubContext({ appLacksIssuesPermission: true });
    await assert.rejects(
      async () => {
        await applyIssueLabels({
          repoInput: 'owner/project',
          issueNumber: 1,
          labelsToAdd: ['bug'],
          authorization: 'Bearer valid_token',
          githubContext: ctx,
          createUserClient: () => ({
            rest: {
              users: { getAuthenticated: async () => ({ data: { login: 'admin-user', type: 'User' } }) }
            }
          })
        });
      },
      (err) => err.statusCode === 403 && err.message.includes('issues: write')
    );
  });
});

describe('Pull Request Service & Actions', () => {
  it('analyzes pull request quality, checklist items and size classification', async () => {
    const ctx = createMockGitHubContext();
    const res = await analyzePullRequest({ repoInput: 'owner/project', pullNumber: 15, githubContext: ctx });
    assert.equal(res.pullRequest.number, 15);
    assert.equal(res.size.classification, 'M');
    assert.equal(res.quality.status, 'warning');
  });

  it('previews and executes size labeling on a pull request', async () => {
    const ctx = createMockGitHubContext();
    const preview = await previewPullRequestAction({
      repoInput: 'owner/project',
      pullNumber: 15,
      action: 'apply_size_label',
      githubContext: ctx
    });
    assert.equal(preview.action, 'apply_size_label');
    assert.equal(preview.targetLabel, 'size/M');

    const exec = await executePullRequestAction({
      repoInput: 'owner/project',
      pullNumber: 15,
      action: 'apply_size_label',
      authorization: 'Bearer valid_token',
      githubContext: ctx,
      createUserClient: () => ({
        rest: {
          users: { getAuthenticated: async () => ({ data: { login: 'admin-user', type: 'User' } }) }
        }
      })
    });
    assert.equal(exec.success, true);
    assert.equal(exec.appliedLabel, 'size/M');
  });

  it('posts welcome comment and rejects duplicate welcome execution with 409', async () => {
    const ctx = createMockGitHubContext();
    const exec = await executePullRequestAction({
      repoInput: 'owner/project',
      pullNumber: 15,
      action: 'post_welcome',
      authorization: 'Bearer valid_token',
      githubContext: ctx,
      createUserClient: () => ({
        rest: {
          users: { getAuthenticated: async () => ({ data: { login: 'admin-user', type: 'User' } }) }
        }
      })
    });
    assert.equal(exec.success, true);

    // Second call must detect marker and reject with 409
    await assert.rejects(
      async () => {
        await executePullRequestAction({
          repoInput: 'owner/project',
          pullNumber: 15,
          action: 'post_welcome',
          authorization: 'Bearer valid_token',
          githubContext: ctx,
          createUserClient: () => ({
            rest: {
              users: { getAuthenticated: async () => ({ data: { login: 'admin-user', type: 'User' } }) }
            }
          })
        });
      },
      (err) => err.statusCode === 409 && err.code === 'ALREADY_WELCOMED'
    );
  });
});

describe('Opt-In Webhook Automation & Event Dispatcher', () => {
  it('event dispatcher dispatches events and isolates handler errors safely', async () => {
    const dispatcher = new EventDispatcher();
    let handled = false;
    dispatcher.register('issues', async (payload) => {
      handled = true;
      return { ok: true, number: payload.issue?.number };
    });
    dispatcher.register('issues', async () => {
      throw new Error('Handler fail test');
    });

    const res = await dispatcher.dispatch({
      name: 'issues',
      payload: { action: 'opened', issue: { number: 42 } }
    });
    assert.equal(res.handled, true);
    assert.equal(handled, true);
    assert.equal(res.results.length, 2);
    assert.equal(res.results[0].success, true);
    assert.equal(res.results[1].success, false);
  });

  it('ignores webhook events from bot senders to prevent loops', async () => {
    const res = await handleIssueEvent({
      action: 'opened',
      issue: { number: 1 },
      repository: { name: 'project', owner: { login: 'owner' } },
      sender: { type: 'Bot', login: 'some-bot[bot]' }
    });
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'BOT_SENDER_IGNORED');
  });

  it('skips webhook actions when repository has not opted in via config', async () => {
    const ctx = createMockGitHubContext({ configContent: null }); // No .github/open-workers.yml
    const res = await handlePullRequestEvent(
      {
        action: 'opened',
        pull_request: { number: 20, additions: 10, deletions: 5, author_association: 'FIRST_TIME_CONTRIBUTOR' },
        repository: { name: 'project', owner: { login: 'owner' } },
        installation: { id: 12345 }
      },
      { githubContext: ctx }
    );
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'OPT_IN_REQUIRED');
  });

  it('executes welcome comment and size labeling when repository config opts in', async () => {
    const configYml = 'enabled: true\npullRequests:\n  welcome:\n    enabled: true\n  sizeLabeling:\n    enabled: true';
    const ctx = createMockGitHubContext({ configContent: configYml });

    const res = await handlePullRequestEvent(
      {
        action: 'opened',
        pull_request: {
          number: 25,
          additions: 30,
          deletions: 10,
          author_association: 'FIRST_TIME_CONTRIBUTOR',
          user: { login: 'newbie', type: 'User' }
        },
        repository: { name: 'project', full_name: 'owner/project', owner: { login: 'owner' } },
        installation: { id: 12345 }
      },
      { githubContext: ctx }
    );

    assert.equal(res.handled, true);
    assert.ok(res.results.some((r) => r.action === 'posted_welcome'));
    assert.ok(res.results.some((r) => r.action === 'applied_size_label' && r.applied === 'size/S'));
  });
});

describe('HTTP Integration Endpoints for PRs & Issues', () => {
  let server;
  let baseUrl;

  before(async () => {
    const githubContext = createMockGitHubContext();
    const { app } = createApp({
      githubContext,
      silentConfig: true,
      createUserClient: () => ({
        rest: {
          users: { getAuthenticated: async () => ({ data: { login: 'test-admin', type: 'User' } }) }
        }
      })
    });
    server = await new Promise((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/issues/capabilities returns available features and categories', async () => {
    const res = await fetch(`${baseUrl}/api/issues/capabilities`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.categories));
    assert.ok(Array.isArray(data.features));
  });

  it('POST /api/issues/analyze analyzes issue and returns categorization', async () => {
    const res = await fetch(`${baseUrl}/api/issues/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', issueNumber: 1 })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.issue.number, 1);
    assert.equal(data.categorization.primaryCategory, 'bug');
  });

  it('POST /api/issues/duplicates returns similar candidate issues', async () => {
    const res = await fetch(`${baseUrl}/api/issues/duplicates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', issueNumber: 1 })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.suggestions));
  });

  it('POST /api/issues/stale lists inactive issues', async () => {
    const res = await fetch(`${baseUrl}/api/issues/stale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', daysInactive: 30 })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.staleCount === 'number');
  });

  it('POST /api/issues/preview-labels previews label additions', async () => {
    const res = await fetch(`${baseUrl}/api/issues/preview-labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', issueNumber: 1, labels: ['bug', 'enhancement'] })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.issueNumber, 1);
  });

  it('POST /api/issues/apply-labels rejects unauthorized requests (401)', async () => {
    const res = await fetch(`${baseUrl}/api/issues/apply-labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', issueNumber: 1, labels: ['bug'] })
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/issues/apply-labels succeeds when caller is authorized', async () => {
    const res = await fetch(`${baseUrl}/api/issues/apply-labels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_token_123'
      },
      body: JSON.stringify({ repo: 'owner/project', issueNumber: 1, labels: ['needs-review'] })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('POST /api/pulls/analyze evaluates pull request quality and size', async () => {
    const res = await fetch(`${baseUrl}/api/pulls/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', pullNumber: 15 })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.pullRequest.number, 15);
    assert.equal(data.size.classification, 'M');
  });

  it('POST /api/pulls/size classifies PR size', async () => {
    const res = await fetch(`${baseUrl}/api/pulls/size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', pullNumber: 15 })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.size.classification, 'M');
  });

  it('POST /api/pulls/release-notes compiles merged pull requests into release notes', async () => {
    const res = await fetch(`${baseUrl}/api/pulls/release-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', releaseTitle: 'v1.4.0' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mergedCount, 2);
    assert.ok(data.markdown.includes('# v1.4.0'));
  });

  it('POST /api/pulls/preview-action previews size label and welcome comment', async () => {
    const res = await fetch(`${baseUrl}/api/pulls/preview-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'owner/project', pullNumber: 15, action: 'apply_size_label' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.action, 'apply_size_label');
    assert.equal(data.targetLabel, 'size/M');
  });

  it('POST /api/pulls/execute-action executes authorized PR action', async () => {
    const res = await fetch(`${baseUrl}/api/pulls/execute-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_token_123'
      },
      body: JSON.stringify({ repo: 'owner/project', pullNumber: 15, action: 'apply_size_label' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.appliedLabel, 'size/M');
  });
});
