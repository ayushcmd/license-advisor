import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  escapeHtml,
  sanitizeUrl,
  getQueryParam,
  parseRepoInput,
  setButtonLoading
} from '../public/js/ui-utils.js';

describe('Frontend UI Utilities (public/js/ui-utils.js)', () => {
  it('escapes HTML strings and handles edge types cleanly', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml(''), '');
    assert.strictEqual(escapeHtml(123), '123');
    assert.strictEqual(
      escapeHtml('<script>alert("XSS & attack\'s")</script>'),
      '&lt;script&gt;alert(&quot;XSS &amp; attack&#039;s&quot;)&lt;/script&gt;'
    );
    assert.strictEqual(
      escapeHtml('Safe text with no entities'),
      'Safe text with no entities'
    );
  });

  it('sanitizes dynamic URLs and rejects dangerous URI schemes', () => {
    // Relative paths allowed
    assert.strictEqual(sanitizeUrl('/dashboard.html?repo=foo/bar'), '/dashboard.html?repo=foo/bar');
    assert.strictEqual(sanitizeUrl('./analyzer.html'), './analyzer.html');
    assert.strictEqual(sanitizeUrl('#section-recommendations'), '#section-recommendations');
    assert.strictEqual(sanitizeUrl('?repo=foo/bar'), '?repo=foo/bar');

    // Safe external HTTPS allowed
    assert.strictEqual(
      sanitizeUrl('https://github.com/ayushcmd/open-workers'),
      'https://github.com/ayushcmd/open-workers'
    );

    // Dangerous protocols rejected and replaced with fallback
    assert.strictEqual(sanitizeUrl('javascript:alert(1)'), '#');
    assert.strictEqual(sanitizeUrl('JAVASCRIPT:alert(document.cookie)', '/fallback'), '/fallback');
    assert.strictEqual(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '#');
    assert.strictEqual(sanitizeUrl('vbscript:msgbox("hi")'), '#');
    assert.strictEqual(sanitizeUrl(''), '#');
    assert.strictEqual(sanitizeUrl(null), '#');
    assert.strictEqual(sanitizeUrl('   '), '#');
  });

  it('safely extracts URL query parameters', () => {
    assert.strictEqual(
      getQueryParam('repo', 'https://open-workers.onrender.com/dashboard.html?repo=expressjs/express'),
      'expressjs/express'
    );
    assert.strictEqual(
      getQueryParam('missing', 'https://open-workers.onrender.com/dashboard.html?repo=expressjs/express'),
      null
    );
    assert.strictEqual(
      getQueryParam('token', 'https://open-workers.onrender.com/?repo=owner/repo&other=123'),
      null
    );
  });

  it('validates repository inputs in owner/repo, HTTPS, and SSH forms', () => {
    assert.deepStrictEqual(parseRepoInput('expressjs/express'), {
      owner: 'expressjs',
      repo: 'express',
      fullName: 'expressjs/express'
    });
    assert.deepStrictEqual(parseRepoInput('https://github.com/facebook/react'), {
      owner: 'facebook',
      repo: 'react',
      fullName: 'facebook/react'
    });
    assert.deepStrictEqual(parseRepoInput('git@github.com:torvalds/linux.git'), {
      owner: 'torvalds',
      repo: 'linux',
      fullName: 'torvalds/linux'
    });

    // Rejections
    assert.throws(() => parseRepoInput(''), /Enter a GitHub repository/);
    assert.throws(() => parseRepoInput('single-name'), /Repository must be specified as "owner\/repo"/);
    assert.throws(() => parseRepoInput('https://gitlab.com/owner/repo'), /Only github\.com repositories are supported/);
    assert.throws(() => parseRepoInput('sneaky/..'), /Repository owner or name contains unsupported characters/);
    assert.throws(() => parseRepoInput('owner/invalid$repo'), /Repository owner or name contains unsupported characters/);
  });

  it('manages button loading states and accessibility attributes', () => {
    // Lightweight mock of HTMLButtonElement
    const button = {
      disabled: false,
      textContent: 'Analyze',
      dataset: {},
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; }
    };
    const spinner = { style: { display: 'none' } };

    setButtonLoading(button, true, 'Analyzing...', 'Analyze', spinner);
    assert.strictEqual(button.disabled, true);
    assert.strictEqual(button.attributes['aria-busy'], 'true');
    assert.strictEqual(button.textContent, 'Analyzing...');
    assert.strictEqual(spinner.style.display, 'inline-block');

    setButtonLoading(button, false, 'Analyzing...', 'Analyze', spinner);
    assert.strictEqual(button.disabled, false);
    assert.strictEqual(button.attributes['aria-busy'], 'false');
    assert.strictEqual(button.textContent, 'Analyze');
    assert.strictEqual(spinner.style.display, 'none');
  });
});

