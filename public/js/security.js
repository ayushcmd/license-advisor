/**
 * Open Workers — Security Client Controller
 *
 * Coordinates repository security auditing, configuration generators (Dependabot and CodeQL),
 * live previews, and automated pull requests.
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

// State for active configurations
let currentDependabotConfig = null;
let currentCodeQLConfig = null;

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
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
// 1. Repository Security Audit
// -----------------------------------------------------------------------------
async function runSecurityAudit(repoInput) {
  const errorEl = document.getElementById('audit-error');
  const resultsEl = document.getElementById('audit-results');
  const submitBtn = document.getElementById('audit-submit');

  errorEl.hidden = true;
  errorEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Auditing...';

  try {
    const res = await fetch('/api/security/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoInput })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to inspect repository security configuration.');
    }

    renderAuditReport(data);
    resultsEl.hidden = false;

    // Prefill PR repo input
    const prRepoInput = document.getElementById('pr-repo');
    if (prRepoInput && !prRepoInput.value) {
      prRepoInput.value = data.repository.fullName;
    }
  } catch (err) {
    resultsEl.hidden = true;
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Audit Security';
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

  // Health Score Badge
  scoreContainer.replaceChildren(
    el('div', { className: 'stack-sm', style: { alignItems: 'flex-end', textAlign: 'right' } }, [
      el('span', { className: 'text-small text-muted' }, 'Security Configuration Health'),
      el('span', {
        className: `badge ${data.summary.healthScore >= 80 ? 'badge-success' : data.summary.healthScore >= 50 ? 'badge-warning' : 'badge-danger'}`,
        style: { fontSize: '18px', padding: '6px 14px', borderRadius: '16px' }
      }, `${data.summary.healthScore}%`)
    ])
  );

  // Stats Breakdown
  statsEl.replaceChildren(
    el('span', { className: 'text-success' }, `✔ ${data.summary.passed} Passed`),
    el('span', { className: 'text-danger' }, `✖ ${data.summary.missing} Missing`),
    el('span', { className: 'text-warning' }, `⚠ ${data.summary.needsAttention} Needs Attention`),
    el('span', { className: 'text-muted' }, `ℹ ${data.summary.notVerified} Not Verified`)
  );

  noticeEl.textContent = data.summary.assessmentNotice;

  // Render Checks List
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
      style: { marginBottom: 'var(--space-2)', borderLeft: `4px solid var(--color-${check.status === 'passed' ? 'success' : check.status === 'missing' ? 'danger' : check.status === 'needs_attention' ? 'warning' : 'border-default'})` }
    }, [
      el('div', { className: 'cluster-between', style: { marginBottom: 'var(--space-1)' } }, [
        el('strong', {}, check.name),
        el('div', { className: 'cluster', style: { gap: 'var(--space-2)' } }, [
          el('span', { className: `badge ${statusClass}` }, statusLabel),
          check.severity ? el('span', { className: 'text-small text-muted' }, `[${check.severity.toUpperCase()}]`) : null
        ])
      ]),
      el('p', { className: 'text-small', style: { margin: '0 0 var(--space-1) 0' } }, check.description),
      el('p', { className: 'text-small text-muted', style: { margin: 0 } }, check.recommendation),
      check.canGenerateFix && check.status !== 'passed'
        ? el('div', { style: { marginTop: 'var(--space-2)' } }, [
            el('a', {
              href: `#section-${check.fixTemplateId}`,
              className: 'btn btn-secondary btn-sm',
              onClick: (e) => {
                e.preventDefault();
                const target = document.getElementById(`section-${check.fixTemplateId}`);
                if (target) target.scrollIntoView({ behavior: 'smooth' });
              }
            }, check.fixLabel || 'Generate Fix')
          ])
        : check.fixUrl && check.status !== 'passed'
          ? el('div', { style: { marginTop: 'var(--space-2)' } }, [
              el('a', {
                href: check.fixUrl,
                className: 'btn btn-secondary btn-sm',
                target: '_blank',
                rel: 'noopener noreferrer'
              }, check.fixLabel || 'Generate Policy')
            ])
          : null
    ]);

    listEl.appendChild(checkRow);
  }
}

// -----------------------------------------------------------------------------
// 2. Dependabot Generator
// -----------------------------------------------------------------------------
async function updateDependabotPreview() {
  const form = document.getElementById('dependabot-form');
  const previewEl = document.getElementById('dependabot-preview');
  if (!form || !previewEl) return;

  const checkedBoxes = form.querySelectorAll('input[name="ecosystem"]:checked');
  const ecosystems = Array.from(checkedBoxes).map((cb) => cb.value);

  if (ecosystems.length === 0) {
    previewEl.textContent = '# Select at least one package ecosystem above.';
    currentDependabotConfig = null;
    return;
  }

  const interval = document.getElementById('dependabot-interval').value;
  const limit = parseInt(document.getElementById('dependabot-limit').value, 10) || 10;
  const labelsRaw = document.getElementById('dependabot-labels').value;
  const labels = labelsRaw.split(',').map((l) => l.trim()).filter(Boolean);

  const updates = ecosystems.map((eco) => ({
    packageEcosystem: eco,
    directory: '/',
    schedule: { interval, day: interval === 'weekly' ? 'monday' : undefined, time: '06:00', timezone: 'Etc/UTC' },
    openPullRequestsLimit: limit,
    labels: labels.length > 0 ? labels : ['dependencies']
  }));

  try {
    const res = await fetch('/api/security/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'dependabot', options: { updates } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate Dependabot config.');

    previewEl.textContent = data.content;
    currentDependabotConfig = { templateId: 'dependabot', options: { updates }, content: data.content };
  } catch (err) {
    previewEl.textContent = `# Error: ${err.message}`;
    currentDependabotConfig = null;
  }
}

// -----------------------------------------------------------------------------
// 3. CodeQL Workflow Generator
// -----------------------------------------------------------------------------
async function updateCodeQLPreview() {
  const form = document.getElementById('codeql-form');
  const previewEl = document.getElementById('codeql-preview');
  if (!form || !previewEl) return;

  const checkedBoxes = form.querySelectorAll('input[name="language"]:checked');
  const languages = Array.from(checkedBoxes).map((cb) => cb.value);

  if (languages.length === 0) {
    previewEl.textContent = '# Select at least one language above.';
    currentCodeQLConfig = null;
    return;
  }

  const branch = document.getElementById('codeql-branch').value.trim() || 'main';
  const cron = document.getElementById('codeql-cron').value.trim() || '30 6 * * 1';

  try {
    const res = await fetch('/api/security/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: 'codeql',
        options: {
          languages,
          branches: [branch],
          cron
        }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate CodeQL workflow.');

    previewEl.textContent = data.content;
    currentCodeQLConfig = {
      templateId: 'codeql',
      options: { languages, branches: [branch], cron },
      content: data.content
    };
  } catch (err) {
    previewEl.textContent = `# Error: ${err.message}`;
    currentCodeQLConfig = null;
  }
}

// -----------------------------------------------------------------------------
// 4. Create Security Pull Request
// -----------------------------------------------------------------------------
async function previewSecurityPullRequest() {
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

  const includeDependabot = document.getElementById('pr-include-dependabot').checked;
  const includeCodeQL = document.getElementById('pr-include-codeql').checked;

  if (!includeDependabot && !includeCodeQL) {
    errorBox.textContent = 'Select at least one security configuration to include.';
    errorBox.hidden = false;
    return;
  }

  const configs = [];
  if (includeDependabot && currentDependabotConfig) {
    configs.push(currentDependabotConfig);
  }
  if (includeCodeQL && currentCodeQLConfig) {
    configs.push(currentCodeQLConfig);
  }

  if (configs.length === 0) {
    errorBox.textContent = 'Please generate the selected configuration(s) before previewing.';
    errorBox.hidden = false;
    return;
  }

  const replaceExisting = document.getElementById('pr-replace-existing').checked;

  previewBtn.disabled = true;
  previewBtn.textContent = 'Checking...';

  try {
    const res = await fetch('/api/security/preview-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, configs, replaceExisting })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to preview pull request.');

    // Render Preview Box
    const fileItems = data.files.map((f) =>
      el('li', {}, `${f.path} (${f.action === 'replace' ? 'overwrite existing file' : 'create new file'})`)
    );

    const warnings = [];
    if (data.hasConflicts) {
      warnings.push(
        el('p', { className: 'text-danger', style: { margin: 'var(--space-1) 0' } },
          `Conflict: The following file(s) already exist: ${data.conflicts.join(', ')}. Check "Overwrite existing configuration files" to replace them.`
        )
      );
    }

    if (data.workflowWarning) {
      warnings.push(
        el('div', { className: 'flash flash-warn', style: { margin: 'var(--space-2) 0' } }, [
          el('strong', {}, 'Workflow Permission Required: '),
          el('span', {}, data.workflowWarning)
        ])
      );
    }

    previewBox.replaceChildren(
      el('strong', {}, `Preview for ${data.repository.fullName} (target branch: chore/configure-security)`),
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

async function triggerSecurityPullRequest(e) {
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

  const includeDependabot = document.getElementById('pr-include-dependabot').checked;
  const includeCodeQL = document.getElementById('pr-include-codeql').checked;

  const configs = [];
  if (includeDependabot && currentDependabotConfig) configs.push(currentDependabotConfig);
  if (includeCodeQL && currentCodeQLConfig) configs.push(currentCodeQLConfig);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Opening Pull Request...';

  try {
    const res = await fetch('/api/security/trigger-pr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ repo, configs, replaceExisting })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create pull request.');

    successBox.replaceChildren(
      el('h4', { style: { margin: '0 0 var(--space-1) 0' } }, '🎉 Pull Request Created Successfully!'),
      el('p', { style: { margin: '0 0 var(--space-2) 0' } }, [
        el('a', {
          href: data.pullRequest.htmlUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { fontWeight: 'bold', fontSize: '15px' }
        }, `View Pull Request #${data.pullRequest.number}: ${data.pullRequest.title}`)
      ]),
      el('p', { className: 'text-small', style: { margin: 0 } },
        `Branch "${data.branch}" created with ${data.files.length} configuration file(s). Review and merge on GitHub.`
      )
    );
    successBox.hidden = false;
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Open Security PR';
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
      const input = document.getElementById('audit-repo').value.trim();
      if (input) runSecurityAudit(input);
    });
  }

  // Sample buttons
  for (const btn of document.querySelectorAll('.sample-repo')) {
    btn.addEventListener('click', () => {
      const repo = btn.dataset.repo;
      const input = document.getElementById('audit-repo');
      if (input && repo) {
        input.value = repo;
        runSecurityAudit(repo);
      }
    });
  }

  // Check URL query param e.g. /security.html?repo=owner/repo
  const params = new URLSearchParams(window.location.search);
  const initialRepo = params.get('repo');
  if (initialRepo) {
    const input = document.getElementById('audit-repo');
    if (input) {
      input.value = initialRepo;
      runSecurityAudit(initialRepo);
    }
  }

  // Dependabot Form & Preview
  const dependabotForm = document.getElementById('dependabot-form');
  if (dependabotForm) {
    dependabotForm.addEventListener('submit', (e) => {
      e.preventDefault();
      updateDependabotPreview();
    });
    // Auto-generate initial preview
    updateDependabotPreview();
  }

  const copyDependabotBtn = document.getElementById('copy-dependabot');
  if (copyDependabotBtn) {
    copyDependabotBtn.addEventListener('click', () => {
      const code = document.getElementById('dependabot-preview').textContent;
      copyToClipboard(code, copyDependabotBtn);
    });
  }

  const downloadDependabotBtn = document.getElementById('download-dependabot');
  if (downloadDependabotBtn) {
    downloadDependabotBtn.addEventListener('click', () => {
      if (currentDependabotConfig?.content) {
        downloadFile('dependabot.yml', currentDependabotConfig.content);
      }
    });
  }

  // CodeQL Form & Preview
  const codeqlForm = document.getElementById('codeql-form');
  if (codeqlForm) {
    codeqlForm.addEventListener('submit', (e) => {
      e.preventDefault();
      updateCodeQLPreview();
    });
    // Auto-generate initial preview
    updateCodeQLPreview();
  }

  const copyCodeQLBtn = document.getElementById('copy-codeql');
  if (copyCodeQLBtn) {
    copyCodeQLBtn.addEventListener('click', () => {
      const code = document.getElementById('codeql-preview').textContent;
      copyToClipboard(code, copyCodeQLBtn);
    });
  }

  const downloadCodeQLBtn = document.getElementById('download-codeql');
  if (downloadCodeQLBtn) {
    downloadCodeQLBtn.addEventListener('click', () => {
      if (currentCodeQLConfig?.content) {
        downloadFile('codeql.yml', currentCodeQLConfig.content);
      }
    });
  }

  // PR Preview & Submit
  const previewPrBtn = document.getElementById('pr-preview-btn');
  if (previewPrBtn) {
    previewPrBtn.addEventListener('click', previewSecurityPullRequest);
  }

  const prForm = document.getElementById('pr-form');
  if (prForm) {
    prForm.addEventListener('submit', triggerSecurityPullRequest);
  }
});
