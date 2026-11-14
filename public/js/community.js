/**
 * Open Workers — Community Standards & Automated PRs
 *
 * Handles:
 * 1. Community document generation (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT)
 * 2. Issue & PR template generation (.github/ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md)
 * 3. Repository community health audit (POST /api/community/analyze)
 * 4. Consolidated community Pull Request workflow (POST /api/community/trigger-pr)
 */

import { sanitizeUrl } from './ui-utils.js';

let allTemplates = [];
const docDrafts = new Map();
const tplDrafts = new Map();

// --- Section 1: Community Documents Elements ---
const docSelect = document.getElementById('community-template');
const docForm = document.getElementById('community-form');
const docFields = document.getElementById('community-fields');
const docPreview = document.getElementById('community-preview');
const docStatus = document.getElementById('community-status');
const docCopy = document.getElementById('community-copy');
const docDownload = document.getElementById('community-download');
const docGenerate = document.getElementById('community-generate');
const docWarning = document.getElementById('community-warning');
const docFilename = document.getElementById('community-filename');
let docOutput = null;
let docRevision = 0;

// --- Section 2: Issue & PR Templates Elements ---
const tplSelect = document.getElementById('template-select');
const tplForm = document.getElementById('template-form');
const tplFields = document.getElementById('template-fields');
const tplPreview = document.getElementById('template-preview');
const tplStatus = document.getElementById('template-status');
const tplCopy = document.getElementById('template-copy');
const tplDownload = document.getElementById('template-download');
const tplGenerate = document.getElementById('template-generate');
const tplFilename = document.getElementById('template-filename');
let tplOutput = null;
let tplRevision = 0;

// --- Section 3: Community Health Elements ---
const healthForm = document.getElementById('health-form');
const healthRepoInput = document.getElementById('health-repo-input');
const healthSubmitBtn = document.getElementById('health-submit-btn');
const healthStatus = document.getElementById('health-status');
const healthResults = document.getElementById('health-results');
const healthRepoTitle = document.getElementById('health-repo-title');
const healthScoreBadge = document.getElementById('health-score-badge');
const healthStatScore = document.getElementById('health-stat-score');
const healthStatPresent = document.getElementById('health-stat-present');
const healthStatMissing = document.getElementById('health-stat-missing');
const healthTbody = document.getElementById('health-tbody');
const healthPopulateBtn = document.getElementById('health-populate-pr-btn');
let lastHealthReport = null;

// --- Section 4: Create Community PR Elements ---
const prForm = document.getElementById('comm-pr-form');
const prRepo = document.getElementById('comm-pr-repo');
const prToken = document.getElementById('comm-pr-token');
const prProjectName = document.getElementById('comm-pr-project-name');
const prContact = document.getElementById('comm-pr-contact');
const prReplaceExisting = document.getElementById('comm-pr-replace-existing');
const prPreviewBtn = document.getElementById('comm-pr-preview-btn');
const prSubmitBtn = document.getElementById('comm-pr-submit-btn');
const prStatus = document.getElementById('comm-pr-status');
const prOutput = document.getElementById('comm-pr-output');
const prOutputTitle = document.getElementById('comm-pr-output-title');
const prOutputContent = document.getElementById('comm-pr-output-content');

// ==========================================
// 1. Community Documents Logic
// ==========================================
function invalidateDoc() {
  docRevision += 1;
  docOutput = null;
  docPreview.textContent = 'Generate a document to preview its Markdown source.';
  docCopy.disabled = docDownload.disabled = true;
  docStatus.textContent = '';
}

function renderDocFields() {
  invalidateDoc();
  docFields.replaceChildren();
  const template = allTemplates.find((t) => t.id === docSelect.value);
  if (!template) return;

  for (const f of template.fields) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.htmlFor = `community-${f.id}`;
    label.textContent = f.label + (f.required ? ' *' : '');
    const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
    if (f.type !== 'textarea') input.type = f.type === 'url' ? 'url' : 'text';
    else input.rows = 3;
    input.className = 'input';
    input.name = f.id;
    input.id = label.htmlFor;
    input.maxLength = f.maxLength;
    input.required = f.required;
    input.value = docDrafts.get(template.id)?.[f.id] ?? f.defaultValue;
    group.append(label, input);
    docFields.append(group);
  }
  docFilename.textContent = template.filename;
  if (docWarning) docWarning.hidden = template.id !== 'code-of-conduct';
}

