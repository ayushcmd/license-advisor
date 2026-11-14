/**
 * Open Workers — Documentation Client Controller
 *
 * Coordinates documentation audits, README generation and improvements,
 * changelog compilation, badge snippet generation, safe link inspection,
 * and automated documentation pull requests.
 */

// Helper to safely build DOM elements without innerHTML interpolation
function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(element.dataset, value);
    } else if (key === 'hidden' || key === 'disabled' || key === 'checked' || key === 'required') {
      if (value) element.setAttribute(key, '');
      else element.removeAttribute(key);
    } else {
      element.setAttribute(key, value);
    }
  }

  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  }
  return element;
}

let currentReadmeContent = null;
let currentChangelogContent = null;

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split('/').pop() || filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyToClipboard(text, button, successLabel = 'Copied!') {
  const original = button.textContent;
  navigator.clipboard.writeText(text).then(
    () => {
      button.textContent = successLabel;
      setTimeout(() => { button.textContent = original; }, 2000);
    },
    () => {
      button.textContent = 'Failed';
      setTimeout(() => { button.textContent = original; }, 2000);
    }
  );
}

// -----------------------------------------------------------------------------
// 1. Documentation Audit
// -----------------------------------------------------------------------------
async function runDocumentationAudit(repoInput) {
  const errorEl = document.getElementById('audit-error');
  const resultsEl = document.getElementById('audit-results');
  const submitBtn = document.getElementById('audit-submit');

  errorEl.hidden = true;
  errorEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Auditing...';

  try {
    const res = await fetch('/api/documentation/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoInput })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to inspect repository documentation.');
    }

    renderAuditReport(data);
    resultsEl.hidden = false;

    // Prefill PR repo and Link repo
    const prRepoInput = document.getElementById('pr-repo');
    if (prRepoInput && !prRepoInput.value) prRepoInput.value = data.repository.fullName;
    const linksRepoInput = document.getElementById('links-repo');
    if (linksRepoInput && !linksRepoInput.value) linksRepoInput.value = data.repository.fullName;
  } catch (err) {
    resultsEl.hidden = true;
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Audit Documentation';
  }
}

function renderAuditReport(data) {
  const repoNameEl = document.getElementById('audit-repo-name');
  const repoDescEl = document.getElementById('audit-repo-desc');
  const scoreContainer = document.getElementById('audit-score-container');
  const statsEl = document.getElementById('audit-stats');
  const noticeEl = document.getElementById('audit-notice');
  const listEl = document.getElementById('audit-checks-list');

  repoNameEl.textContent = data.repository.fullName;
  repoDescEl.textContent = data.repository.description || 'No description provided.';

  // Completeness score
  const score = data.summary.completenessScore;
  scoreContainer.replaceChildren(
    el('div', { className: 'stack-sm', style: { alignItems: 'flex-end', textAlign: 'right' } }, [
      el('span', { className: 'text-small text-muted' }, 'Documentation Completeness'),
      el('span', {
        className: `badge ${score >= 80 ? 'badge-success' : score >= 50 ? 'badge-warning' : 'badge-danger'}`,
        style: { fontSize: '18px', padding: '6px 14px', borderRadius: '16px' }
      }, `${score}%`)
    ])
  );

  statsEl.replaceChildren(
    el('span', { className: 'text-success' }, `✔ ${data.summary.passed} Passed`),
    el('span', { className: 'text-danger' }, `✖ ${data.summary.missing} Missing`),
    el('span', { className: 'text-warning' }, `⚠ ${data.summary.needsAttention} Needs Attention`),
    el('span', { className: 'text-muted' }, `ℹ ${data.summary.notVerified} Not Verified`)
  );

  noticeEl.textContent = data.summary.assessmentNotice;

  listEl.replaceChildren();
  for (const check of data.checks) {
    let statusClass = 'badge-neutral';
    let statusLabel = 'Not verified';

    if (check.status === 'passed') {
      statusClass = 'badge-success';
      statusLabel = 'Passed';
    } else if (check.status === 'missing') {
      statusClass = 'badge-danger';
      statusLabel = 'Missing';
    } else if (check.status === 'needs_attention') {
      statusClass = 'badge-warning';
      statusLabel = 'Needs attention';
    }

    const checkRow = el('div', {
      className: 'box box-body',
      style: {
        marginBottom: 'var(--space-2)',
        borderLeft: `4px solid var(--color-${check.status === 'passed' ? 'success' : check.status === 'missing' ? 'danger' : check.status === 'needs_attention' ? 'warning' : 'border-default'})`
      }
    }, [
      el('div', { className: 'cluster-between', style: { marginBottom: 'var(--space-1)' } }, [
        el('strong', {}, check.name),
        el('span', { className: `badge ${statusClass}` }, statusLabel)
      ]),
      el('p', { className: 'text-small', style: { margin: '0 0 var(--space-1) 0' } }, check.message),
      el('p', { className: 'text-small text-muted', style: { margin: 0 } }, check.recommendation),
      check.canGenerateFix && check.status !== 'passed'
        ? el('div', { style: { marginTop: 'var(--space-2)' } }, [
            el('a', {
              href: `#section-${check.fixTemplateId || 'readme'}`,
              className: 'btn btn-secondary btn-sm',
              onClick: (e) => {
                e.preventDefault();
                const target = document.getElementById(`section-${check.fixTemplateId || 'readme'}`);
                if (target) target.scrollIntoView({ behavior: 'smooth' });
              }
            }, 'Generate Section')
          ])
        : null
    ]);

    listEl.appendChild(checkRow);
  }
}