describe('HTML Pages & Shared Navigation Architecture', () => {
  const publicDir = path.resolve('public');
  const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));

  it('contains exactly 14 primary HTML pages', () => {
    assert.strictEqual(htmlFiles.length, 14);
    const expectedPages = [
      'analyzer.html',
      'app-install.html',
      'automation.html',
      'community.html',
      'compare.html',
      'dashboard.html',
      'documentation.html',
      'explorer.html',
      'index.html',
      'issues.html',
      'privacy.html',
      'questionnaire.html',
      'security.html',
      'support.html'
    ];
    for (const expected of expectedPages) {
      assert.ok(htmlFiles.includes(expected), `Missing expected page: ${expected}`);
    }
  });

  it('loads /js/navigation.js across all 14 HTML pages', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      assert.ok(
        content.includes('<script type="module" src="/js/navigation.js"></script>'),
        `${file} must include <script type="module" src="/js/navigation.js"></script>`
      );
    }
  });

  it('includes accessible skip-to-content links and matching main-content IDs', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      assert.ok(
        content.includes('<a href="#main-content" class="skip-link">Skip to main content</a>'),
        `${file} missing accessible skip link`
      );
      assert.ok(
        content.includes('id="main-content"'),
        `${file} missing target element with id="main-content"`
      );
    }
  });

  it('includes the complete 8-capability primary navigation bar with Licensing dropdown', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      assert.ok(
        content.includes('<nav class="site-nav" aria-label="Primary">'),
        `${file} missing semantic primary nav`
      );
      assert.ok(content.includes('href="/index.html"'), `${file} missing Home link`);
      assert.ok(content.includes('href="/dashboard.html"'), `${file} missing Dashboard link`);
      assert.ok(content.includes('href="/community.html"'), `${file} missing Community link`);
      assert.ok(content.includes('href="/security.html"'), `${file} missing Security link`);
      assert.ok(content.includes('href="/documentation.html"'), `${file} missing Documentation link`);
      assert.ok(content.includes('href="/issues.html"'), `${file} missing PRs & Issues link`);
      assert.ok(content.includes('href="/automation.html"'), `${file} missing Automation link`);
      assert.ok(
        content.includes('class="nav-link licensing-toggle'),
        `${file} missing Licensing toggle in navigation`
      );
    }
  });

  it('preserves all 5 tools inside the Licensing dropdown including Audit Repository License', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      assert.ok(content.includes('href="/explorer.html"'), `${file} missing Explore Licenses`);
      assert.ok(content.includes('href="/questionnaire.html"'), `${file} missing Find a License`);
      assert.ok(content.includes('href="/compare.html"'), `${file} missing Compare Licenses`);
      assert.ok(
        content.includes('href="/analyzer.html"') && content.includes('Audit Repository License'),
        `${file} missing Audit Repository License link in dropdown`
      );
      assert.ok(content.includes('href="/app-install.html"'), `${file} missing Create License PR`);
    }
  });

  it('verifies ARIA attributes on all Licensing disclosure summaries', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      const summaryMatch = content.match(/<summary[^>]*licensing-toggle[^>]*>/);
      assert.ok(summaryMatch, `${file} missing licensing summary tag`);
      const summaryTag = summaryMatch[0];
      assert.ok(summaryTag.includes('aria-controls="licensing-links"'), `${file} missing aria-controls`);
      assert.ok(summaryTag.includes('aria-expanded="false"'), `${file} missing aria-expanded`);
      assert.ok(summaryTag.includes('aria-haspopup="true"'), `${file} missing aria-haspopup`);
    }
  });
});

describe('CSS & Mobile Layout Guardrails', () => {
  const baseCss = fs.readFileSync(path.resolve('public/css/base.css'), 'utf8');
  const compCss = fs.readFileSync(path.resolve('public/css/components.css'), 'utf8');

  it('has balanced braces across all CSS stylesheets', () => {
    for (const [name, css] of [['base.css', baseCss], ['components.css', compCss]]) {
      let balance = 0;
      for (const char of css) {
        if (char === '{') balance++;
        else if (char === '}') balance--;
      }
      assert.strictEqual(balance, 0, `${name} has unbalanced curly braces`);
    }
  });

  it('supports prefers-reduced-motion in base.css', () => {
    assert.ok(
      baseCss.includes('@media (prefers-reduced-motion: reduce)'),
      'base.css must define prefers-reduced-motion'
    );
  });

  it('defines visible :focus-visible styling in base.css', () => {
    assert.ok(
      baseCss.includes(':focus-visible {') || baseCss.includes(':focus-visible{'),
      'base.css must define :focus-visible outline'
    );
  });

  it('defines modal dialog styles to prevent mobile overflow', () => {
    assert.ok(compCss.includes('dialog.modal'), 'components.css must define dialog.modal');
    assert.ok(compCss.includes('.modal-box'), 'components.css must define .modal-box');
  });

  it('contains no rigid minmax(320px) grids in HTML files that cause mobile overflow', () => {
    const publicDir = path.resolve('public');
    const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      assert.ok(
        !content.includes('minmax(320px,'),
        `${file} contains rigid minmax(320px) grid that causes horizontal overflow on 320px viewports`
      );
      assert.ok(
        !content.includes('minmax(300px,'),
        `${file} contains rigid minmax(300px) grid that causes horizontal overflow on 320px viewports`
      );
    }
  });
});

describe('Security & Zero Credential Storage Audit', () => {
  const jsDir = path.resolve('public/js');
  const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));

  it('never persists credentials in localStorage or sessionStorage in any frontend script', () => {
    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
      assert.ok(
        !content.includes('localStorage.setItem') && !content.includes('sessionStorage.setItem'),
        `${file} must never write to localStorage or sessionStorage`
      );
      assert.ok(
        !content.includes('localStorage.token') && !content.includes('sessionStorage.token'),
        `${file} must never access token on storage objects`
      );
    }
  });

  it('marks all sensitive token inputs with autocomplete="off"', () => {
    const publicDir = path.resolve('public');
    const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
    for (const file of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, file), 'utf8');
      const tokenInputs = [...content.matchAll(/<input[^>]*type="password"[^>]*>/g)];
      for (const [input] of tokenInputs) {
        if (input.includes('token') || input.includes('pat')) {
          assert.ok(
            input.includes('autocomplete="off"'),
            `${file} password/token input must have autocomplete="off"`
          );
        }
      }
    }
  });
});
