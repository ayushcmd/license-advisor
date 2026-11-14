/**
 * Open Workers — Automation Client Controller
 *
 * Coordinates Repository Setup Audits, Workflow Generation, Workflow Health Inspections,
 * Code Quality Configs, and Consolidated Pull Requests.
 */

import { sanitizeUrl } from './ui-utils.js';

// Staged files cache for PR creation: Map<filename, { filename, content, templateId }>
const stagedFiles = new Map();

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showBanner(container, message, type = 'info') {
  container.innerHTML = `<div class="banner banner-${type}">${escapeHtml(message)}</div>`;
}

function clearBanner(container) {
  container.innerHTML = '';
}

// -------------------------------------------------------------
// 1. Repository Setup Audit
// -------------------------------------------------------------
const auditForm = document.getElementById('audit-form');
const auditFeedback = document.getElementById('audit-feedback');
const auditResults = document.getElementById('audit-results');
const auditRepoName = document.getElementById('audit-repo-name');
const auditRepoMeta = document.getElementById('audit-repo-meta');
const auditScoreNum = document.getElementById('audit-score-num');
const auditArchivedBadge = document.getElementById('audit-archived-badge');
const auditChecksList = document.getElementById('audit-checks-list');
const auditRecommendationsWrapper = document.getElementById('audit-recommendations-wrapper');
const auditRecommendationsList = document.getElementById('audit-recommendations-list');

if (auditForm) {
  auditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repoInput = document.getElementById('audit-repo').value.trim();
    if (!repoInput) return;

    clearBanner(auditFeedback);
    showBanner(auditFeedback, 'Inspecting repository configuration...', 'info');
    auditResults.style.display = 'none';

    try {
      const res = await fetch('/api/automation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoInput })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to audit repository setup.');
      }

      clearBanner(auditFeedback);
      renderAuditResults(data);

      // Pre-fill target repo in inspector and PR sections
      const inspectorRepo = document.getElementById('inspector-repo');
      if (inspectorRepo && !inspectorRepo.value) inspectorRepo.value = data.repository;
      const prRepo = document.getElementById('pr-repo');
      if (prRepo && !prRepo.value) prRepo.value = data.repository;

    } catch (err) {
      showBanner(auditFeedback, err.message, 'error');
    }
  });
}

function renderAuditResults(data) {
  auditRepoName.textContent = data.repository;
  auditRepoMeta.textContent = `Default branch: ${data.defaultBranch} • Primary Language: ${data.primaryLanguage}`;
  auditScoreNum.textContent = `${data.setupScore}%`;
  auditArchivedBadge.style.display = data.isArchived ? 'inline-block' : 'none';

  // Render checks
  auditChecksList.innerHTML = '';
  for (const check of data.findings) {
    const item = document.createElement('div');
    item.className = 'card stack-xs';
    item.style.padding = 'var(--space-2) var(--space-3)';

    let badgeClass = 'badge-secondary';
    let badgeText = check.status.toUpperCase();
    if (check.status === 'passed') {
      badgeClass = 'badge-success';
    } else if (check.status === 'missing') {
      badgeClass = 'badge-warning';
    } else if (check.status === 'needs_attention') {
      badgeClass = 'badge-error';
      badgeText = 'ATTENTION';
    }

    item.innerHTML = `
      <div class="cluster" style="justify-content: space-between; align-items: center;">
        <strong>${escapeHtml(check.name)}</strong>
        <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>
      </div>
      <p class="text-sm" style="margin: 0;">${escapeHtml(check.description)}</p>
      <span class="text-xs text-muted">${escapeHtml(check.recommendation)}</span>
    `;
    auditChecksList.appendChild(item);
  }

  // Render cross-module recommendations
  if (Array.isArray(data.recommendations) && data.recommendations.length > 0) {
    auditRecommendationsWrapper.style.display = 'block';
    auditRecommendationsList.innerHTML = '';
    for (const rec of data.recommendations) {
      const recItem = document.createElement('div');
      recItem.className = 'card cluster';
      recItem.style.justifyContent = 'space-between';
      recItem.style.alignItems = 'center';
      recItem.style.padding = 'var(--space-2) var(--space-3)';
      recItem.innerHTML = `
        <div class="stack-xs">
          <strong>${escapeHtml(rec.title)}</strong>
          <span class="text-sm text-muted">${escapeHtml(rec.description)}</span>
        </div>
        <a href="${escapeHtml(rec.actionUrl)}" class="btn btn-secondary btn-sm">${escapeHtml(rec.actionLabel)} &rarr;</a>
      `;
      auditRecommendationsList.appendChild(recItem);
    }
  } else {
    auditRecommendationsWrapper.style.display = 'none';
  }

  auditResults.style.display = 'block';
}