// -----------------------------------------------------------------------------
// 2. README Generator & Assistant
// -----------------------------------------------------------------------------
async function updateReadmePreview(e) {
  if (e) e.preventDefault();
  const previewEl = document.getElementById('readme-preview');

  const newForm = document.getElementById('readme-new-form');
  const isNewMode = !newForm.hidden;

  if (isNewMode) {
    const name = document.getElementById('readme-project-name').value.trim() || 'My Project';
    const description = document.getElementById('readme-description').value.trim();
    const installation = document.getElementById('readme-installation').value.trim();
    const usage = document.getElementById('readme-usage').value.trim();
    const license = document.getElementById('readme-license').value.trim() || 'MIT';

    try {
      const res = await fetch('/api/documentation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: 'readme',
          options: { projectName: name, description, installation, usage, license }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate README.');

      previewEl.textContent = data.content;
      currentReadmeContent = data.content;
    } catch (err) {
      previewEl.textContent = `# Error: ${err.message}`;
    }
  } else {
    const originalContent = document.getElementById('readme-original-content').value;
    const checkedBoxes = document.querySelectorAll('input[name="improve-section"]:checked');
    const sections = {};

    for (const cb of checkedBoxes) {
      const key = cb.value;
      if (key === 'installation') sections.installation = 'Provide installation instructions for this repository.';
      if (key === 'usage') sections.usage = 'Provide usage examples and command-line instructions.';
      if (key === 'testing') sections.testing = 'Run the test suite using standard project commands.';
      if (key === 'contributing') sections.contributing = 'Contributions are welcome! Please submit an issue or pull request.';
    }

    try {
      const res = await fetch('/api/documentation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: 'readme',
          mode: 'improve',
          originalContent,
          sections
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to propose README additions.');

      previewEl.textContent = data.content;
      currentReadmeContent = data.content;
    } catch (err) {
      previewEl.textContent = `# Error: ${err.message}`;
    }
  }
}

// -----------------------------------------------------------------------------
// 3. Changelog Generator
// -----------------------------------------------------------------------------
async function updateChangelogPreview(e) {
  if (e) e.preventDefault();
  const previewEl = document.getElementById('changelog-preview');

  const version = document.getElementById('changelog-version').value.trim() || '1.0.0';
  const date = document.getElementById('changelog-date').value.trim();
  const rawCommits = document.getElementById('changelog-commits').value.trim();
  const commitLines = rawCommits ? rawCommits.split('\n').map((l) => l.trim()).filter(Boolean) : [];

  try {
    const res = await fetch('/api/documentation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: 'changelog',
        options: {
          version,
          date,
          commits: commitLines
        }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate changelog.');

    previewEl.textContent = data.content;
    currentChangelogContent = data.content;
  } catch (err) {
    previewEl.textContent = `# Error: ${err.message}`;
  }
}

// -----------------------------------------------------------------------------
// 4. Badge Generator
// -----------------------------------------------------------------------------
function updateBadgeFields() {
  const type = document.getElementById('badge-type').value;
  const container = document.getElementById('badge-fields');
  container.replaceChildren();

  if (type === 'license') {
    container.append(
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-spdx' }, 'SPDX License Identifier'),
        el('input', { type: 'text', id: 'badge-spdx', className: 'input', value: 'Apache-2.0' })
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-repo' }, 'Repository (owner/repo)'),
        el('input', { type: 'text', id: 'badge-repo', className: 'input', value: 'ayushcmd/open-workers' })
      ])
    );
  } else if (type === 'workflow') {
    container.append(
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-repo' }, 'Repository (owner/repo)'),
        el('input', { type: 'text', id: 'badge-repo', className: 'input', value: 'ayushcmd/open-workers' })
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-workflow' }, 'Workflow File Name'),
        el('input', { type: 'text', id: 'badge-workflow', className: 'input', value: 'keep-render-awake.yml' })
      ])
    );
  } else if (type === 'node') {
    container.append(
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-node-version' }, 'Supported Node.js Version'),
        el('input', { type: 'text', id: 'badge-node-version', className: 'input', value: '>=20.0.0' })
      ])
    );
  } else if (type === 'custom') {
    container.append(
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-label' }, 'Left Label'),
        el('input', { type: 'text', id: 'badge-label', className: 'input', value: 'status' })
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-message' }, 'Right Message'),
        el('input', { type: 'text', id: 'badge-message', className: 'input', value: 'active' })
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-color' }, 'Badge Color'),
        el('input', { type: 'text', id: 'badge-color', className: 'input', value: 'brightgreen' })
      ]),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-link' }, 'Link URL'),
        el('input', { type: 'text', id: 'badge-link', className: 'input', value: 'https://github.com/ayushcmd/open-workers' })
      ])
    );
  } else {
    // release, stars, issues, contributors
    container.append(
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label', for: 'badge-repo' }, 'Repository (owner/repo)'),
        el('input', { type: 'text', id: 'badge-repo', className: 'input', value: 'ayushcmd/open-workers' })
      ])
    );
  }
}

