/**
 * Open Workers — Unified Dashboard Test Suite
 *
 * Covers Cross-Module Findings Normalization, Priority Aggregation,
 * Coordinator Orchestration, Privacy Access Enforcement, Partial Error Isolation,
 * and Dashboard API Endpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLicensingFindings,
  normalizeCommunityFindings,
  normalizeSecurityFindings,
  normalizeDocumentationFindings,
  normalizeIssuesFindings,
  normalizeAutomationFindings,
  aggregateDashboardFindings
} from '../src/core/dashboard/findings.js';
import { analyzeRepositoryDashboard } from '../src/core/dashboard/coordinator.js';
import { ServiceError } from '../src/services/licenseService.js';
import { createApp } from '../src/server.js';

describe('Dashboard Findings Normalizer & Aggregator', () => {
  it('normalizes licensing findings correctly for licensed repository', () => {
    const report = {
      repository: 'octocat/Hello-World',
      hasLicense: true,
      license: {
        spdx_id: 'MIT',
        name: 'MIT License'
      },
      files: ['LICENSE'],
      recommendations: []
    };

    const norm = normalizeLicensingFindings(report, 'octocat/Hello-World');
    assert.equal(norm.module, 'licensing');
    assert.equal(norm.status, 'available');
    assert.ok(norm.summary.includes('MIT'));
    assert.ok(norm.findings.some((f) => f.id === 'license-file' && f.status === 'present'));
    assert.equal(norm.recommendations.length, 0);
  });

  it('normalizes licensing findings with high-priority recommendation for missing license', () => {
    const report = {
      repository: 'octocat/No-License',
      hasLicense: false,
      files: [],
      recommendations: [{ message: 'Add an open source license.' }]
    };

    const norm = normalizeLicensingFindings(report, 'octocat/No-License');
    assert.equal(norm.status, 'warning');
    assert.ok(norm.summary.includes('No open source license'));
    assert.equal(norm.recommendations.length, 1);
    assert.equal(norm.recommendations[0].priority, 'high');
    assert.ok(norm.recommendations[0].actionUrl.includes('octocat%2FNo-License'));
  });

  it('normalizes community findings with scores and missing standards', () => {
    const audit = {
      repository: 'octocat/Hello-World',
      score: 60,
      checks: [
        { id: 'contributing', name: 'Contribution Guide', status: 'present' },
        { id: 'code_of_conduct', name: 'Code of Conduct', status: 'missing' },
        { id: 'security', name: 'Security Policy', status: 'missing' }
      ]
    };

    const norm = normalizeCommunityFindings(audit, 'octocat/Hello-World');
    assert.equal(norm.module, 'community');
    assert.equal(norm.score, 60);
    assert.equal(norm.status, 'warning');
    assert.ok(norm.recommendations.length >= 2);
    assert.ok(norm.recommendations.some((r) => r.title.includes('Code of Conduct')));
  });

  it('normalizes security findings with score and prioritized recommendations', () => {
    const audit = {
      repository: 'octocat/Hello-World',
      score: 50,
      checks: [
        { id: 'security_md', name: 'Security Policy', status: 'missing' },
        { id: 'dependabot', name: 'Dependabot', status: 'missing' }
      ]
    };

    const norm = normalizeSecurityFindings(audit, 'octocat/Hello-World');
    assert.equal(norm.module, 'security');
    assert.equal(norm.score, 50);
    assert.equal(norm.status, 'warning');
    assert.ok(norm.recommendations.some((r) => r.priority === 'high' && r.title.includes('Security Policy')));
    assert.ok(norm.recommendations.some((r) => r.priority === 'medium' && r.title.includes('Dependabot')));
  });

  it('normalizes documentation findings with score and missing readme recommendation', () => {
    const audit = {
      repository: 'octocat/Hello-World',
      score: 30,
      checks: [
        { id: 'readme_exists', name: 'README File', status: 'missing' },
        { id: 'license_badge', name: 'License Badge', status: 'missing' }
      ]
    };

    const norm = normalizeDocumentationFindings(audit, 'octocat/Hello-World');
    assert.equal(norm.module, 'documentation');
    assert.equal(norm.score, 30);
    assert.equal(norm.status, 'warning');
    assert.ok(norm.recommendations.some((r) => r.priority === 'high' && r.title.includes('README')));
  });

  it('normalizes issues findings with open count, templates, and stale issues', () => {
    const staleResult = {
      staleCount: 4,
      staleIssues: [
        { number: 12, title: 'Old issue', daysInactive: 45, htmlUrl: 'https://github.com/octocat/Hello-World/issues/12' }
      ]
    };
    const repoData = {
      open_issues_count: 5,
      has_issues: true
    };

    const norm = normalizeIssuesFindings(staleResult, repoData, 'octocat/Hello-World');
    assert.equal(norm.module, 'issues');
    assert.ok(norm.summary.includes('5 open'));
    assert.ok(norm.summary.includes('4 stale'));
    assert.ok(norm.recommendations.some((r) => r.priority === 'medium' && r.title.includes('Stale Issues')));
  });

  it('normalizes automation findings with setup score and missing CI recommendations', () => {
    const audit = {
      repository: 'octocat/Hello-World',
      setupScore: 40,
      checks: [
        { id: 'ci_workflow', name: 'CI Workflow', status: 'missing' },
        { id: 'editorconfig', name: 'EditorConfig', status: 'missing' }
      ]
    };

    const norm = normalizeAutomationFindings(audit, 'octocat/Hello-World');
    assert.equal(norm.module, 'automation');
    assert.equal(norm.score, 40);
    assert.equal(norm.status, 'warning');
    assert.ok(norm.recommendations.some((r) => r.priority === 'high' && r.title.includes('CI Workflow')));
  });

  it('aggregateDashboardFindings accurately sums metrics and sorts recommendations by severity', () => {
    const modulesMap = {
      licensing: {
        module: 'licensing',
        status: 'warning',
        score: null,
        findings: [{ id: 'lic' }],
        recommendations: [
          { module: 'Licensing', priority: 'high', title: 'Add License', actionUrl: '/analyzer.html' }
        ]
      },
      community: {
        module: 'community',
        status: 'warning',
        score: 60,
        findings: [{ id: 'coc' }],
        recommendations: [
          { module: 'Community', priority: 'medium', title: 'Add CoC', actionUrl: '/community.html' }
        ]
      },
      security: {
        module: 'security',
        status: 'available',
        score: 95,
        findings: [{ id: 'sec' }],
        recommendations: [
          { module: 'Security', priority: 'low', title: 'Add Advisory', actionUrl: '/security.html' }
        ]
      },
      documentation: {
        module: 'documentation',
        status: 'available',
        score: 90,
        findings: [{ id: 'doc' }],
        recommendations: []
      },
      issues: {
        module: 'issues',
        status: 'available',
        score: null,
        findings: [{ id: 'iss' }],
        recommendations: []
      },
      automation: {
        module: 'automation',
        status: 'available',
        score: 85,
        findings: [{ id: 'ci' }],
        recommendations: []
      }
    };

    const aggregate = aggregateDashboardFindings(modulesMap);
    assert.equal(aggregate.summary.totalModules, 6);
    assert.equal(aggregate.summary.modulesEvaluated, 6);
    assert.equal(aggregate.summary.modulesNeedingAttention, 2);
    assert.equal(aggregate.summary.totalActionableFindings, 3);
    assert.equal(aggregate.summary.highPriorityFindings, 1);
    assert.equal(aggregate.summary.mediumPriorityFindings, 1);
    assert.equal(aggregate.summary.lowPriorityFindings, 1);

    // Order must be High -> Medium -> Low
    assert.equal(aggregate.prioritizedRecommendations[0].priority, 'high');
    assert.equal(aggregate.prioritizedRecommendations[1].priority, 'medium');
    assert.equal(aggregate.prioritizedRecommendations[2].priority, 'low');
  });

  it('normalizes disabled issues with not_supported execution status', () => {
    const repoData = {
      open_issues_count: 0,
      has_issues: false
    };

    const norm = normalizeIssuesFindings(null, repoData, 'octocat/No-Issues');
    assert.equal(norm.module, 'issues');
    assert.equal(norm.executionStatus, 'not_supported');
    assert.equal(norm.healthStatus, 'healthy');
    assert.equal(norm.status, 'available');
    assert.ok(norm.summary.includes('disabled'));
    assert.equal(norm.recommendations.length, 0);
  });

  it('separates executionStatus and healthStatus across module findings', () => {
    const licNorm = normalizeLicensingFindings({ status: 'licensed', license: { spdx_id: 'MIT' } }, 'octocat/repo');
    assert.equal(licNorm.executionStatus, 'completed');
    assert.equal(licNorm.healthStatus, 'healthy');
    assert.equal(licNorm.status, 'available');

    const secNorm = normalizeSecurityFindings({ checks: [], score: 40 }, 'octocat/repo');
    assert.equal(secNorm.executionStatus, 'completed');
    assert.equal(secNorm.healthStatus, 'critical');
    assert.equal(secNorm.status, 'warning');
  });

  it('deduplicates recommendations by compound module and URL key', () => {
    const modulesMap = {
      community: {
        module: 'community',
        status: 'warning',
        recommendations: [
          { module: 'community', priority: 'medium', title: 'Add CoC', actionUrl: '/community.html?template=coc' },
          { module: 'community', priority: 'medium', title: 'Add CoC', actionUrl: '/community.html?template=coc' }
        ]
      },
      security: {
        module: 'security',
        status: 'warning',
        recommendations: [
          { module: 'security', priority: 'high', title: 'Add CoC', actionUrl: '/security.html?template=sec' }
        ]
      }
    };

    const aggregate = aggregateDashboardFindings(modulesMap);
    assert.equal(aggregate.prioritizedRecommendations.length, 2);
    assert.equal(aggregate.prioritizedRecommendations[0].module, 'security');
    assert.equal(aggregate.prioritizedRecommendations[1].module, 'community');
  });
});

describe('Dashboard Coordinator Orchestration', () => {
  function createMockPublicOctokit() {
    return {
      rest: {
        repos: {
          get: async () => ({
            data: {
              name: 'Hello-World',
              owner: { login: 'octocat' },
              full_name: 'octocat/Hello-World',
              default_branch: 'main',
              description: 'My first repo',
              language: 'JavaScript',
              archived: false,
              private: false,
              html_url: 'https://github.com/octocat/Hello-World',
              updated_at: '2026-11-14T10:00:00Z',
              stargazers_count: 42,
              forks_count: 7,
              open_issues_count: 3
            }
          }),
          getContent: async ({ path }) => {
            if (path === '') {
              return {
                data: [
                  { name: 'README.md', type: 'file' },
                  { name: 'LICENSE', type: 'file' },
                  { name: '.github', type: 'dir' }
                ]
              };
            }
            if (path === '.github') {
              return {
                data: [
                  { name: 'workflows', type: 'dir' },
                  { name: 'dependabot.yml', type: 'file' }
                ]
              };
            }
            if (path === '.github/workflows') {
              return {
                data: [{ name: 'ci.yml', type: 'file' }]
              };
            }
            const err = new Error('Not found');
            err.status = 404;
            throw err;
          },
          getCollaboratorPermissionLevel: async () => ({ data: { permission: 'admin' } })
        },
        issues: {
          listForRepo: async () => ({
            data: [
              { number: 1, title: 'Issue 1', updated_at: '2026-11-10T00:00:00Z', pull_request: undefined }
            ]
          })
        }
      }
    };
  }

  const mockPublicGithubContext = {
    isAppConfigured: true,
    createPublicOctokit: () => createMockPublicOctokit(),
    getPublicOctokit: () => createMockPublicOctokit(),
    resolveRepoInstallation: async () => ({
      installed: true,
      octokit: createMockPublicOctokit(),
      installation: { id: 12345 }
    })
  };

  it('rejects invalid repository input with 400 ServiceError', async () => {
    await assert.rejects(
      async () => {
        await analyzeRepositoryDashboard({
          repoInput: '',
          githubContext: mockPublicGithubContext
        });
      },
      (err) => {
        assert.ok(err instanceof ServiceError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'INVALID_INPUT');
        return true;
      }
    );
  });

  it('orchestrates complete public repository analysis across 6 modules', async () => {
    const result = await analyzeRepositoryDashboard({
      repoInput: 'octocat/Hello-World',
      githubContext: mockPublicGithubContext
    });

    assert.equal(result.repository.fullName, 'octocat/Hello-World');
    assert.equal(result.repository.primaryLanguage, 'JavaScript');
    assert.equal(result.repository.isPrivate, false);
    assert.equal(result.repository.installed, true);

    // Summary validation
    assert.equal(result.summary.totalModules, 6);
    assert.equal(result.summary.modulesEvaluated, 6);

    // All 6 modules present in modules map
    assert.ok(result.modules.licensing);
    assert.ok(result.modules.community);
    assert.ok(result.modules.security);
    assert.ok(result.modules.documentation);
    assert.ok(result.modules.issues);
    assert.ok(result.modules.automation);

    assert.ok(Array.isArray(result.prioritizedRecommendations));
  });

  it('enforces privacy check on private repository without token (401)', async () => {
    const mockPrivateOctokit = {
      rest: {
        repos: {
          get: async () => ({
            data: {
              name: 'Secret-Project',
              owner: { login: 'octocat' },
              full_name: 'octocat/Secret-Project',
              default_branch: 'main',
              private: true
            }
          })
        }
      }
    };

    const mockPrivateContext = {
      isAppConfigured: true,
      createPublicOctokit: () => mockPrivateOctokit,
      getPublicOctokit: () => mockPrivateOctokit,
      resolveRepoInstallation: async () => ({
        installed: false,
        octokit: mockPrivateOctokit,
        installation: null
      })
    };

    await assert.rejects(
      async () => {
        await analyzeRepositoryDashboard({
          repoInput: 'octocat/Secret-Project',
          githubContext: mockPrivateContext
        });
      },
      (err) => {
        assert.ok(err instanceof ServiceError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'AUTH_REQUIRED');
        return true;
      }
    );
  });

  it('allows authorized collaborator to inspect private repository', async () => {
    const mockPrivateOctokit = {
      rest: {
        repos: {
          get: async () => ({
            data: {
              name: 'Secret-Project',
              owner: { login: 'octocat' },
              full_name: 'octocat/Secret-Project',
              default_branch: 'main',
              private: true,
              language: 'TypeScript',
              archived: false,
              stargazers_count: 5,
              forks_count: 1,
              open_issues_count: 0
            }
          }),
          getContent: async () => ({ data: [] }),
          getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } })
        },
        issues: {
          listForRepo: async () => ({ data: [] })
        }
      }
    };

    const mockPrivateContext = {
      isAppConfigured: true,
      createPublicOctokit: () => mockPrivateOctokit,
      getPublicOctokit: () => mockPrivateOctokit,
      resolveRepoInstallation: async () => ({
        installed: false,
        octokit: mockPrivateOctokit,
        installation: null
      })
    };

    const createUserClient = () => ({
      rest: {
        repos: {
          get: async () => ({
            data: {
              name: 'Secret-Project',
              owner: { login: 'octocat' },
              full_name: 'octocat/Secret-Project',
              default_branch: 'main',
              private: true
            }
          }),
          getCollaboratorPermissionLevel: async () => ({
            data: { permission: 'write' }
          })
        },
        users: {
          getAuthenticated: async () => ({ data: { login: 'trusted-dev' } })
        }
      }
    });

    const result = await analyzeRepositoryDashboard({
      repoInput: 'octocat/Secret-Project',
      authorization: 'Bearer secret_token_xyz',
      githubContext: mockPrivateContext,
      createUserClient
    });

    assert.equal(result.repository.fullName, 'octocat/Secret-Project');
    assert.equal(result.repository.isPrivate, true);
    assert.equal(result.summary.totalModules, 6);
  });

  it('isolates module failures so other modules still complete and status is failed', async () => {
    const failingOctokit = {
      rest: {
        repos: {
          get: async () => ({
            data: {
              name: 'Hello-World',
              owner: { login: 'octocat' },
              full_name: 'octocat/Hello-World',
              default_branch: 'main',
              private: false,
              has_issues: true,
              open_issues_count: 5
            }
          }),
          getContent: async ({ path }) => {
            if (path === '.github') {
              throw new Error('Simulated upstream GitHub network timeout');
            }
            return { data: [] };
          }
        },
        issues: {
          listForRepo: async () => {
            throw new Error('Simulated Issues API failure');
          }
        }
      }
    };

    const failingContext = {
      isAppConfigured: true,
      createPublicOctokit: () => failingOctokit,
      getPublicOctokit: () => failingOctokit,
      resolveRepoInstallation: async () => ({
        installed: false,
        octokit: failingOctokit,
        installation: null
      })
    };

    const result = await analyzeRepositoryDashboard({
      repoInput: 'octocat/Hello-World',
      githubContext: failingContext
    });

    assert.equal(result.repository.fullName, 'octocat/Hello-World');
    // Licensing and Documentation handled the content gracefully or failed safely
    assert.equal(result.summary.totalModules, 6);
    assert.equal(result.summary.modulesEvaluated, 5);
    assert.equal(result.summary.modulesFailed, 1);
    // Issues failed but coordinator did not crash
    assert.equal(result.modules.issues.status, 'failed');
    assert.equal(result.modules.issues.executionStatus, 'failed');
    assert.equal(result.modules.issues.healthStatus, 'unknown');
    assert.ok(result.modules.issues.summary.includes('Simulated Issues API failure'));
  });
});

describe('Dashboard HTTP Endpoint POST /api/dashboard/analyze', () => {
  const mockOctokit = {
    rest: {
      repos: {
        get: async () => ({
          data: {
            name: 'Sample-Repo',
            owner: { login: 'octocat' },
            full_name: 'octocat/Sample-Repo',
            default_branch: 'main',
            description: 'Sample description',
            language: 'JavaScript',
            archived: false,
            private: false,
            html_url: 'https://github.com/octocat/Sample-Repo',
            stargazers_count: 10,
            forks_count: 2,
            open_issues_count: 1
          }
        }),
        getContent: async ({ path }) => {
          if (path === '') {
            return {
              data: [
                { name: 'README.md', type: 'file' },
                { name: 'LICENSE', type: 'file' }
              ]
            };
          }
          const err = new Error('Not found');
          err.status = 404;
          throw err;
        }
      },
      issues: {
        listForRepo: async () => ({ data: [] })
      }
    }
  };

  const githubContext = {
    isAppConfigured: true,
    createPublicOctokit: () => mockOctokit,
    getPublicOctokit: () => mockOctokit,
    resolveRepoInstallation: async () => ({
      installed: false,
      octokit: mockOctokit,
      installation: null
    })
  };

  const { app } = createApp({ githubContext });

  it('POST /api/dashboard/analyze returns 200 with full health report', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/dashboard/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'octocat/Sample-Repo' })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.repository.fullName, 'octocat/Sample-Repo');
      assert.equal(data.summary.totalModules, 6);
      assert.equal(data.summary.modulesEvaluated, 6);
      assert.ok(data.modules.licensing);
      assert.ok(data.modules.community);
      assert.ok(data.modules.security);
      assert.ok(data.modules.documentation);
      assert.ok(data.modules.issues);
      assert.ok(data.modules.automation);
      assert.ok(Array.isArray(data.prioritizedRecommendations));
    } finally {
      server.close();
    }
  });

  it('POST /api/dashboard/analyze returns 400 for missing repoInput', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/dashboard/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'INVALID_INPUT');
    } finally {
      server.close();
    }
  });
});