// -------------------------------------------------------------
// 2. Workflow Generator
// -------------------------------------------------------------
const wfSelect = document.getElementById('workflow-template-select');
const wfOptionsMap = {
  'node-ci': document.getElementById('options-node-ci'),
  'python-ci': document.getElementById('options-python-ci'),
  'matrix-ci': document.getElementById('options-matrix-ci'),
  'pr-validation': document.getElementById('options-pr-validation'),
  'maintenance': document.getElementById('options-maintenance')
};
const btnGenerateWf = document.getElementById('btn-generate-workflow');
const btnCopyWf = document.getElementById('btn-copy-workflow');
const btnDownloadWf = document.getElementById('btn-download-workflow');
const btnStageWf = document.getElementById('btn-stage-workflow');
const wfFilename = document.getElementById('workflow-filename');
const wfPreview = document.getElementById('workflow-preview');
const wfCopiedIndicator = document.getElementById('workflow-copied-indicator');

let currentGeneratedWorkflow = null;

if (wfSelect) {
  wfSelect.addEventListener('change', () => {
    const selected = wfSelect.value;
    for (const [key, el] of Object.entries(wfOptionsMap)) {
      if (el) el.style.display = key === selected ? 'block' : 'none';
    }
    const filenameMap = {
      'node-ci': '.github/workflows/node-ci.yml',
      'python-ci': '.github/workflows/python-ci.yml',
      'matrix-ci': '.github/workflows/matrix-ci.yml',
      'pr-validation': '.github/workflows/pr-validation.yml',
      'maintenance': '.github/workflows/maintenance.yml'
    };
    if (wfFilename) wfFilename.textContent = filenameMap[selected] || '.github/workflows/workflow.yml';
  });
}

function collectWorkflowOptions(templateId) {
  if (templateId === 'node-ci') {
    const nodeVersions = Array.from(document.querySelectorAll('input[name="node-version"]:checked')).map((el) => el.value);
    const packageManager = document.getElementById('node-pkg-manager').value;
    const testCommand = document.getElementById('node-test-cmd').value;
    const includeLint = document.getElementById('node-include-lint').checked;
    const includeBuild = document.getElementById('node-include-build').checked;
    return { nodeVersions, packageManager, testCommand, includeLint, includeBuild };
  } else if (templateId === 'python-ci') {
    const pythonVersions = Array.from(document.querySelectorAll('input[name="py-version"]:checked')).map((el) => el.value);
    const testCommand = document.getElementById('py-test-cmd').value;
    const includeLint = document.getElementById('py-include-lint').checked;
    const includeTypeCheck = document.getElementById('py-include-typecheck').checked;
    return { pythonVersions, testCommand, includeLint, includeTypeCheck };
  } else if (templateId === 'matrix-ci') {
    const operatingSystems = Array.from(document.querySelectorAll('input[name="matrix-os"]:checked')).map((el) => el.value);
    const runtime = document.getElementById('matrix-runtime').value;
    return { operatingSystems, runtime };
  } else if (templateId === 'pr-validation') {
    const testCommand = document.getElementById('pr-val-test-cmd').value;
    return { testCommand };
  } else if (templateId === 'maintenance') {
    const task = document.getElementById('maint-task').value;
    const cron = document.getElementById('maint-cron').value;
    return { task, cron };
  }
  return {};
}

async function triggerGenerateWorkflow() {
  const templateId = wfSelect.value;
  const options = collectWorkflowOptions(templateId);

  try {
    const res = await fetch('/api/automation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, options })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate workflow.');

    currentGeneratedWorkflow = data;
    wfFilename.textContent = data.filename;
    wfPreview.textContent = data.content;
  } catch (err) {
    alert(`Generation error: ${err.message}`);
  }
}

