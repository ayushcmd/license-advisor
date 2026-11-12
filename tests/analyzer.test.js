import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePublicRepository,
  buildAuditReport,
  inspectRootEntries,
  parseRepoInput
} from '../public/js/analyzer.js';

describe('Repository Specifier Parsing', () => {
  it('parses owner/repo, HTTPS URLs, and SSH URLs cleanly', () => {
    assert.deepEqual(parseRepoInput('expressjs/express'), {
      owner: 'expressjs',
      repo: 'express',
      fullName: 'expressjs/express'
    });
    assert.deepEqual(parseRepoInput('https://github.com/ayushcmd/license-advisor'), {
      owner: 'ayushcmd',
      repo: 'license-advisor',
      fullName: 'ayushcmd/license-advisor'
    });
    assert.deepEqual(parseRepoInput('https://github.com/ayushcmd/license-advisor.git/'), {
      owner: 'ayushcmd',
      repo: 'license-advisor',
      fullName: 'ayushcmd/license-advisor'
    });
    assert.deepEqual(parseRepoInput('https://github.com/torvalds/linux/tree/master'), {
      owner: 'torvalds',
      repo: 'linux',
      fullName: 'torvalds/linux'
    });
    assert.deepEqual(parseRepoInput('git@github.com:ayushcmd/license-advisor.git'), {
      owner: 'ayushcmd',
      repo: 'license-advisor',
      fullName: 'ayushcmd/license-advisor'
    });
  });

  it('rejects non-GitHub hosts, malformed paths, and traversal segments', () => {
    assert.throws(() => parseRepoInput(''), /Enter a GitHub repository/);
    assert.throws(() => parseRepoInput('https://gitlab.com/group/repo'), /Only github\.com/);
    assert.throws(() => parseRepoInput('only-owner'), /owner\/repo/);
    assert.throws(() => parseRepoInput('../secret'), /unsupported characters/);
  });
});

describe('Root Tree & Audit Report Construction', () => {
  it('identifies root license files, notice files, READMEs, and dependency manifests', () => {
    const obs = inspectRootEntries([
      { type: 'file', name: 'LICENSE.md', path: 'LICENSE.md' },
      { type: 'file', name: 'NOTICE', path: 'NOTICE' },
      { type: 'file', name: 'README.md', path: 'README.md' },
      { type: 'file', name: 'package.json', path: 'package.json' },
      { type: 'dir', name: 'src', path: 'src' }
    ]);

    assert.equal(obs.licenseFiles.length, 1);
    assert.equal(obs.noticeFiles.length, 1);
    assert.equal(obs.hasReadme, true);
    assert.equal(obs.dependencyManifests[0].name, 'package.json');
  });

  it('builds licensed, unrecognized, and unlicensed reports accurately', () => {
    const baseRepo = {
      full_name: 'ayushcmd/demo',
      name: 'demo',
      owner: { login: 'ayushcmd' },
      default_branch: 'main',
      html_url: 'https://github.com/ayushcmd/demo',
      private: false,
      archived: false,
      fork: false,
      stargazers_count: 12
    };

    const licensed = buildAuditReport(
      baseRepo,
      { path: 'LICENSE', license: { spdx_id: 'MIT', name: 'MIT License' } },
      [{ type: 'file', name: 'LICENSE', path: 'LICENSE' }]
    );
    assert.equal(licensed.licenseStatus, 'licensed');
    assert.equal(licensed.detectedLicense.catalogId, 'MIT');
    assert.ok(licensed.detectedLicense.explanation);

    const unrecognized = buildAuditReport(
      baseRepo,
      { path: 'LICENSE', license: { spdx_id: 'NOASSERTION', name: 'Other' } },
      [{ type: 'file', name: 'LICENSE', path: 'LICENSE' }]
    );
    assert.equal(unrecognized.licenseStatus, 'unrecognized');
    assert.ok(unrecognized.findings.some((f) => f.severity === 'warning'));

    const unlicensed = buildAuditReport(
      { ...baseRepo, fork: true, archived: true },
      null,
      [{ type: 'file', name: 'package.json', path: 'package.json' }]
    );
    assert.equal(unlicensed.licenseStatus, 'unlicensed');
    assert.ok(unlicensed.findings.some((f) => f.severity === 'danger'));
    assert.ok(unlicensed.findings.some((f) => f.title.includes('fork')));
    assert.ok(unlicensed.findings.some((f) => f.title.includes('archived')));
    assert.ok(unlicensed.findings.some((f) => f.title.includes('Dependency manifests')));
  });
});

describe('Public GitHub API Client (Mocked Fetch)', () => {
  it('fetches repository, license, and root contents and captures rate limit headers', async () => {
    const mockHeaders = new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '57',
      'x-ratelimit-reset': '1762915200'
    });

    const mockFetch = async (url) => {
      if (url.endsWith('/repos/ayushcmd/license-advisor')) {
        return new Response(
          JSON.stringify({
            full_name: 'ayushcmd/license-advisor',
            name: 'license-advisor',
            owner: { login: 'ayushcmd' },
            default_branch: 'main',
            html_url: 'https://github.com/ayushcmd/license-advisor',
            private: false,
            archived: false,
            fork: false,
            stargazers_count: 5
          }),
          { status: 200, headers: mockHeaders }
        );
      }
      if (url.endsWith('/license')) {
        return new Response(
          JSON.stringify({
            path: 'LICENSE',
            license: { spdx_id: 'MIT', name: 'MIT License' }
          }),
          { status: 200, headers: mockHeaders }
        );
      }
      return new Response(
        JSON.stringify([{ type: 'file', name: 'LICENSE', path: 'LICENSE' }]),
        { status: 200, headers: mockHeaders }
      );
    };

    const report = await analyzePublicRepository('ayushcmd/license-advisor', { fetchImpl: mockFetch });
    assert.equal(report.repository.fullName, 'ayushcmd/license-advisor');
    assert.equal(report.licenseStatus, 'licensed');
    assert.equal(report.rateLimit?.remaining, 57);
  });

  it('surfaces clear error messages for 404 repositories and 403 rate limits', async () => {
    const notFoundFetch = async () => new Response('{}', { status: 404 });
    await assert.rejects(
      () => analyzePublicRepository('ayushcmd/missing-repo', { fetchImpl: notFoundFetch }),
      /not found or is private/
    );

    const rateLimitedFetch = async () =>
      new Response('{}', {
        status: 403,
        headers: new Headers({
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1762915200'
        })
      });
    await assert.rejects(
      () => analyzePublicRepository('ayushcmd/license-advisor', { fetchImpl: rateLimitedFetch }),
      /rate limit reached/
    );
  });
});