docForm?.addEventListener('input', () => {
  docDrafts.set(docSelect.value, Object.fromEntries(new FormData(docForm)));
  invalidateDoc();
});
docSelect?.addEventListener('change', renderDocFields);

docForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  invalidateDoc();
  const reqRev = docRevision;
  docGenerate.disabled = true;
  docStatus.textContent = 'Generating document…';

  try {
    const res = await fetch('/api/community/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: docSelect.value,
        options: Object.fromEntries(new FormData(docForm))
      })
    });
    const data = await res.json();
    if (docRevision !== reqRev) return;
    if (!res.ok) throw new Error(data.error || 'Generation failed.');
    docOutput = data;
    docPreview.textContent = data.content;
    docCopy.disabled = docDownload.disabled = false;
    docStatus.textContent = 'Ready. Review the document before using it.';
    docPreview.focus();
  } catch (err) {
    if (docRevision === reqRev) docStatus.textContent = err.message;
  } finally {
    docGenerate.disabled = false;
  }
});

docCopy?.addEventListener('click', async () => {
  if (!docOutput) return;
  try {
    await navigator.clipboard.writeText(docOutput.content);
    docStatus.textContent = 'Markdown copied to clipboard.';
  } catch {
    docStatus.textContent = 'Clipboard unavailable. Select text manually or download.';
  }
});

docDownload?.addEventListener('click', () => {
  if (!docOutput) return;
  const blob = new Blob([docOutput.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = docOutput.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  docStatus.textContent = `Downloaded ${docOutput.filename}.`;
});

// ==========================================
// 2. Issue & PR Templates Logic
// ==========================================
function invalidateTpl() {
  tplRevision += 1;
  tplOutput = null;
  tplPreview.textContent = 'Generate a template to preview its source.';
  tplCopy.disabled = tplDownload.disabled = true;
  tplStatus.textContent = '';
}

function renderTplFields() {
  invalidateTpl();
  tplFields.replaceChildren();
  const template = allTemplates.find((t) => t.id === tplSelect.value);
  if (!template) return;

  for (const f of template.fields) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.htmlFor = `template-${f.id}`;
    label.textContent = f.label + (f.required ? ' *' : '');
    const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
    if (f.type !== 'textarea') input.type = f.type === 'url' ? 'url' : 'text';
    else input.rows = 4;
    input.className = 'input';
    input.name = f.id;
    input.id = label.htmlFor;
    input.maxLength = f.maxLength;
    input.required = f.required;
    input.value = tplDrafts.get(template.id)?.[f.id] ?? f.defaultValue;
    group.append(label, input);
    tplFields.append(group);
  }
  tplFilename.textContent = template.filename;
}

tplForm?.addEventListener('input', () => {
  tplDrafts.set(tplSelect.value, Object.fromEntries(new FormData(tplForm)));
  invalidateTpl();
});
tplSelect?.addEventListener('change', renderTplFields);

tplForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  invalidateTpl();
  const reqRev = tplRevision;
  tplGenerate.disabled = true;
  tplStatus.textContent = 'Generating template…';

  try {
    const res = await fetch('/api/community/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: tplSelect.value,
        options: Object.fromEntries(new FormData(tplForm))
      })
    });
    const data = await res.json();
    if (tplRevision !== reqRev) return;
    if (!res.ok) throw new Error(data.error || 'Generation failed.');
    tplOutput = data;
    tplPreview.textContent = data.content;
    tplCopy.disabled = tplDownload.disabled = false;
    tplStatus.textContent = 'Ready. Review the template before using it.';
    tplPreview.focus();
  } catch (err) {
    if (tplRevision === reqRev) tplStatus.textContent = err.message;
  } finally {
    tplGenerate.disabled = false;
  }
});

tplCopy?.addEventListener('click', async () => {
  if (!tplOutput) return;
  try {
    await navigator.clipboard.writeText(tplOutput.content);
    tplStatus.textContent = 'Template copied to clipboard.';
  } catch {
    tplStatus.textContent = 'Clipboard unavailable. Select text manually or download.';
  }
});

