/**
 * Open Workers — Unified Repository Dashboard Controller
 *
 * Coordinates cross-module repository overview across all 6 platform capabilities:
 * Licensing, Community Standards, Security Policies, Documentation Quality,
 * PR & Issue Health, and Repository Automation.
 *
 * Workflow: Single Inspection → 6 Capabilities → 1 Actionable Report
 *
 * Optimizations:
 * - Uses shared UI utilities from ui-utils.js
 * - AbortController for in-flight request cancellation
 * - Duplicate submission prevention
 * - Safe URL sanitization for dynamic outbound action links
 * - Strict separation between executionStatus and healthStatus
 * - Accessible live-region announcements and loading states
 * - Reduced motion support for smooth scrolling
 */

import {
  escapeHtml,
  sanitizeUrl,
  showBanner as renderBanner,
  setButtonLoading,
  getQueryParam
} from './ui-utils.js';

const form = document.getElementById('dashboard-form');
const repoInputEl = document.getElementById('dashboard-repo');
const tokenInputEl = document.getElementById('dashboard-token');
const submitBtn = document.getElementById('dashboard-submit-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const authDisclosure = document.getElementById('auth-disclosure');
const feedbackEl = document.getElementById('dashboard-feedback');
const resultsEl = document.getElementById('dashboard-results');

// Repository metadata elements
const repoLink = document.getElementById('repo-link');
const badgeVisibility = document.getElementById('badge-visibility');
const badgeArchived = document.getElementById('badge-archived');
const repoAppStatus = document.getElementById('repo-app-status');
const repoDescription = document.getElementById('repo-description');
const repoBranch = document.getElementById('repo-branch');
const repoLanguage = document.getElementById('repo-language');
const repoStars = document.getElementById('repo-stars');
const repoForks = document.getElementById('repo-forks');
const repoIssues = document.getElementById('repo-issues');

// Summary stat elements
const statHighPriority = document.getElementById('stat-high-priority');
const statActionable = document.getElementById('stat-actionable');
const statEvaluated = document.getElementById('stat-evaluated');
const statAttention = document.getElementById('stat-attention');

// Recommendations elements
const badgeRecCount = document.getElementById('badge-rec-count');
const recommendationsList = document.getElementById('recommendations-list');

// Module elements mapping
const MODULE_CONFIG = {
  licensing: {
    badge: document.getElementById('badge-licensing'),
    summary: document.getElementById('summary-licensing'),
    findings: document.getElementById('findings-licensing'),
    btn: document.getElementById('btn-action-licensing'),
    defaultPage: '/analyzer.html'
  },
  community: {
    badge: document.getElementById('badge-community'),
    summary: document.getElementById('summary-community'),
    findings: document.getElementById('findings-community'),
    btn: document.getElementById('btn-action-community'),
    defaultPage: '/community.html'
  },
  security: {
    badge: document.getElementById('badge-security'),
    summary: document.getElementById('summary-security'),
    findings: document.getElementById('findings-security'),
    btn: document.getElementById('btn-action-security'),
    defaultPage: '/security.html'
  },
  documentation: {
    badge: document.getElementById('badge-documentation'),
    summary: document.getElementById('summary-documentation'),
    findings: document.getElementById('findings-documentation'),
    btn: document.getElementById('btn-action-documentation'),
    defaultPage: '/documentation.html'
  },
  issues: {
    badge: document.getElementById('badge-issues'),
    summary: document.getElementById('summary-issues'),
    findings: document.getElementById('findings-issues'),
    btn: document.getElementById('btn-action-issues'),
    defaultPage: '/issues.html'
  },
  automation: {
    badge: document.getElementById('badge-automation'),
    summary: document.getElementById('summary-automation'),
    findings: document.getElementById('findings-automation'),
    btn: document.getElementById('btn-action-automation'),
    defaultPage: '/automation.html'
  }
};

let activeAbortController = null;
let isAnalyzing = false;

function showBanner(message, type = 'info') {
  renderBanner(feedbackEl, message, type);
}

function clearBanner() {
  if (feedbackEl) feedbackEl.innerHTML = '';
}

function setLoading(isLoading) {
  isAnalyzing = isLoading;
  if (submitBtn) {
    submitBtn.disabled = isLoading;
    submitBtn.setAttribute('aria-busy', String(isLoading));
  }
  if (btnText) btnText.textContent = isLoading ? 'Analyzing...' : 'Analyze Repository';
  if (btnSpinner) btnSpinner.style.display = isLoading ? 'inline-block' : 'none';
}

function getScoreBadgeClass(score) {
  if (typeof score !== 'number') return 'badge-neutral';
  if (score >= 80) return 'badge-success';
  if (score >= 50) return 'badge-warning';
  return 'badge-danger';
}

function getPriorityBadgeClass(priority) {
  if (priority === 'high') return 'badge-danger';
  if (priority === 'medium') return 'badge-warning';
  return 'badge-info';
}

export async function runDashboardAnalysis(repoInput, token = '') {
  if (!repoInput || typeof repoInput !== 'string') return;
  const targetRepo = repoInput.trim();
  if (!targetRepo) return;

  // Cancel any prior in-flight analysis
  if (activeAbortController) {
    activeAbortController.abort('New analysis request initiated');
    activeAbortController = null;
  }

  const abortController = new AbortController();
  activeAbortController = abortController;

  clearBanner();
  setLoading(true);
  if (resultsEl) resultsEl.style.display = 'none';

  showBanner(`Auditing repository "${targetRepo}" across all six capabilities...`, 'info');

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const res = await fetch('/api/dashboard/analyze', {
      method: 'POST',
      headers,
      body: JSON.stringify({ repo: targetRepo }),
      signal: abortController.signal
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401 || data.code === 'AUTH_REQUIRED') {
        if (authDisclosure) authDisclosure.open = true;
        throw new Error(
          data.error ||
            'This repository is private or requires authorization. Please provide a Personal Access Token (PAT) above.'
        );
      }
      if (res.status === 403 && data.code === 'RATE_LIMITED') {
        if (authDisclosure) authDisclosure.open = true;
        throw new Error(
          data.error ||
            'GitHub API rate limit exceeded. Please provide a Personal Access Token (PAT) above to continue.'
        );
      }
      if (res.status === 404 || data.code === 'NOT_FOUND') {
        throw new Error(
          data.error ||
            'Repository not found or access denied. Check the spelling or repository visibility.'
        );
      }
      throw new Error(data.error || 'Failed to analyze repository.');
    }

    // Success: clear banner and render results
    clearBanner();
    renderDashboard(data);

    // Update query string in URL without page refresh (safe: never stores PAT)
    if (window?.history && typeof window.history.replaceState === 'function') {
      const url = new URL(window.location.href);
      url.searchParams.set('repo', data.repository.fullName);
      window.history.replaceState(null, '', url.toString());
    }

    if (resultsEl) {
      resultsEl.style.display = 'block';
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      resultsEl.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start'
      });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Ignored: aborted due to a newer request
      return;
    }
    showBanner(err.message || 'An unexpected error occurred during repository analysis.', 'error');
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null;
      setLoading(false);
    }
  }
}