async function updateBadgePreview(e) {
  if (e) e.preventDefault();
  const type = document.getElementById('badge-type').value;
  const previewEl = document.getElementById('badge-preview');
  const visualEl = document.getElementById('badge-visual-preview');

  const repoVal = document.getElementById('badge-repo')?.value.trim() || 'owner/repo';
  const [owner, repo] = repoVal.includes('/') ? repoVal.split('/') : ['owner', repoVal];

  const badgeObj = { type, owner, repo };
  if (type === 'license') {
    badgeObj.spdx = document.getElementById('badge-spdx')?.value.trim() || 'MIT';
  } else if (type === 'workflow') {
    badgeObj.workflow = document.getElementById('badge-workflow')?.value.trim() || 'ci.yml';
  } else if (type === 'node') {
    badgeObj.version = document.getElementById('badge-node-version')?.value.trim() || '>=20.0.0';
  } else if (type === 'custom') {
    badgeObj.label = document.getElementById('badge-label')?.value.trim() || 'badge';
    badgeObj.message = document.getElementById('badge-message')?.value.trim() || 'active';
    badgeObj.color = document.getElementById('badge-color')?.value.trim() || 'blue';
    badgeObj.link = document.getElementById('badge-link')?.value.trim() || '#';
  }

  try {
    const res = await fetch('/api/documentation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'badges', badge: badgeObj })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate badge.');

    previewEl.textContent = data.content;

    // Render visual preview
    const imgMatch = data.content.match(/!\[.*?\]\((.*?)\)/);
    if (imgMatch && imgMatch[1]) {
      visualEl.replaceChildren(
        el('img', { src: imgMatch[1], alt: 'Generated Badge Preview', style: { height: '20px' } })
      );
    } else {
      visualEl.replaceChildren(el('span', { className: 'text-muted text-small' }, 'Badge rendered'));
    }
  } catch (err) {
    previewEl.textContent = `# Error: ${err.message}`;
    visualEl.replaceChildren();
  }
}