tplDownload?.addEventListener('click', () => {
  if (!tplOutput) return;
  const blob = new Blob([tplOutput.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const basename = tplOutput.filename.split('/').pop() || 'template.md';
  a.download = basename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  tplStatus.textContent = `Downloaded ${basename}.`;
});

// ==========================================
// 3. Community Health Audit Logic
// ==========================================
healthForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const repoInput = healthRepoInput.value.trim();
  if (!repoInput) return;

  healthSubmitBtn.disabled = true;
  healthStatus.textContent = `Auditing community standards for "${repoInput}"…`;
  healthResults.hidden = true;

  try {
    const res = await fetch('/api/community/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoInput })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Repository audit failed.');

    lastHealthReport = data;
    renderHealthResults(data);
    healthStatus.textContent = `Audit completed for ${data.repository.fullName}.`;
  } catch (err) {
    healthStatus.textContent = `Error: ${err.message}`;
  } finally {
    healthSubmitBtn.disabled = false;
  }
});

function renderHealthResults(report) {
  healthRepoTitle.textContent = report.repository.fullName;
  const score = report.summary.score;
  healthStatScore.textContent = `${score}%`;
  healthStatPresent.textContent = `${report.summary.present} / ${report.summary.total}`;
  healthStatMissing.textContent = `${report.summary.missing} / ${report.summary.total}`;

  healthScoreBadge.textContent = `Health: ${score}%`;
  healthScoreBadge.className = 'badge ' + (score >= 80 ? 'badge-success' : score >= 50 ? 'badge-warning' : 'badge-danger');

  healthTbody.replaceChildren();
  for (const item of report.findings) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.innerHTML = `<strong>${escapeHtml(item.label)}</strong>`;

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = item.status === 'present' ? 'badge badge-success' : 'badge badge-warning';
    badge.textContent = item.status === 'present' ? 'Present' : 'Missing';
    tdStatus.append(badge);

    const tdPath = document.createElement('td');
    tdPath.innerHTML = item.path ? `<code>${escapeHtml(item.path)}</code>` : '<span class="text-muted">—</span>';

    const tdMsg = document.createElement('td');
    tdMsg.className = 'text-small';
    tdMsg.textContent = item.message;

    tr.append(tdName, tdStatus, tdPath, tdMsg);
    healthTbody.append(tr);
  }

  healthResults.hidden = false;
}

healthPopulateBtn?.addEventListener('click', () => {
  if (!lastHealthReport) return;
  prRepo.value = lastHealthReport.repository.fullName;

  // Uncheck all checkboxes first
  const checkboxes = document.querySelectorAll('input[name="doc-select"]');
  checkboxes.forEach((cb) => (cb.checked = false));

  // Check matching missing templates
  const files = lastHealthReport.files;
  if (files.contributing?.status === 'missing') setChecked('contributing', true);
  if (files.codeOfConduct?.status === 'missing') setChecked('code-of-conduct', true);
  if (files.security?.status === 'missing') setChecked('security', true);
  if (files.support?.status === 'missing') setChecked('support', true);
  if (files.pullRequestTemplate?.status === 'missing') setChecked('pull-request-template', true);
  if (files.issueTemplates?.status === 'missing') {
    setChecked('issue-bug-report', true);
    setChecked('issue-feature-request', true);
  }

  prStatus.textContent = 'Selected missing standards in the PR creator below.';
  document.getElementById('section-pr')?.scrollIntoView({ behavior: 'smooth' });
});