export function renderDashboard(data) {
  const { repository, summary, modules, prioritizedRecommendations } = data;

  // 1. Render Repository Metadata Card
  if (repoLink) {
    repoLink.textContent = repository.fullName;
    const rawUrl = repository.htmlUrl || `https://github.com/${repository.fullName}`;
    repoLink.href = sanitizeUrl(rawUrl, `https://github.com/${repository.fullName}`);
  }

  if (badgeVisibility) {
    badgeVisibility.textContent = repository.isPrivate ? 'Private' : 'Public';
    badgeVisibility.className = repository.isPrivate
      ? 'badge badge-warning'
      : 'badge badge-neutral';
  }

  if (badgeArchived) {
    badgeArchived.style.display = repository.isArchived ? 'inline-flex' : 'none';
  }

  if (repoAppStatus) {
    if (repository.installed) {
      repoAppStatus.innerHTML = '<span class="badge badge-success">✓ GitHub App Connected</span>';
    } else {
      repoAppStatus.innerHTML =
        '<a href="/app-install.html" class="badge badge-neutral">GitHub App Not Installed</a>';
    }
  }

  if (repoDescription) {
    repoDescription.textContent = repository.description || 'No description provided.';
  }

  if (repoBranch) repoBranch.textContent = repository.defaultBranch;
  if (repoLanguage) repoLanguage.textContent = repository.primaryLanguage;
  if (repoStars) repoStars.textContent = (repository.stars || 0).toLocaleString();
  if (repoForks) repoForks.textContent = (repository.forks || 0).toLocaleString();
  if (repoIssues) repoIssues.textContent = (repository.openIssues || 0).toLocaleString();

  // 2. Render Overall Health Summary Stats
  if (statHighPriority) statHighPriority.textContent = summary.highPriorityFindings;
  if (statActionable) statActionable.textContent = summary.totalActionableFindings;
  if (statEvaluated)
    statEvaluated.textContent = `${summary.modulesEvaluated} / ${summary.totalModules}`;
  if (statAttention) statAttention.textContent = summary.modulesNeedingAttention;

  // 3. Render Prioritized Recommendations
  if (badgeRecCount) {
    badgeRecCount.textContent = `${prioritizedRecommendations.length} Actions`;
    badgeRecCount.className =
      prioritizedRecommendations.length > 0 ? 'badge badge-warning' : 'badge badge-success';
  }

  if (recommendationsList) {
    if (prioritizedRecommendations.length === 0) {
      recommendationsList.innerHTML =
        '<div class="flash banner-success" style="font-size: 0.9rem;">✓ No urgent action items found. The repository adheres to recommended baseline standards across all modules!</div>';
    } else {
      recommendationsList.innerHTML = prioritizedRecommendations
        .map((rec) => {
          const pBadge = getPriorityBadgeClass(rec.priority);
          const safeActionUrl = sanitizeUrl(rec.actionUrl, '#');
          return `
          <div class="card" style="padding: var(--space-3); border-left: 3px solid var(--color-${
            rec.priority === 'high' ? 'danger' : rec.priority === 'medium' ? 'attention' : 'accent'
          }-fg);">
            <div class="cluster-between" style="align-items: flex-start; gap: var(--space-2);">
              <div class="stack-xs" style="flex: 1; min-width: 0;">
                <div class="cluster" style="gap: var(--space-2); align-items: center;">
                  <span class="badge ${pBadge}">${escapeHtml(rec.priority.toUpperCase())}</span>
                  <span class="badge badge-neutral">${escapeHtml(rec.module)}</span>
                  <strong style="font-size: 0.95rem; overflow-wrap: break-word;">${escapeHtml(rec.title)}</strong>
                </div>
                <p class="text-sm text-muted" style="margin: 0; overflow-wrap: break-word;">${escapeHtml(rec.description)}</p>
              </div>
              <a href="${escapeHtml(safeActionUrl)}" class="btn btn-secondary btn-sm" style="flex-shrink: 0;">${escapeHtml(
                rec.actionLabel || 'Fix'
              )} &rarr;</a>
            </div>
          </div>
        `;
        })
        .join('');
    }
  }

  // 4. Render Capability Overview Cards
  const encodedRepo = encodeURIComponent(repository.fullName);

  for (const [key, cfg] of Object.entries(MODULE_CONFIG)) {
    const mod = modules[key];
    if (!mod) continue;

    // Badge styling and text: strict separation between executionStatus and healthStatus
    if (cfg.badge) {
      if (mod.executionStatus === 'failed' || mod.status === 'failed') {
        cfg.badge.textContent = 'Failed';
        cfg.badge.className = 'badge badge-danger';
      } else if (mod.executionStatus === 'not_supported') {
        cfg.badge.textContent = 'Disabled';
        cfg.badge.className = 'badge badge-neutral';
      } else if (typeof mod.score === 'number') {
        cfg.badge.textContent = `${mod.score}%`;
        cfg.badge.className = `badge ${getScoreBadgeClass(mod.score)}`;
      } else if (mod.healthStatus === 'healthy' || mod.status === 'available') {
        cfg.badge.textContent = key === 'licensing' ? 'Audited' : 'Configured';
        cfg.badge.className = 'badge badge-success';
      } else if (mod.healthStatus === 'needs_attention' || mod.status === 'warning') {
        cfg.badge.textContent = 'Attention';
        cfg.badge.className = 'badge badge-warning';
      } else if (mod.healthStatus === 'critical') {
        cfg.badge.textContent = 'Critical';
        cfg.badge.className = 'badge badge-danger';
      } else {
        cfg.badge.textContent = 'Unknown';
        cfg.badge.className = 'badge badge-neutral';
      }
    }

    // Summary
    if (cfg.summary) {
      cfg.summary.textContent = mod.summary || 'No summary available.';
    }

    // Findings List
    if (cfg.findings) {
      cfg.findings.innerHTML = '';
      const items = Array.isArray(mod.findings) ? mod.findings.slice(0, 4) : [];
      if (items.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-muted';
        li.textContent = 'No specific findings logged.';
        cfg.findings.append(li);
      } else {
        for (const item of items) {
          const li = document.createElement('li');
          const isCheck = item.status === 'present' || item.status === 'pass' || item.passed === true;
          const isWarn = item.severity === 'high' || item.severity === 'critical' || item.status === 'missing';
          const symbol = isCheck ? '✓ ' : isWarn ? '⚠ ' : '• ';
          li.style.color = isCheck
            ? 'var(--color-success-fg)'
            : isWarn
              ? 'var(--color-danger-fg)'
              : 'var(--color-fg-muted)';
          li.textContent = `${symbol}${item.name || item.title || item.file || item.check || 'Item'}`;
          cfg.findings.append(li);
        }
      }
    }

    // Action button URL
    if (cfg.btn) {
      cfg.btn.href = `${cfg.defaultPage}?repo=${encodedRepo}`;
    }
  }
}

// Form Submission Event
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isAnalyzing) return; // Prevent duplicate concurrent submissions
    const repo = repoInputEl?.value?.trim();
    const token = tokenInputEl?.value?.trim();
    if (repo) {
      runDashboardAnalysis(repo, token);
    }
  });
}

// Initial query param check e.g. /dashboard.html?repo=owner/repo
const initialRepoParam = getQueryParam('repo');
if (initialRepoParam && repoInputEl) {
  repoInputEl.value = initialRepoParam;
  runDashboardAnalysis(initialRepoParam);
}