if (btnGenerateWf) btnGenerateWf.addEventListener('click', triggerGenerateWorkflow);

if (btnCopyWf) {
  btnCopyWf.addEventListener('click', async () => {
    if (!wfPreview.textContent) await triggerGenerateWorkflow();
    if (wfPreview.textContent) {
      await navigator.clipboard.writeText(wfPreview.textContent);
      wfCopiedIndicator.textContent = '✓ Copied to clipboard';
      setTimeout(() => { wfCopiedIndicator.textContent = ''; }, 3000);
    }
  });
}

if (btnDownloadWf) {
  btnDownloadWf.addEventListener('click', async () => {
    if (!currentGeneratedWorkflow) await triggerGenerateWorkflow();
    if (currentGeneratedWorkflow) {
      const blob = new Blob([currentGeneratedWorkflow.content], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentGeneratedWorkflow.filename.split('/').pop() || 'workflow.yml';
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

if (btnStageWf) {
  btnStageWf.addEventListener('click', async () => {
    if (!currentGeneratedWorkflow) await triggerGenerateWorkflow();
    if (currentGeneratedWorkflow) {
      stagedFiles.set(currentGeneratedWorkflow.filename, {
        path: currentGeneratedWorkflow.filename,
        content: currentGeneratedWorkflow.content,
        templateId: currentGeneratedWorkflow.templateId
      });
      renderStagedFiles();
      wfCopiedIndicator.textContent = `✓ Staged ${currentGeneratedWorkflow.filename} for PR`;
      setTimeout(() => { wfCopiedIndicator.textContent = ''; }, 3000);
    }
  });
}

// -------------------------------------------------------------
// 3. Workflow Health Inspector
// -------------------------------------------------------------
const inspectorForm = document.getElementById('inspector-form');
const inspectorFeedback = document.getElementById('inspector-feedback');
const inspectorResults = document.getElementById('inspector-results');
const inspectorCards = document.getElementById('inspector-cards');

if (inspectorForm) {
  inspectorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repoInput = document.getElementById('inspector-repo').value.trim();
    if (!repoInput) return;

    clearBanner(inspectorFeedback);
    showBanner(inspectorFeedback, 'Inspecting GitHub Actions workflows...', 'info');
    inspectorResults.style.display = 'none';

    try {
      const res = await fetch('/api/automation/inspect-workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect workflows.');

      clearBanner(inspectorFeedback);
      renderInspectorResults(data);
    } catch (err) {
      showBanner(inspectorFeedback, err.message, 'error');
    }
  });
}

function renderInspectorResults(data) {
  inspectorCards.innerHTML = '';

  if (!Array.isArray(data.reports) || data.reports.length === 0) {
    inspectorCards.innerHTML = '<p class="text-muted">No workflow files found under .github/workflows/ in default branch.</p>';
    inspectorResults.style.display = 'block';
    return;
  }

  for (const report of data.reports) {
    const card = document.createElement('div');
    card.className = 'card stack-sm';

    let scoreBadge = 'badge-success';
    if (report.healthScore < 70) scoreBadge = 'badge-error';
    else if (report.healthScore < 90) scoreBadge = 'badge-warning';

    let findingsHtml = '';
    if (report.findings.length === 0) {
      findingsHtml = '<p class="text-sm text-muted">✓ No hygiene or security issues detected. Follows best practices.</p>';
    } else {
      findingsHtml = report.findings.map((f) => {
        let fBadge = 'badge-secondary';
        if (f.severity === 'critical') fBadge = 'badge-error';
        else if (f.severity === 'high') fBadge = 'badge-error';
        else if (f.severity === 'warning') fBadge = 'badge-warning';

        return `
          <div class="card stack-xs" style="background: var(--bg-canvas-subtle); padding: var(--space-2);">
            <div class="cluster" style="justify-content: space-between; align-items: center;">
              <strong>${escapeHtml(f.title)}</strong>
              <span class="badge ${fBadge}">${escapeHtml(f.severity.toUpperCase())}</span>
            </div>
            <p class="text-sm" style="margin: 0;">${escapeHtml(f.explanation)}</p>
            <span class="text-xs text-muted">Suggestion: ${escapeHtml(f.suggestion)}</span>
          </div>
        `;
      }).join('');
    }

    card.innerHTML = `
      <div class="cluster" style="justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: var(--space-2);">
        <div>
          <strong style="font-family: monospace;">${escapeHtml(report.path)}</strong>
          <span class="text-xs text-muted" style="display: block;">${escapeHtml(report.summary)}</span>
        </div>
        <div style="text-align: right;">
          <span class="text-xs text-muted" style="display: block;">Health Score</span>
          <span class="badge ${scoreBadge}" style="font-size: 1rem;">${report.healthScore}%</span>
        </div>
      </div>
      <div class="stack-xs" style="margin-top: var(--space-2);">
        ${findingsHtml}
      </div>
    `;

    inspectorCards.appendChild(card);
  }

  inspectorResults.style.display = 'block';
}

// -------------------------------------------------------------
// 4. Code Quality Configurations
// -------------------------------------------------------------
const qualitySelect = document.getElementById('quality-template-select');
const qualityOptionsMap = {
  'editorconfig': document.getElementById('options-editorconfig'),
  'prettier': document.getElementById('options-prettier'),
  'eslint': document.getElementById('options-eslint'),
  'gitattributes': document.getElementById('options-gitattributes'),
  'gitignore': document.getElementById('options-gitignore')
};
const btnGenerateQuality = document.getElementById('btn-generate-quality');
const btnCopyQuality = document.getElementById('btn-copy-quality');
const btnDownloadQuality = document.getElementById('btn-download-quality');
const btnStageQuality = document.getElementById('btn-stage-quality');
const qualityFilename = document.getElementById('quality-filename');
const qualityPreview = document.getElementById('quality-preview');
const qualityCopiedIndicator = document.getElementById('quality-copied-indicator');

let currentGeneratedQuality = null;

if (qualitySelect) {
  qualitySelect.addEventListener('change', () => {
    const selected = qualitySelect.value;
    for (const [key, el] of Object.entries(qualityOptionsMap)) {
      if (el) el.style.display = key === selected ? 'block' : 'none';
    }
    const filenameMap = {
      'editorconfig': '.editorconfig',
      'prettier': '.prettierrc.json',
      'eslint': 'eslint.config.js',
      'gitattributes': '.gitattributes',
      'gitignore': '.gitignore'
    };
    if (qualityFilename) qualityFilename.textContent = filenameMap[selected] || '.editorconfig';
  });
}

function collectQualityOptions(templateId) {
  if (templateId === 'editorconfig') {
    const indentStyle = document.getElementById('ec-indent-style').value;
    const indentSize = document.getElementById('ec-indent-size').value;
    return { indentStyle, indentSize };
  } else if (templateId === 'prettier') {
    const semi = document.getElementById('pr-semi').checked;
    const singleQuote = document.getElementById('pr-single-quote').checked;
    return { semi, singleQuote };
  } else if (templateId === 'eslint') {
    const typescript = document.getElementById('es-ts').checked;
    return { typescript };
  } else if (templateId === 'gitattributes') {
    const includeBinaryRules = document.getElementById('ga-binary').checked;
    return { includeBinaryRules };
  } else if (templateId === 'gitignore') {
    const ecosystem = document.getElementById('gi-ecosystem').value;
    return { ecosystem };
  }
  return {};
}

async function triggerGenerateQuality() {
  const templateId = qualitySelect.value;
  const options = collectQualityOptions(templateId);

  try {
    const res = await fetch('/api/automation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, options })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate configuration.');

    currentGeneratedQuality = data;
    qualityFilename.textContent = data.filename;
    qualityPreview.textContent = data.content;
  } catch (err) {
    alert(`Configuration error: ${err.message}`);
  }
}

if (btnGenerateQuality) btnGenerateQuality.addEventListener('click', triggerGenerateQuality);

if (btnCopyQuality) {
  btnCopyQuality.addEventListener('click', async () => {
    if (!qualityPreview.textContent) await triggerGenerateQuality();
    if (qualityPreview.textContent) {
      await navigator.clipboard.writeText(qualityPreview.textContent);
      qualityCopiedIndicator.textContent = '✓ Copied to clipboard';
      setTimeout(() => { qualityCopiedIndicator.textContent = ''; }, 3000);
    }
  });
}

if (btnDownloadQuality) {
  btnDownloadQuality.addEventListener('click', async () => {
    if (!currentGeneratedQuality) await triggerGenerateQuality();
    if (currentGeneratedQuality) {
      const blob = new Blob([currentGeneratedQuality.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentGeneratedQuality.filename.split('/').pop() || 'config';
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

if (btnStageQuality) {
  btnStageQuality.addEventListener('click', async () => {
    if (!currentGeneratedQuality) await triggerGenerateQuality();
    if (currentGeneratedQuality) {
      stagedFiles.set(currentGeneratedQuality.filename, {
        path: currentGeneratedQuality.filename,
        content: currentGeneratedQuality.content,
        templateId: currentGeneratedQuality.templateId
      });
      renderStagedFiles();
      qualityCopiedIndicator.textContent = `✓ Staged ${currentGeneratedQuality.filename} for PR`;
      setTimeout(() => { qualityCopiedIndicator.textContent = ''; }, 3000);
    }
  });
}

// -------------------------------------------------------------
// 5. Consolidated Automation Pull Request
// -------------------------------------------------------------
const stagedCount = document.getElementById('staged-count');
const stagedFilesList = document.getElementById('staged-files-list');
const noStagedMsg = document.getElementById('no-staged-msg');
const btnPreviewPr = document.getElementById('btn-preview-pr');
const prReplaceExisting = document.getElementById('pr-replace-existing');
const prPreviewResults = document.getElementById('pr-preview-results');
const prWorkflowWarning = document.getElementById('pr-workflow-warning');
const prConflictAlert = document.getElementById('pr-conflict-alert');
const prReadyAlert = document.getElementById('pr-ready-alert');
const prFileStatuses = document.getElementById('pr-file-statuses');
const btnSubmitPr = document.getElementById('btn-submit-pr');
const prResultBanner = document.getElementById('pr-result-banner');

function renderStagedFiles() {
  stagedCount.textContent = stagedFiles.size;
  if (stagedFiles.size === 0) {
    stagedFilesList.innerHTML = '<p class="text-sm text-muted">No files staged yet. Click "Stage for PR" in Sections 2 or 4.</p>';
    btnSubmitPr.disabled = true;
    prPreviewResults.style.display = 'none';
    return;
  }

  stagedFilesList.innerHTML = '';
  for (const [path, file] of stagedFiles.entries()) {
    const item = document.createElement('div');
    item.className = 'cluster';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = 'var(--space-1) var(--space-2)';
    item.style.background = 'var(--bg-canvas-subtle)';
    item.style.borderRadius = 'var(--border-radius-sm)';

    item.innerHTML = `
      <span style="font-family: monospace; font-size: 0.9rem;">${escapeHtml(path)}</span>
      <button type="button" class="btn btn-secondary btn-sm remove-staged-btn" data-path="${escapeHtml(path)}">&times; Remove</button>
    `;
    stagedFilesList.appendChild(item);
  }

  document.querySelectorAll('.remove-staged-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-path');
      stagedFiles.delete(p);
      renderStagedFiles();
    });
  });
}

if (btnPreviewPr) {
  btnPreviewPr.addEventListener('click', async () => {
    const repoInput = document.getElementById('pr-repo').value.trim();
    if (!repoInput) {
      alert('Please enter a target repository (owner/repo).');
      return;
    }
    if (stagedFiles.size === 0) {
      alert('Please stage at least one file to preview.');
      return;
    }

    const filesArray = Array.from(stagedFiles.values()).map((f) => ({
      path: f.path,
      content: f.content
    }));

    try {
      const res = await fetch('/api/automation/preview-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: repoInput,
          files: filesArray,
          replaceExisting: prReplaceExisting.checked
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to preview pull request.');

      renderPrPreview(data);
    } catch (err) {
      alert(`Preview error: ${err.message}`);
    }
  });
}

function renderPrPreview(data) {
  prPreviewResults.style.display = 'block';

  // Workflow permission warning
  if (data.workflowWarning) {
    prWorkflowWarning.textContent = data.workflowWarning;
    prWorkflowWarning.style.display = 'block';
  } else {
    prWorkflowWarning.style.display = 'none';
  }

  // Conflict or ready alert
  if (!data.canProceed) {
    prConflictAlert.textContent = `Conflicts detected: ${data.conflicts.join(', ')} already exist on default branch. Check "Overwrite existing files" to proceed.`;
    prConflictAlert.style.display = 'block';
    prReadyAlert.style.display = 'none';
    btnSubmitPr.disabled = true;
  } else {
    prConflictAlert.style.display = 'none';
    prReadyAlert.textContent = '✓ Ready to create Pull Request. All file checks passed.';
    prReadyAlert.style.display = 'block';
    btnSubmitPr.disabled = false;
  }

  // Render individual file statuses
  prFileStatuses.innerHTML = '';
  for (const f of data.files) {
    const row = document.createElement('div');
    row.className = 'cluster';
    row.style.justifyContent = 'space-between';
    row.style.padding = 'var(--space-1) var(--space-2)';

    let badge = 'badge-success';
    if (f.status === 'conflict') badge = 'badge-error';
    else if (f.status === 'will_replace') badge = 'badge-warning';

    row.innerHTML = `
      <span style="font-family: monospace;">${escapeHtml(f.path)}</span>
      <span class="badge ${badge}">${escapeHtml(f.status.replace('_', ' ').toUpperCase())}</span>
    `;
    prFileStatuses.appendChild(row);
  }
}

// -------------------------------------------------------------
// Auth Modal & Pull Request Trigger
// -------------------------------------------------------------
const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const btnCancelAuth = document.getElementById('btn-cancel-auth');
const patInput = document.getElementById('pat-input');

if (btnSubmitPr) {
  btnSubmitPr.addEventListener('click', () => {
    if (authModal) authModal.showModal();
  });
}

if (btnCancelAuth && authModal) {
  btnCancelAuth.addEventListener('click', () => {
    authModal.close();
  });
}

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = patInput.value.trim();
    if (!token) return;

    authModal.close();
    showBanner(prResultBanner, 'Creating repository automation pull request...', 'info');

    const repoInput = document.getElementById('pr-repo').value.trim();
    const filesArray = Array.from(stagedFiles.values()).map((f) => ({
      path: f.path,
      content: f.content
    }));

    try {
      const res = await fetch('/api/automation/trigger-pr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          repo: repoInput,
          files: filesArray,
          replaceExisting: prReplaceExisting.checked
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create pull request.');
      }

      prResultBanner.innerHTML = `
        <div class="banner banner-success">
          <strong>Pull Request Created Successfully!</strong><br>
          <a href="${escapeHtml(sanitizeUrl(data.pullUrl, '#'))}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="margin-top: var(--space-2); display: inline-block;">
            View PR #${escapeHtml(String(data.pullNumber))} on GitHub &rarr;
          </a>
          <div class="text-xs text-muted" style="margin-top: var(--space-1);">
            Branch: <code>${escapeHtml(data.branch)}</code> • Created by @${escapeHtml(data.caller || 'user')}
          </div>
        </div>
      `;

      // Clear staged files on success
      stagedFiles.clear();
      renderStagedFiles();
      patInput.value = '';

    } catch (err) {
      showBanner(prResultBanner, err.message, 'error');
    }
  });
}

// Initial render
renderStagedFiles();
// Generate default Node.js CI workflow preview on initial load
triggerGenerateWorkflow();
// Generate default EditorConfig preview on initial load
triggerGenerateQuality();

// Check URL query param e.g. /automation.html?repo=owner/repo
const params = new URLSearchParams(window.location.search);
const initialRepo = params.get('repo');
if (initialRepo) {
  const auditRepo = document.getElementById('audit-repo');
  if (auditRepo) {
    auditRepo.value = initialRepo;
    if (auditForm && typeof auditForm.requestSubmit === 'function') {
      auditForm.requestSubmit();
    } else if (auditForm) {
      auditForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }
}