function setChecked(val, checked) {
  const el = document.querySelector(`input[name="doc-select"][value="${val}"]`);
  if (el) el.checked = checked;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ==========================================
// 4. Create Community PR Logic
// ==========================================
function buildDocumentsPayload() {
  const selectedCbs = Array.from(document.querySelectorAll('input[name="doc-select"]:checked'));
  if (selectedCbs.length === 0) return [];

  const projectName = prProjectName.value.trim() || 'Project';
  const contact = prContact.value.trim() || 'maintainers@example.com';

  return selectedCbs.map((cb) => {
    const templateId = cb.value;
    const options = {};

    switch (templateId) {
      case 'contributing':
        options.projectName = projectName;
        options.workflow = 'Discuss substantial changes before starting. Keep contributions focused and explain how they were tested.';
        options.pullRequests = 'Describe the change, link related issues, and include relevant tests.';
        options.issues = 'Search existing issues first. Include reproduction steps and expected behavior. Report vulnerabilities privately.';
        options.community = 'Be respectful, constructive, and welcoming.';
        break;
      case 'code-of-conduct':
        options.communityName = projectName;
        options.enforcementContact = contact;
        options.reportingInstructions = 'Contact the enforcement team privately. Include relevant context and evidence.';
        break;
      case 'security':
        options.projectName = projectName;
        options.supportedVersions = 'Supported releases';
        options.reportingContact = contact;
        options.reportingInstructions = 'Send details privately, including affected versions, impact, and reproduction steps. Do not open a public issue for an undisclosed vulnerability.';
        break;
      case 'support':
        options.projectName = projectName;
        options.questionsVsBugs = 'Use support channels for questions. Use the issue tracker for reproducible bugs. Send vulnerability reports privately using the security policy.';
        break;
      case 'issue-bug-report':
        options.issueTitle = '[BUG] ';
        options.about = 'Create a report to help us improve';
        options.labels = 'bug';
        options.description = 'A clear and concise description of the bug.';
        options.reproductionSteps = '1. Go to ...\n2. Click on ...\n3. See error';
        break;
      case 'issue-feature-request':
        options.issueTitle = '[FEATURE] ';
        options.about = 'Suggest an idea or enhancement for this project';
        options.labels = 'enhancement';
        options.problemStatement = 'A clear description of what the problem or limitation is.';
        options.proposedSolution = 'A clear description of what you want to happen.';
        break;
      case 'issue-documentation':
        options.issueTitle = '[DOCS] ';
        options.about = 'Suggest improvements or report errors in documentation';
        options.labels = 'documentation';
        options.problemDescription = 'What is unclear, incorrect, or missing in the current documentation?';
        break;
      case 'pull-request-template':
        options.summary = 'A concise summary of changes introduced in this pull request.';
        options.testing = 'Describe the tests performed and instructions for verification.';
        options.checklist = 'My code follows project style guidelines\nI have performed a self-review of my code\nAll new and existing tests pass locally\nDocumentation has been updated accordingly';
        break;
      default:
        break;
    }

    return { templateId, options };
  });
}

prPreviewBtn?.addEventListener('click', async () => {
  const repo = prRepo.value.trim();
  if (!repo) {
    prStatus.textContent = 'Please enter a target repository.';
    prRepo.focus();
    return;
  }
  const documents = buildDocumentsPayload();
  if (documents.length === 0) {
    prStatus.textContent = 'Select at least one document or template to preview.';
    return;
  }

  prPreviewBtn.disabled = true;
  prStatus.textContent = 'Checking repository and building preview…';
  prOutput.hidden = true;

  try {
    const res = await fetch('/api/community/preview-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo,
        documents,
        replaceExisting: prReplaceExisting.checked
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Preview failed.');

    prOutputTitle.textContent = `Proposed Pull Request Preview — ${data.repository}`;
    let html = `
      <p class="text-small">Target default branch: <code>${escapeHtml(data.defaultBranch)}</code> &middot; Base feature branch: <code>${escapeHtml(data.baseBranch)}</code></p>
      <div class="table-scroll" style="margin-top: var(--space-2);">
        <table class="data-table">
          <thead><tr><th>Target File</th><th>Action</th><th>Status on Default Branch</th></tr></thead>
          <tbody>
    `;

    for (const f of data.files) {
      const actionBadge = f.action === 'replace' ? '<span class="badge badge-warning">Replace</span>' : '<span class="badge badge-success">Add</span>';
      const existsBadge = f.exists ? '<span class="badge badge-info">Exists</span>' : '<span class="badge badge-neutral">New</span>';
      html += `<tr><td><code>${escapeHtml(f.path)}</code></td><td>${actionBadge}</td><td>${existsBadge}</td></tr>`;
    }

    html += `</tbody></table></div>`;

    if (data.hasConflicts) {
      html += `
        <div class="flash flash-warning" style="margin-top: var(--space-3);">
          <strong>Conflict Guard Warning:</strong> The following file(s) already exist on the default branch:
          <code>${escapeHtml(data.conflicts.join(', '))}</code>.
          Check "Overwrite existing community files" to update them.
        </div>
      `;
    }

    prOutputContent.innerHTML = html;
    prOutput.hidden = false;
    prStatus.textContent = `Preview ready for ${data.files.length} file(s).`;
  } catch (err) {
    prStatus.textContent = `Preview error: ${err.message}`;
  } finally {
    prPreviewBtn.disabled = false;
  }
});

prForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const repo = prRepo.value.trim();
  const token = prToken.value.trim();

  if (!repo) {
    prStatus.textContent = 'Please enter a target repository.';
    prRepo.focus();
    return;
  }
  if (!token) {
    prStatus.textContent = 'Please enter your GitHub Personal Access Token for write authorization.';
    prToken.focus();
    return;
  }

  const documents = buildDocumentsPayload();
  if (documents.length === 0) {
    prStatus.textContent = 'Select at least one document or template to include.';
    return;
  }

  prSubmitBtn.disabled = true;
  prPreviewBtn.disabled = true;
  prStatus.textContent = `Opening consolidated Community Pull Request for "${repo}"…`;
  prOutput.hidden = true;

  try {
    const res = await fetch('/api/community/trigger-pr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        repo,
        documents,
        replaceExisting: prReplaceExisting.checked
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create Pull Request.');

    prOutputTitle.textContent = 'Pull Request Created Successfully!';
    prOutputContent.innerHTML = `
      <div class="flash flash-success stack-sm">
        <p><strong>Pull Request opened:</strong> <a href="${escapeHtml(sanitizeUrl(data.pullUrl, '#'))}" target="_blank" rel="noopener noreferrer">PR #${data.pullNumber} (${escapeHtml(data.pullTitle)})</a></p>
        <p class="text-small">Dedicated branch: <code>${escapeHtml(data.branch)}</code></p>
        <p class="text-small">Committed files (${data.files.length}): <code>${escapeHtml(data.files.join(', '))}</code></p>
      </div>
    `;
    prOutput.hidden = false;
    prStatus.textContent = `Successfully opened Pull Request #${data.pullNumber}.`;
  } catch (err) {
    prStatus.textContent = `Pull Request failed: ${err.message}`;
  } finally {
    prSubmitBtn.disabled = false;
    prPreviewBtn.disabled = false;
  }
});

// ==========================================
// Initialization: Load Templates
// ==========================================
async function init() {
  try {
    const res = await fetch('/api/community/templates');
    if (!res.ok) throw new Error('Could not load community templates.');
    const data = await res.json();
    allTemplates = data.templates || [];

    // Filter section 1: documents
    const documents = allTemplates.filter((t) => t.category === 'document');
    docSelect.replaceChildren();
    for (const d of documents) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.filename})`;
      docSelect.append(opt);
    }
    renderDocFields();
    docSelect.disabled = docGenerate.disabled = false;

    // Filter section 2: issue & pr templates
    const templates = allTemplates.filter((t) => t.category !== 'document');
    tplSelect.replaceChildren();
    for (const t of templates) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.filename})`;
      tplSelect.append(opt);
    }
    renderTplFields();
    tplSelect.disabled = tplGenerate.disabled = false;

    // Check URL query param e.g. /community.html?repo=owner/repo
    const params = new URLSearchParams(window.location.search);
    const initialRepo = params.get('repo');
    if (initialRepo) {
      if (healthRepoInput) healthRepoInput.value = initialRepo;
      if (prRepo) prRepo.value = initialRepo;
      if (healthForm && typeof healthForm.requestSubmit === 'function') {
        healthForm.requestSubmit();
      } else if (healthForm) {
        healthForm.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    }
  } catch (err) {
    if (docStatus) docStatus.textContent = err.message;
    if (tplStatus) tplStatus.textContent = err.message;
  }
}

init();
