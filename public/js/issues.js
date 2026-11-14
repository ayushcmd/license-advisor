/**
 * Open Workers — PR & Issue Management Frontend Controller
 */

function formatError(err, fallback = 'Operation failed.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err.error) return err.error;
  if (err.message) return err.message;
  return fallback;
}

document.addEventListener('DOMContentLoaded', () => {
  // ---------------------------------------------------------------------------
  // 1. Issue Triage & Categorization
  // ---------------------------------------------------------------------------
  const triageForm = document.getElementById('triage-form');
  const triageRepoInput = document.getElementById('triage-repo');
  const triageNumberInput = document.getElementById('triage-number');
  const triageSubmitBtn = document.getElementById('triage-submit');
  const triageError = document.getElementById('triage-error');
  const triageResults = document.getElementById('triage-results');
  const triageIssueBadge = document.getElementById('triage-issue-badge');
  const triageIssueTitle = document.getElementById('triage-issue-title');
  const triageIssueMeta = document.getElementById('triage-issue-meta');
  const triageIssueLink = document.getElementById('triage-issue-link');
  const triageSecurityWarning = document.getElementById('triage-security-warning');
  const triagePrimaryCategory = document.getElementById('triage-primary-category');
  const triageConfidenceBadge = document.getElementById('triage-confidence-badge');
  const triageReasonsList = document.getElementById('triage-reasons-list');
  const triageSuggestedLabels = document.getElementById('triage-suggested-labels');
  const triageUseLabelsBtn = document.getElementById('triage-use-labels-btn');
  const triageFindDuplicatesBtn = document.getElementById('triage-find-duplicates-btn');
  const triageDuplicatesLoading = document.getElementById('triage-duplicates-loading');
  const triageDuplicatesList = document.getElementById('triage-duplicates-list');

  let currentTriageData = null;

  if (triageForm) {
    triageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      triageError.hidden = true;
      triageResults.hidden = true;
      triageDuplicatesList.innerHTML = '';
      triageSubmitBtn.disabled = true;
      triageSubmitBtn.textContent = 'Analyzing...';

      try {
        const repo = triageRepoInput.value.trim();
        const issueNumber = parseInt(triageNumberInput.value, 10);

        const res = await fetch('/api/issues/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, issueNumber })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        currentTriageData = data;

        // Render Issue Info
        triageIssueBadge.textContent = data.issue.state.toUpperCase();
        triageIssueBadge.className = `badge ${data.issue.state === 'open' ? 'badge-success' : 'badge-secondary'}`;
        triageIssueTitle.textContent = `#${data.issue.number} ${data.issue.title}`;
        triageIssueMeta.textContent = `Opened by @${data.issue.author} • Updated ${new Date(data.issue.updatedAt).toLocaleDateString()}`;
        triageIssueLink.href = data.issue.htmlUrl;

        // Security Warning
        triageSecurityWarning.hidden = !data.categorization.isSecuritySensitive;

        // Categorization
        const cat = data.categorization.primaryCategory || 'Uncategorized';
        triagePrimaryCategory.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        triageConfidenceBadge.textContent = `Confidence: ${data.categorization.confidence.toUpperCase()}`;
        triageConfidenceBadge.className = `badge ${data.categorization.confidence === 'high' ? 'badge-success' : 'badge-info'}`;

        triageReasonsList.innerHTML = '';
        for (const reason of data.categorization.reasons) {
          const li = document.createElement('li');
          li.textContent = reason;
          triageReasonsList.appendChild(li);
        }

        // Suggested labels
        triageSuggestedLabels.innerHTML = '';
        if (data.categorization.suggestedLabels.length === 0) {
          triageSuggestedLabels.innerHTML = '<span class="text-muted text-small">None suggested</span>';
        } else {
          for (const lbl of data.categorization.suggestedLabels) {
            const span = document.createElement('span');
            span.className = 'badge badge-info';
            span.textContent = lbl;
            triageSuggestedLabels.appendChild(span);
          }
        }

        triageResults.hidden = false;
      } catch (err) {
        triageError.textContent = formatError(err, 'Failed to analyze issue.');
        triageError.hidden = false;
      } finally {
        triageSubmitBtn.disabled = false;
        triageSubmitBtn.textContent = 'Analyze Issue';
      }
    });
  }

  // Send to label manager
  if (triageUseLabelsBtn) {
    triageUseLabelsBtn.addEventListener('click', () => {
      if (!currentTriageData) return;
      const labelRepo = document.getElementById('label-repo');
      const labelIssueNum = document.getElementById('label-issue-num');
      const labelNames = document.getElementById('label-names');

      if (labelRepo) labelRepo.value = currentTriageData.repository.fullName;
      if (labelIssueNum) labelIssueNum.value = currentTriageData.issue.number;
      if (labelNames && currentTriageData.categorization.suggestedLabels.length > 0) {
        labelNames.value = currentTriageData.categorization.suggestedLabels.join(', ');
      }

      const sectionLabels = document.getElementById('section-labels');
      if (sectionLabels) sectionLabels.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Scan duplicates
  if (triageFindDuplicatesBtn) {
    triageFindDuplicatesBtn.addEventListener('click', async () => {
      if (!currentTriageData) return;
      triageDuplicatesLoading.hidden = false;
      triageDuplicatesList.innerHTML = '';
      triageFindDuplicatesBtn.disabled = true;

      try {
        const res = await fetch('/api/issues/duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: currentTriageData.repository.fullName,
            issueNumber: currentTriageData.issue.number
          })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        if (data.suggestions.length === 0) {
          triageDuplicatesList.innerHTML = '<p class="text-small text-muted">No similar open issues detected.</p>';
        } else {
          for (const s of data.suggestions) {
            const row = document.createElement('div');
            row.className = 'box box-body cluster-between';
            row.style.padding = 'var(--space-2)';
            row.style.background = 'var(--color-canvas-default)';

            row.innerHTML = `
              <div>
                <a href="${s.url}" target="_blank" rel="noopener noreferrer" style="font-weight: 600;">#${s.number} ${s.title}</a>
                <p class="text-small text-muted" style="margin: var(--space-1) 0 0;">${s.explanation}</p>
              </div>
              <span class="badge ${s.similarityScore >= 50 ? 'badge-warning' : 'badge-secondary'}">${s.similarityScore}% match</span>
            `;
            triageDuplicatesList.appendChild(row);
          }
        }
      } catch (err) {
        triageDuplicatesList.innerHTML = `<p class="text-small text-danger">${formatError(err, 'Failed to scan candidate duplicates.')}</p>`;
      } finally {
        triageDuplicatesLoading.hidden = true;
        triageFindDuplicatesBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Pull Request Checks & Size Classification
  // ---------------------------------------------------------------------------
  const prChecksForm = document.getElementById('pr-checks-form');
  const prRepoInput = document.getElementById('pr-repo');
  const prNumberInput = document.getElementById('pr-number');
  const prSubmitBtn = document.getElementById('pr-submit');
  const prError = document.getElementById('pr-error');
  const prResults = document.getElementById('pr-results');
  const prQualityBadge = document.getElementById('pr-quality-badge');
  const prTitle = document.getElementById('pr-title');
  const prMeta = document.getElementById('pr-meta');
  const prLink = document.getElementById('pr-link');
  const prSizeLabel = document.getElementById('pr-size-label');
  const prSizeDesc = document.getElementById('pr-size-desc');
  const prSizeNotice = document.getElementById('pr-size-notice');
  const prApplySizeBtn = document.getElementById('pr-apply-size-btn');
  const prChecksTbody = document.getElementById('pr-checks-tbody');
  const prRecommendationsBox = document.getElementById('pr-recommendations-box');
  const prRecommendationsList = document.getElementById('pr-recommendations-list');

  let currentPrData = null;

  if (prChecksForm) {
    prChecksForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      prError.hidden = true;
      prResults.hidden = true;
      prSubmitBtn.disabled = true;
      prSubmitBtn.textContent = 'Inspecting...';

      try {
        const repo = prRepoInput.value.trim();
        const pullNumber = parseInt(prNumberInput.value, 10);

        const res = await fetch('/api/pulls/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, pullNumber })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        currentPrData = data;

        // Render PR Header
        const qStatus = data.quality.status;
        prQualityBadge.textContent = qStatus.toUpperCase();
        prQualityBadge.className = `badge ${qStatus === 'passed' ? 'badge-success' : qStatus === 'needs_attention' ? 'badge-warning' : 'badge-secondary'}`;

        prTitle.textContent = `#${data.pullRequest.number} ${data.pullRequest.title}`;
        prMeta.textContent = `Opened by @${data.pullRequest.author} (${data.pullRequest.authorAssociation}) • +${data.size.additions} -${data.size.deletions} in ${data.size.changedFiles} files`;
        prLink.href = data.pullRequest.htmlUrl;

        // Render Size
        prSizeLabel.textContent = data.size.label || 'NONE';
        prSizeDesc.textContent = `${data.size.description} (+${data.size.additions} additions, -${data.size.deletions} deletions across ${data.size.changedFiles} files).`;
        if (data.size.hasGeneratedFiles) {
          prSizeNotice.textContent = data.size.notice;
          prSizeNotice.hidden = false;
        } else {
          prSizeNotice.hidden = true;
        }

        // Render Quality Table
        prChecksTbody.innerHTML = '';
        for (const check of data.quality.checks) {
          const tr = document.createElement('tr');
          const statusClass = check.status === 'passed' ? 'badge-success' : check.status === 'missing' ? 'badge-danger' : check.status === 'warning' ? 'badge-warning' : 'badge-secondary';

          tr.innerHTML = `
            <td><strong>${check.name}</strong></td>
            <td><span class="badge ${statusClass}">${check.status.toUpperCase()}</span></td>
            <td>
              <div>${check.message}</div>
              ${check.recommendation ? `<div class="text-small text-muted" style="margin-top: 4px;"><strong>Fix:</strong> ${check.recommendation}</div>` : ''}
            </td>
          `;
          prChecksTbody.appendChild(tr);
        }

        // Render Recommendations
        if (data.quality.recommendations.length > 0) {
          prRecommendationsList.innerHTML = '';
          for (const rec of data.quality.recommendations) {
            const li = document.createElement('li');
            li.textContent = rec;
            prRecommendationsList.appendChild(li);
          }
          prRecommendationsBox.hidden = false;
        } else {
          prRecommendationsBox.hidden = true;
        }

        prResults.hidden = false;
      } catch (err) {
        prError.textContent = formatError(err, 'Failed to inspect pull request.');
        prError.hidden = false;
      } finally {
        prSubmitBtn.disabled = false;
        prSubmitBtn.textContent = 'Inspect Pull Request';
      }
    });
  }

  // Pre-fill size label in label manager
  if (prApplySizeBtn) {
    prApplySizeBtn.addEventListener('click', () => {
      if (!currentPrData || !currentPrData.size.label) return;
      const labelRepo = document.getElementById('label-repo');
      const labelIssueNum = document.getElementById('label-issue-num');
      const labelNames = document.getElementById('label-names');

      if (labelRepo) labelRepo.value = currentPrData.repository.fullName;
      if (labelIssueNum) labelIssueNum.value = currentPrData.pullRequest.number;
      if (labelNames) labelNames.value = currentPrData.size.label;

      const sectionLabels = document.getElementById('section-labels');
      if (sectionLabels) sectionLabels.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Label Manager
  // ---------------------------------------------------------------------------
  const labelForm = document.getElementById('label-form');
  const labelRepoInput = document.getElementById('label-repo');
  const labelIssueNumInput = document.getElementById('label-issue-num');
  const labelNamesInput = document.getElementById('label-names');
  const labelPreviewBtn = document.getElementById('label-preview-btn');
  const labelError = document.getElementById('label-error');
  const labelSuccess = document.getElementById('label-success');
  const labelPreviewResults = document.getElementById('label-preview-results');
  const labelCurrentList = document.getElementById('label-current-list');
  const labelToAddList = document.getElementById('label-to-add-list');
  const labelMissingRepoContainer = document.getElementById('label-missing-repo-container');
  const labelMissingRepoList = document.getElementById('label-missing-repo-list');
  const labelTokenInput = document.getElementById('label-token');
  const labelApplyBtn = document.getElementById('label-apply-btn');

  let currentLabelPreview = null;

  if (labelForm) {
    labelForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      labelError.hidden = true;
      labelSuccess.hidden = true;
      labelPreviewResults.hidden = true;
      labelPreviewBtn.disabled = true;

      try {
        const repo = labelRepoInput.value.trim();
        const issueNumber = parseInt(labelIssueNumInput.value, 10);
        const labels = labelNamesInput.value.split(',').map((s) => s.trim()).filter(Boolean);

        const res = await fetch('/api/issues/preview-labels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, issueNumber, labels })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        currentLabelPreview = data;

        // Current labels
        labelCurrentList.innerHTML = '';
        if (data.currentLabels.length === 0) {
          labelCurrentList.innerHTML = '<span class="text-small text-muted">No labels currently</span>';
        } else {
          for (const l of data.currentLabels) {
            const span = document.createElement('span');
            span.className = 'badge badge-secondary';
            span.textContent = l;
            labelCurrentList.appendChild(span);
          }
        }

        // To add
        labelToAddList.innerHTML = '';
        for (const l of data.labelsToApply) {
          const span = document.createElement('span');
          span.className = 'badge badge-success';
          span.textContent = `+ ${l}`;
          labelToAddList.appendChild(span);
        }
        for (const l of data.labelsAlreadyPresent) {
          const span = document.createElement('span');
          span.className = 'badge badge-secondary';
          span.textContent = `${l} (already on issue)`;
          labelToAddList.appendChild(span);
        }

        // Missing from repo
        if (data.missingFromRepo.length > 0) {
          labelMissingRepoList.innerHTML = '';
          for (const l of data.missingFromRepo) {
            const span = document.createElement('span');
            span.className = 'badge badge-warning';
            span.textContent = l;
            labelMissingRepoList.appendChild(span);
          }
          labelMissingRepoContainer.hidden = false;
        } else {
          labelMissingRepoContainer.hidden = true;
        }

        labelPreviewResults.hidden = false;
      } catch (err) {
        labelError.textContent = formatError(err, 'Failed to preview labels.');
        labelError.hidden = false;
      } finally {
        labelPreviewBtn.disabled = false;
      }
    });
  }

  // Apply labels
  if (labelApplyBtn) {
    labelApplyBtn.addEventListener('click', async () => {
      labelError.hidden = true;
      labelSuccess.hidden = true;
      const token = labelTokenInput.value.trim();

      if (!token) {
        labelError.textContent = 'A GitHub Personal Access Token with write permissions is required to apply labels.';
        labelError.hidden = false;
        labelTokenInput.focus();
        return;
      }

      labelApplyBtn.disabled = true;
      labelApplyBtn.textContent = 'Applying...';

      try {
        const repo = labelRepoInput.value.trim();
        const issueNumber = parseInt(labelIssueNumInput.value, 10);
        const labels = currentLabelPreview ? currentLabelPreview.labelsToApply : labelNamesInput.value.split(',').map((s) => s.trim()).filter(Boolean);

        const res = await fetch('/api/issues/apply-labels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ repo, issueNumber, labels })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        labelSuccess.textContent = `Successfully applied labels to #${data.issueNumber}: ${data.appliedLabels.join(', ')}`;
        labelSuccess.hidden = false;
      } catch (err) {
        labelError.textContent = formatError(err, 'Failed to apply labels.');
        labelError.hidden = false;
      } finally {
        labelApplyBtn.disabled = false;
        labelApplyBtn.textContent = 'Apply Labels';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Contributor Welcome
  // ---------------------------------------------------------------------------
  const welcomeRepo = document.getElementById('welcome-repo');
  const welcomeUser = document.getElementById('welcome-user');
  const welcomeCustom = document.getElementById('welcome-custom');
  const welcomeGenerateBtn = document.getElementById('welcome-generate-btn');
  const welcomeCopyBtn = document.getElementById('welcome-copy-btn');
  const welcomePreviewText = document.getElementById('welcome-preview-text');

  if (welcomeGenerateBtn) {
    welcomeGenerateBtn.addEventListener('click', () => {
      const repo = welcomeRepo.value.trim() || 'owner/repository';
      const user = welcomeUser.value.trim() || 'contributor';
      const custom = welcomeCustom.value.trim();

      let text = custom || [
        `👋 Welcome to **${repo}**, @${user}! Thank you for opening your first contribution.`,
        '',
        'Before proceeding with review, please make sure you have checked our community guides:',
        `- 📖 [Contribution Guidelines](https://github.com/${repo}/blob/main/CONTRIBUTING.md)`,
        `- 🤝 [Code of Conduct](https://github.com/${repo}/blob/main/CODE_OF_CONDUCT.md)`,
        `- 💬 [Support Channels](https://github.com/${repo}/blob/main/SUPPORT.md)`,
        '',
        'A maintainer will review your contribution shortly. Feel free to add any additional context or testing instructions in the description!'
      ].join('\n');

      text = text
        .replace(/\{username\}/g, user)
        .replace(/\{repo\}/g, repo)
        .replace(/\{contributing_url\}/g, `https://github.com/${repo}/blob/main/CONTRIBUTING.md`)
        .replace(/\{code_of_conduct_url\}/g, `https://github.com/${repo}/blob/main/CODE_OF_CONDUCT.md`)
        .replace(/\{support_url\}/g, `https://github.com/${repo}/blob/main/SUPPORT.md`);

      text += '\n\n<!-- open-workers:welcome -->';

      welcomePreviewText.textContent = text;
      welcomeCopyBtn.disabled = false;
    });
  }

  if (welcomeCopyBtn) {
    welcomeCopyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(welcomePreviewText.textContent);
      const original = welcomeCopyBtn.textContent;
      welcomeCopyBtn.textContent = 'Copied!';
      setTimeout(() => { welcomeCopyBtn.textContent = original; }, 2000);
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Stale Issues & Release Notes
  // ---------------------------------------------------------------------------
  const staleForm = document.getElementById('stale-form');
  const staleRepo = document.getElementById('stale-repo');
  const staleDays = document.getElementById('stale-days');
  const staleSubmitBtn = document.getElementById('stale-submit-btn');
  const staleError = document.getElementById('stale-error');
  const staleResults = document.getElementById('stale-results');
  const staleCountBadge = document.getElementById('stale-count-badge');
  const staleSummaryText = document.getElementById('stale-summary-text');
  const staleIssuesList = document.getElementById('stale-issues-list');

  if (staleForm) {
    staleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      staleError.hidden = true;
      staleResults.hidden = true;
      staleSubmitBtn.disabled = true;

      try {
        const repo = staleRepo.value.trim();
        const days = parseInt(staleDays.value, 10) || 30;

        const res = await fetch('/api/issues/stale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, daysInactive: days })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        staleCountBadge.textContent = `${data.staleCount} Stale Issues`;
        staleCountBadge.className = `badge ${data.staleCount > 0 ? 'badge-warning' : 'badge-success'}`;
        staleSummaryText.textContent = `Scanned ${data.scannedIssues} open issues (threshold: ${data.daysInactive} days)`;

        staleIssuesList.innerHTML = '';
        if (data.staleIssues.length === 0) {
          staleIssuesList.innerHTML = '<p class="text-small text-muted">No inactive issues found.</p>';
        } else {
          for (const s of data.staleIssues) {
            const div = document.createElement('div');
            div.className = 'box box-body';
            div.style.padding = 'var(--space-2)';
            div.style.background = 'var(--color-canvas-subtle)';
            div.innerHTML = `
              <strong>#${s.issueNumber} ${s.title}</strong>
              <div class="text-small text-muted" style="margin-top: 2px;">Inactive for ${s.daysInactive} days • ${s.reason}</div>
            `;
            staleIssuesList.appendChild(div);
          }
        }

        staleResults.hidden = false;
      } catch (err) {
        staleError.textContent = formatError(err, 'Failed to inspect stale issues.');
        staleError.hidden = false;
      } finally {
        staleSubmitBtn.disabled = false;
      }
    });
  }

  // Release notes
  const rnForm = document.getElementById('release-notes-form');
  const rnRepo = document.getElementById('rn-repo');
  const rnTitle = document.getElementById('rn-title');
  const rnSubmitBtn = document.getElementById('rn-submit-btn');
  const rnError = document.getElementById('rn-error');
  const rnResults = document.getElementById('rn-results');
  const rnCountBadge = document.getElementById('rn-count-badge');
  const rnMarkdownPreview = document.getElementById('rn-markdown-preview');
  const rnCopyBtn = document.getElementById('rn-copy-btn');
  const rnDownloadBtn = document.getElementById('rn-download-btn');

  if (rnForm) {
    rnForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      rnError.hidden = true;
      rnResults.hidden = true;
      rnSubmitBtn.disabled = true;

      try {
        const repo = rnRepo.value.trim();
        const releaseTitle = rnTitle.value.trim() || 'Release Notes';

        const res = await fetch('/api/pulls/release-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, releaseTitle })
        });
        const data = await res.json();
        if (!res.ok) throw data;

        rnCountBadge.textContent = `${data.mergedCount} Merged PRs`;
        rnMarkdownPreview.textContent = data.markdown;
        rnResults.hidden = false;
      } catch (err) {
        rnError.textContent = formatError(err, 'Failed to draft release notes.');
        rnError.hidden = false;
      } finally {
        rnSubmitBtn.disabled = false;
      }
    });
  }

  if (rnCopyBtn) {
    rnCopyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(rnMarkdownPreview.textContent);
      const original = rnCopyBtn.textContent;
      rnCopyBtn.textContent = 'Copied!';
      setTimeout(() => { rnCopyBtn.textContent = original; }, 2000);
    });
  }

  if (rnDownloadBtn) {
    rnDownloadBtn.addEventListener('click', () => {
      const blob = new Blob([rnMarkdownPreview.textContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'RELEASE_NOTES.md';
      a.click();
      URL.revokeObjectURL(url);
    });
  }
});