// -----------------------------------------------------------------------------
// 5. Link Checker
// -----------------------------------------------------------------------------
async function runLinkCheck(e) {
  e.preventDefault();
  const errorEl = document.getElementById('links-error');
  const resultsEl = document.getElementById('links-results');
  const submitBtn = document.getElementById('links-submit');
  const statsEl = document.getElementById('links-summary-stats');
  const tbody = document.getElementById('links-tbody');

  errorEl.hidden = true;
  resultsEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking Links...';

  const repo = document.getElementById('links-repo').value.trim();
  const path = document.getElementById('links-path').value.trim() || 'README.md';

  try {
    const res = await fetch('/api/documentation/check-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, path })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to inspect links.');

    statsEl.replaceChildren(
      el('span', { className: 'text-success' }, `✔ ${data.summary.working} Working`),
      el('span', { className: 'text-danger' }, `✖ ${data.summary.broken} Broken`),
      el('span', { className: 'text-info' }, `↪ ${data.summary.redirected} Redirected`),
      el('span', { className: 'text-muted' }, `ℹ ${data.summary.notVerified} Not Verified`),
      el('span', { className: 'text-muted' }, `(${data.totalLinks} Total Links)`)
    );

    tbody.replaceChildren();
    if (data.links.length === 0) {
      tbody.appendChild(
        el('tr', {}, [
          el('td', { colSpan: 5, style: { padding: '12px', textAlign: 'center' }, className: 'text-muted' }, 'No Markdown links found in this file.')
        ])
      );
    } else {
      for (const item of data.links) {
        let badgeClass = 'badge-neutral';
        if (item.status === 'working') badgeClass = 'badge-success';
        else if (item.status === 'broken') badgeClass = 'badge-danger';
        else if (item.status === 'redirected') badgeClass = 'badge-info';

        tbody.appendChild(
          el('tr', { style: { borderBottom: '1px solid var(--color-border-subtle)' } }, [
            el('td', { style: { padding: '8px' } }, item.line),
            el('td', { style: { padding: '8px' } }, item.text || '(empty)'),
            el('td', { style: { padding: '8px', wordBreak: 'break-all' } }, [
              el('code', {}, item.url)
            ]),
            el('td', { style: { padding: '8px' } }, item.type),
            el('td', { style: { padding: '8px' } }, [
              el('span', { className: `badge ${badgeClass}` }, item.status),
              el('div', { className: 'text-small text-muted', style: { marginTop: '2px' } }, item.message)
            ])
          ])
        );
      }
    }

    resultsEl.hidden = false;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Check Links';
  }
}

// -----------------------------------------------------------------------------
// 6. Create Documentation Pull Request
// -----------------------------------------------------------------------------
async function previewDocumentationPullRequest() {
  const previewBox = document.getElementById('pr-preview-box');
  const errorBox = document.getElementById('pr-error-box');
  const submitBtn = document.getElementById('pr-submit-btn');
  const previewBtn = document.getElementById('pr-preview-btn');

  previewBox.hidden = true;
  errorBox.hidden = true;
  submitBtn.disabled = true;

  const repo = document.getElementById('pr-repo').value.trim();
  if (!repo) {
    errorBox.textContent = 'Please enter a target GitHub repository (owner/repo).';
    errorBox.hidden = false;
    return;
  }

  const includeReadme = document.getElementById('pr-include-readme').checked;
  const includeChangelog = document.getElementById('pr-include-changelog').checked;

  if (!includeReadme && !includeChangelog) {
    errorBox.textContent = 'Select at least one documentation file (README or Changelog) to include.';
    errorBox.hidden = false;
    return;
  }

  const changes = [];
  if (includeReadme && currentReadmeContent) {
    changes.push({ path: 'README.md', content: currentReadmeContent });
  }
  if (includeChangelog && currentChangelogContent) {
    changes.push({ path: 'CHANGELOG.md', content: currentChangelogContent });
  }

  if (changes.length === 0) {
    errorBox.textContent = 'Please generate the selected README or Changelog content above before previewing.';
    errorBox.hidden = false;
    return;
  }

  const replaceExisting = document.getElementById('pr-replace-existing').checked;

  previewBtn.disabled = true;
  previewBtn.textContent = 'Checking...';

  try {
    const res = await fetch('/api/documentation/preview-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, changes, replaceExisting })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to preview pull request.');

    const fileItems = data.files.map((f) =>
      el('li', {}, `${f.path} (${f.action === 'update' ? 'update existing file' : 'create new file'})`)
    );

    const warnings = [];
    if (data.hasConflicts) {
      warnings.push(
        el('p', { className: 'text-danger', style: { margin: 'var(--space-1) 0' } },
          `Conflict: The following file(s) already exist: ${data.conflicts.join(', ')}. Check "Overwrite existing files" to update them.`
        )
      );
    }

    previewBox.replaceChildren(
      el('strong', {}, `Preview for ${data.repository.fullName} (target branch: chore/improve-docs)`),
      el('ul', { style: { margin: 'var(--space-2) 0 0 var(--space-4)' } }, fileItems),
      ...warnings
    );
    previewBox.hidden = false;

    if (data.canProceed) {
      submitBtn.disabled = false;
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = 'Preview Pull Request';
  }
}

async function triggerDocumentationPullRequest(e) {
  e.preventDefault();
  const errorBox = document.getElementById('pr-error-box');
  const successBox = document.getElementById('pr-success-box');
  const submitBtn = document.getElementById('pr-submit-btn');

  errorBox.hidden = true;
  successBox.hidden = true;

  const repo = document.getElementById('pr-repo').value.trim();
  const token = document.getElementById('pr-token').value.trim();
  const replaceExisting = document.getElementById('pr-replace-existing').checked;

  if (!token) {
    errorBox.textContent = 'Personal access token is required to verify write authorization.';
    errorBox.hidden = false;
    return;
  }

  const includeReadme = document.getElementById('pr-include-readme').checked;
  const includeChangelog = document.getElementById('pr-include-changelog').checked;

  const changes = [];
  if (includeReadme && currentReadmeContent) changes.push({ path: 'README.md', content: currentReadmeContent });
  if (includeChangelog && currentChangelogContent) changes.push({ path: 'CHANGELOG.md', content: currentChangelogContent });

  submitBtn.disabled = true;
  submitBtn.textContent = 'Opening Pull Request...';

  try {
    const res = await fetch('/api/documentation/trigger-pr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ repo, changes, replaceExisting })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create pull request.');

    successBox.replaceChildren(
      el('h4', { style: { margin: '0 0 var(--space-1) 0' } }, '🎉 Documentation Pull Request Created!'),
      el('p', { style: { margin: '0 0 var(--space-2) 0' } }, [
        el('a', {
          href: data.pullRequest.htmlUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { fontWeight: 'bold', fontSize: '15px' }
        }, `View Pull Request #${data.pullRequest.number}: ${data.pullRequest.title}`)
      ]),
      el('p', { className: 'text-small', style: { margin: 0 } },
        `Branch "${data.branch}" created with ${data.files.length} file(s). Review and merge on GitHub.`
      )
    );
    successBox.hidden = false;
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Open Documentation PR';
  }
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Audit Form
  const auditForm = document.getElementById('audit-form');
  if (auditForm) {
    auditForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const repo = document.getElementById('audit-repo').value.trim();
      if (repo) runDocumentationAudit(repo);
    });
  }

  // Sample Buttons
  for (const btn of document.querySelectorAll('.sample-repo')) {
    btn.addEventListener('click', () => {
      const repo = btn.dataset.repo;
      const input = document.getElementById('audit-repo');
      if (input && repo) {
        input.value = repo;
        runDocumentationAudit(repo);
      }
    });
  }

  // Check URL parameter
  const params = new URLSearchParams(window.location.search);
  const initialRepo = params.get('repo');
  if (initialRepo) {
    const input = document.getElementById('audit-repo');
    if (input) {
      input.value = initialRepo;
      runDocumentationAudit(initialRepo);
    }
  }

  // README Tabs
  const tabNew = document.getElementById('tab-readme-new');
  const tabImprove = document.getElementById('tab-readme-improve');
  const formNew = document.getElementById('readme-new-form');
  const formImprove = document.getElementById('readme-improve-form');

  if (tabNew && tabImprove && formNew && formImprove) {
    tabNew.addEventListener('click', () => {
      tabNew.className = 'btn btn-primary btn-sm';
      tabImprove.className = 'btn btn-secondary btn-sm';
      formNew.hidden = false;
      formImprove.hidden = true;
      updateReadmePreview();
    });

    tabImprove.addEventListener('click', () => {
      tabNew.className = 'btn btn-secondary btn-sm';
      tabImprove.className = 'btn btn-primary btn-sm';
      formNew.hidden = true;
      formImprove.hidden = false;
      updateReadmePreview();
    });
  }

  if (formNew) {
    formNew.addEventListener('submit', updateReadmePreview);
    updateReadmePreview();
  }
  if (formImprove) {
    formImprove.addEventListener('submit', updateReadmePreview);
  }

  const copyReadmeBtn = document.getElementById('copy-readme');
  if (copyReadmeBtn) {
    copyReadmeBtn.addEventListener('click', () => {
      const code = document.getElementById('readme-preview').textContent;
      copyToClipboard(code, copyReadmeBtn);
    });
  }

  const downloadReadmeBtn = document.getElementById('download-readme');
  if (downloadReadmeBtn) {
    downloadReadmeBtn.addEventListener('click', () => {
      if (currentReadmeContent) downloadFile('README.md', currentReadmeContent);
    });
  }

  // Changelog Form
  const changelogForm = document.getElementById('changelog-form');
  if (changelogForm) {
    changelogForm.addEventListener('submit', updateChangelogPreview);
    updateChangelogPreview();
  }

  const copyChangelogBtn = document.getElementById('copy-changelog');
  if (copyChangelogBtn) {
    copyChangelogBtn.addEventListener('click', () => {
      const code = document.getElementById('changelog-preview').textContent;
      copyToClipboard(code, copyChangelogBtn);
    });
  }

  const downloadChangelogBtn = document.getElementById('download-changelog');
  if (downloadChangelogBtn) {
    downloadChangelogBtn.addEventListener('click', () => {
      if (currentChangelogContent) downloadFile('CHANGELOG.md', currentChangelogContent);
    });
  }

  // Badge Form
  const badgeTypeSelect = document.getElementById('badge-type');
  if (badgeTypeSelect) {
    badgeTypeSelect.addEventListener('change', () => {
      updateBadgeFields();
      updateBadgePreview();
    });
  }

  const badgeForm = document.getElementById('badge-form');
  if (badgeForm) {
    badgeForm.addEventListener('submit', updateBadgePreview);
    updateBadgePreview();
  }

  const copyBadgeBtn = document.getElementById('copy-badge');
  if (copyBadgeBtn) {
    copyBadgeBtn.addEventListener('click', () => {
      const code = document.getElementById('badge-preview').textContent;
      copyToClipboard(code, copyBadgeBtn);
    });
  }

  // Links Form
  const linksForm = document.getElementById('links-form');
  if (linksForm) {
    linksForm.addEventListener('submit', runLinkCheck);
  }

  // PR Form
  const previewPrBtn = document.getElementById('pr-preview-btn');
  if (previewPrBtn) {
    previewPrBtn.addEventListener('click', previewDocumentationPullRequest);
  }

  const prForm = document.getElementById('pr-form');
  if (prForm) {
    prForm.addEventListener('submit', triggerDocumentationPullRequest);
  }
});
