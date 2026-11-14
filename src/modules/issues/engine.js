/**
 * Open Workers — PR & Issue Management Engine
 *
 * Provides deterministic rule-based issue categorization, PR quality analysis,
 * PR size classification, contributor welcome message formatting, duplicate detection,
 * stale issue inspection, and release notes compilation.
 */

import { MARKERS, hasMarker, appendMarker } from '../../core/events/idempotency.js';

export const ISSUE_CATEGORIES = Object.freeze([
  { id: 'bug', name: 'Bug Report', labels: ['bug', 'needs-triage'] },
  { id: 'feature', name: 'Feature Request', labels: ['enhancement'] },
  { id: 'documentation', name: 'Documentation', labels: ['documentation'] },
  { id: 'question', name: 'Question', labels: ['question'] },
  { id: 'enhancement', name: 'Enhancement', labels: ['enhancement'] },
  { id: 'performance', name: 'Performance', labels: ['performance'] },
  { id: 'maintenance', name: 'Maintenance & Chores', labels: ['maintenance'] },
  { id: 'security', name: 'Security Report', labels: ['security'] }
]);

export const PR_SIZE_THRESHOLDS = Object.freeze([
  { id: 'XS', label: 'size/XS', min: 1, max: 10, description: '1-10 lines changed' },
  { id: 'S', label: 'size/S', min: 11, max: 50, description: '11-50 lines changed' },
  { id: 'M', label: 'size/M', min: 51, max: 200, description: '51-200 lines changed' },
  { id: 'L', label: 'size/L', min: 201, max: 500, description: '201-500 lines changed' },
  { id: 'XL', label: 'size/XL', min: 501, max: Infinity, description: '500+ lines changed' }
]);

export const DEFAULT_EXEMPT_STALE_LABELS = Object.freeze([
  'pinned',
  'security',
  'never-stale',
  'in-progress',
  'blocked'
]);

/**
 * Sanitize plain strings
 */
function sanitizeText(str, maxLength = 2000) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\0\r]/g, '').slice(0, maxLength);
}

/**
 * Categorize a GitHub issue based on deterministic text patterns and signals
 *
 * @param {object} issue
 * @param {string} issue.title
 * @param {string} [issue.body]
 * @param {Array<string|object>} [issue.labels]
 * @param {number} [issue.number]
 * @returns {object}
 */
export function categorizeIssue(issue = {}) {
  const title = String(issue.title || '').trim();
  const body = String(issue.body || '').trim();
  const issueNumber = issue.number || null;
  const combinedText = `${title}\n\n${body}`.toLowerCase();

  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === 'string' ? l.toLowerCase() : String(l?.name || '').toLowerCase()))
    : [];

  const matched = new Set();
  const reasons = [];

  // Check 1: Security sensitivity (Special priority - flags private disclosure warning)
  const isSecurity = /vulnerabilit|cve-\d|exploit|remote code execution|\brce\b|sql injection|xss|csrf|security advisory|denial of service/i.test(combinedText);
  if (isSecurity) {
    matched.add('security');
    reasons.push('Issue text references security vulnerabilities, CVEs, or exploit terms. Maintainers should verify if this requires coordinated private disclosure rather than public discussion.');
  }

  // Check 2: Bug detection
  const bugSignals = [
    /\b(error|bug|crash|fail|fails|failed|failure|broken|unexpected|exception|fault|hang|infinite loop|panic)\b/i,
    /steps to reproduce|reproduce|to reproduce|stack trace|expected behavior|actual behavior/i,
    /doesn't work|does not work|not working/i
  ];
  let bugHits = 0;
  for (const signal of bugSignals) {
    if (signal.test(combinedText)) bugHits++;
  }
  if (bugHits > 0 || labels.includes('bug')) {
    matched.add('bug');
    reasons.push(bugHits > 1 ? 'Describes unexpected failure and contains reproduction/diagnostic details' : 'Mentions error, bug, or unexpected behavior');
  }

  // Check 3: Feature request
  const featureSignals = [
    /\b(feature|feature request|proposal|propose|suggest|suggestion|new feature)\b/i,
    /would like to|would be great to|add support for|support for|ability to/i
  ];
  if (featureSignals.some((s) => s.test(combinedText)) || labels.includes('enhancement') || labels.includes('feature')) {
    matched.add('feature');
    reasons.push('Proposes new functionality, feature addition, or API support');
  }

  // Check 4: Documentation
  const docsSignals = [
    /\b(docs?|documentation|readme|typo|spelling|guide|tutorial|manual|api reference|clarify documentation)\b/i
  ];
  if (docsSignals.some((s) => s.test(combinedText)) || labels.includes('documentation')) {
    matched.add('documentation');
    reasons.push('Concerns documentation, guides, README updates, or text clarifications');
  }

  // Check 5: Question
  const questionSignals = [
    /\b(how (to|do I|can I)|question|wondering if|is it possible to|where can I find)\b/i,
    /\?{1,}/
  ];
  if (questionSignals[0].test(combinedText) || (questionSignals[1].test(title) && !matched.has('bug'))) {
    matched.add('question');
    reasons.push('Phrased as an inquiry or usage question');
  }

  // Check 6: Performance
  const perfSignals = [
    /\b(slow|latency|throughput|performance|high memory|memory leak|high cpu|benchmark|lag|bottleneck)\b/i
  ];
  if (perfSignals.some((s) => s.test(combinedText)) || labels.includes('performance')) {
    matched.add('performance');
    reasons.push('References performance degradation, memory usage, latency, or throughput');
  }

  // Check 7: Maintenance / Chores
  const maintSignals = [
    /\b(refactor|dependency|dependencies|upgrade|chore|lint|ci|github actions|workflow|build system|deps)\b/i
  ];
  if (maintSignals.some((s) => s.test(combinedText)) || labels.includes('maintenance')) {
    matched.add('maintenance');
    reasons.push('Involves project maintenance, refactoring, dependencies, or build automation');
  }

  // Check 8: Enhancement (if not pure feature)
  if (!matched.has('feature') && /\b(improve|improvement|enhance|enhancement|better|optimize)\b/i.test(combinedText)) {
    matched.add('enhancement');
    reasons.push('Proposes enhancements or optimizations to existing features');
  }

  // Determine primary category and confidence
  const suggestedCategories = Array.from(matched);
  let primaryCategory = null;
  let confidence = 'low';

  if (suggestedCategories.includes('security')) {
    primaryCategory = 'security';
    confidence = 'high';
  } else if (suggestedCategories.length === 1) {
    primaryCategory = suggestedCategories[0];
    confidence = (title && body.length > 30) ? 'high' : 'medium';
  } else if (suggestedCategories.length > 1) {
    // Prefer bug if bug signals present, else feature, etc.
    const priority = ['bug', 'feature', 'documentation', 'performance', 'enhancement', 'maintenance', 'question'];
    primaryCategory = priority.find((p) => suggestedCategories.includes(p)) || suggestedCategories[0];
    confidence = 'medium';
  } else {
    primaryCategory = null;
    confidence = 'low';
    reasons.push('Insufficient text signals to determine a specific category with confidence');
  }

  // Collect suggested labels based on categories
  const suggestedLabels = [];
  for (const catId of suggestedCategories) {
    const cat = ISSUE_CATEGORIES.find((c) => c.id === catId);
    if (cat) {
      for (const lbl of cat.labels) {
        if (!suggestedLabels.includes(lbl)) suggestedLabels.push(lbl);
      }
    }
  }

  return {
    issueNumber,
    primaryCategory,
    suggestedCategories,
    suggestedLabels,
    reasons,
    confidence,
    isSecuritySensitive: isSecurity,
    requiresConfirmation: confidence !== 'high' || suggestedCategories.length > 1 || isSecurity
  };
}

/**
 * Evaluate pull request description, checklist, references, and quality
 *
 * @param {object} pr
 * @returns {object}
 */
export function evaluatePullRequestQuality(pr = {}) {
  const prNumber = pr.number || null;
  const title = String(pr.title || '').trim();
  const body = String(pr.body || '').trim();
  const draft = Boolean(pr.draft);
  const additions = typeof pr.additions === 'number' ? pr.additions : 0;
  const deletions = typeof pr.deletions === 'number' ? pr.deletions : 0;
  const totalChangedLines = additions + deletions;

  const checks = [];
  const recommendations = [];

  // Check 1: Description presence and quality
  const isPlaceholder = !body || /^(todo|tbd|none|n\/a|fix|as title)\.?$/i.test(body) || body.replace(/<!--[\s\S]*?-->/g, '').trim().length < 15;
  checks.push({
    id: 'description',
    name: 'Pull Request Description',
    status: isPlaceholder ? 'missing' : 'passed',
    message: isPlaceholder
      ? 'Pull request body is empty, placeholder, or contains only template boilerplate.'
      : 'Comprehensive description provided explaining the purpose of changes.',
    recommendation: isPlaceholder ? 'Add a descriptive summary of what this pull request changes and why.' : null
  });
  if (isPlaceholder) recommendations.push('Add a meaningful description to help reviewers understand the changes.');

  // Check 2: Linked Issue reference
  const hasIssueRef = /(?:fixes|closes|resolves|refs?|issue|#)\s*#?([0-9]+)|github\.com\/[^/]+\/[^/]+\/issues\/([0-9]+)/i.test(body);
  checks.push({
    id: 'issue_reference',
    name: 'Linked Issue Reference',
    status: hasIssueRef ? 'passed' : 'missing',
    message: hasIssueRef
      ? 'Pull request references a related issue or ticket.'
      : 'No related issue reference (e.g. "Fixes #123") found in description.',
    recommendation: hasIssueRef ? null : 'Link the relevant issue using "Fixes #<number>" or "Closes #<number>".'
  });
  if (!hasIssueRef) recommendations.push('Link related issues to enable automatic issue closure on merge.');

  // Check 3: Testing details
  const mentionsTests = /(test(s|ed|ing)?|npm test|spec|verification|verified with|manual testing)/i.test(body) || /\[x\]\s*.*test/i.test(body);
  checks.push({
    id: 'testing',
    name: 'Testing Instructions & Verification',
    status: mentionsTests ? 'passed' : 'missing',
    message: mentionsTests
      ? 'Testing steps, test suite execution, or verification notes detected.'
      : 'No testing instructions or verification steps mentioned in the description.',
    recommendation: mentionsTests ? null : 'Describe how these changes were tested or include automated test additions.'
  });
  if (!mentionsTests) recommendations.push('Include testing instructions or specify how the changes were verified.');

  // Check 4: Breaking changes declaration
  const isBreaking = /breaking change/i.test(body) || /^([a-z]+)(\([a-z0-9_-]+\))?!:/i.test(title);
  checks.push({
    id: 'breaking_changes',
    name: 'Breaking Change Declaration',
    status: 'passed',
    declaredBreaking: isBreaking,
    message: isBreaking
      ? 'Pull request explicitly declares breaking changes.'
      : 'No breaking changes declared (standard backward-compatible change).'
  });

  // Check 5: Checklist completion
  const taskMatches = body.match(/- \[[ xX]\]/g) || [];
  const completedTasks = body.match(/- \[[xX]\]/g) || [];
  const totalTasks = taskMatches.length;
  const completedCount = completedTasks.length;
  const incompleteCount = totalTasks - completedCount;

  let checklistStatus = 'not_applicable';
  let checklistMsg = 'No checklist items found in description.';
  if (totalTasks > 0) {
    if (incompleteCount === 0) {
      checklistStatus = 'passed';
      checklistMsg = `All ${totalTasks} checklist items are marked complete.`;
    } else {
      checklistStatus = 'needs_attention';
      checklistMsg = `${incompleteCount} of ${totalTasks} checklist items remain incomplete.`;
      recommendations.push(`Complete the ${incompleteCount} remaining checklist items before requesting review.`);
    }
  }
  checks.push({
    id: 'checklist',
    name: 'Checklist Completion',
    status: checklistStatus,
    totalTasks,
    completedTasks: completedCount,
    incompleteTasks: incompleteCount,
    message: checklistMsg
  });

  // Check 6: Title convention (Conventional Commits)
  const isConventionalTitle = /^([a-z]+)(?:\(([a-z0-9_-]+)\))?!?:/i.test(title);
  checks.push({
    id: 'title_convention',
    name: 'Conventional Commit Title',
    status: isConventionalTitle ? 'passed' : 'needs_attention',
    message: isConventionalTitle
      ? 'PR title adheres to Conventional Commits format (e.g. "feat: ...", "fix: ...").'
      : 'PR title does not use Conventional Commits prefix (e.g. feat, fix, docs, chore).',
    recommendation: isConventionalTitle ? null : 'Format PR title using Conventional Commits syntax (e.g. "feat: add feature" or "fix(parser): resolve error").'
  });

  // Check 7: Draft status
  checks.push({
    id: 'draft_status',
    name: 'Draft Status',
    status: draft ? 'warning' : 'passed',
    isDraft: draft,
    message: draft
      ? 'Pull request is currently marked as Draft (work in progress).'
      : 'Pull request is ready for review.'
  });

  // Check 8: Size review
  const isTooLarge = totalChangedLines > 500;
  checks.push({
    id: 'size_review',
    name: 'Change Scope & Size',
    status: isTooLarge ? 'warning' : 'passed',
    changedLines: totalChangedLines,
    message: isTooLarge
      ? `Large pull request (${totalChangedLines} lines changed). Consider breaking into smaller, reviewable PRs.`
      : `Reasonable PR size (${totalChangedLines} lines changed).`
  });
  if (isTooLarge) recommendations.push('Consider splitting large pull requests into smaller independent PRs to speed up review.');

  // Overall status
  const missingCount = checks.filter((c) => c.status === 'missing').length;
  const needsAttentionCount = checks.filter((c) => c.status === 'needs_attention').length;
  let overallStatus = 'passed';
  if (missingCount > 0) overallStatus = 'needs_attention';
  else if (needsAttentionCount > 0 || draft) overallStatus = 'warning';

  return {
    pullRequest: prNumber,
    status: overallStatus,
    summary: {
      totalChecks: checks.length,
      passed: checks.filter((c) => c.status === 'passed').length,
      missing: missingCount,
      needsAttention: needsAttentionCount,
      warnings: checks.filter((c) => c.status === 'warning').length
    },
    checks,
    recommendations
  };
}

/**
 * Classify pull request size based on changed lines and files
 *
 * @param {object} params
 * @param {number} [params.additions=0]
 * @param {number} [params.deletions=0]
 * @param {number} [params.changedFiles=0]
 * @param {Array<string>} [params.fileNames=[]]
 * @returns {object}
 */
export function classifyPullRequestSize({ additions = 0, deletions = 0, changedFiles = 0, fileNames = [] } = {}) {
  const totalLines = (Number(additions) || 0) + (Number(deletions) || 0);

  let classification = 'NONE';
  let label = null;
  let description = '0 lines changed';

  if (totalLines > 0) {
    for (const t of PR_SIZE_THRESHOLDS) {
      if (totalLines >= t.min && totalLines <= t.max) {
        classification = t.id;
        label = t.label;
        description = t.description;
        break;
      }
    }
  }

  // Detect generated or lockfiles
  const lockfilePattern = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|composer\.lock)$/i;
  const minifiedPattern = /(\.min\.(js|css)|bundle\.js|dist\/)/i;

  const generatedFiles = (Array.isArray(fileNames) ? fileNames : []).filter(
    (name) => lockfilePattern.test(name) || minifiedPattern.test(name)
  );

  return {
    linesChanged: totalLines,
    additions: Number(additions) || 0,
    deletions: Number(deletions) || 0,
    changedFiles: Number(changedFiles) || 0,
    classification,
    label,
    description,
    hasGeneratedFiles: generatedFiles.length > 0,
    generatedFiles,
    notice: generatedFiles.length > 0
      ? `Line count may be inflated by ${generatedFiles.length} generated/lock file(s): ${generatedFiles.slice(0, 3).join(', ')}.`
      : null
  };
}

/**
 * Format a first-time contributor welcome message with variable substitution and idempotency marker
 *
 * @param {object} params
 * @param {string} params.username
 * @param {string} params.repo
 * @param {string} [params.customMessage]
 * @param {object} [params.links]
 * @returns {string}
 */
export function formatWelcomeMessage({ username, repo, customMessage, links = {} } = {}) {
  const user = sanitizeText(username || 'contributor', 100);
  const repository = sanitizeText(repo || 'repository', 150);

  const contributingUrl = links.contributingUrl || `https://github.com/${repository}/blob/main/CONTRIBUTING.md`;
  const conductUrl = links.conductUrl || `https://github.com/${repository}/blob/main/CODE_OF_CONDUCT.md`;
  const supportUrl = links.supportUrl || `https://github.com/${repository}/blob/main/SUPPORT.md`;
  const docsUrl = links.docsUrl || `https://github.com/${repository}#documentation`;

  let message = customMessage;
  if (!message) {
    message = [
      `👋 Welcome to **${repository}**, @${user}! Thank you for opening your first contribution.`,
      '',
      'Before proceeding with review, please make sure you have checked our community guides:',
      `- 📖 [Contribution Guidelines](${contributingUrl})`,
      `- 🤝 [Code of Conduct](${conductUrl})`,
      `- 💬 [Support Channels](${supportUrl})`,
      '',
      'A maintainer will review your contribution shortly. Feel free to add any additional context or testing instructions in the description!'
    ].join('\n');
  } else {
    // Variable substitution
    message = message
      .replace(/\{username\}/g, user)
      .replace(/\{repo\}/g, repository)
      .replace(/\{contributing_url\}/g, contributingUrl)
      .replace(/\{code_of_conduct_url\}/g, conductUrl)
      .replace(/\{support_url\}/g, supportUrl)
      .replace(/\{docs_url\}/g, docsUrl);
  }

  return appendMarker(message, MARKERS.WELCOME);
}

/**
 * Tokenize text into normalized significant words
 */
function tokenizeWords(text = '') {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'with',
    'by', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during',
    'without', 'before', 'under', 'around', 'among', 'this', 'that', 'these', 'those', 'it', 'its', 'from',
    'not', 'be', 'can', 'will', 'do', 'does', 'did', 'have', 'has', 'had', 'when', 'where', 'which', 'who',
    'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some', 'such', 'no', 'nor', 'only'
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Calculate Jaccard text similarity between two sets of tokens
 */
function calculateJaccardSimilarity(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Find potentially related or duplicate candidate issues
 *
 * @param {object} targetIssue
 * @param {Array<object>} candidateIssues
 * @param {object} [options]
 * @param {number} [options.limit=5]
 * @param {number} [options.minScore=0.25]
 * @returns {Array<object>}
 */
export function findDuplicateCandidates(targetIssue = {}, candidateIssues = [], { limit = 5, minScore = 0.25 } = {}) {
  const targetNumber = targetIssue.number;
  const targetTitleTokens = tokenizeWords(targetIssue.title || '');
  const targetBodyTokens = tokenizeWords(targetIssue.body || '');
  const targetTokens = [...targetTitleTokens, ...targetBodyTokens];

  const results = [];

  for (const cand of candidateIssues) {
    if (!cand || cand.number === targetNumber) continue;
    // Exclude pull requests
    if (cand.pull_request) continue;

    const candTitleTokens = tokenizeWords(cand.title || '');
    const candBodyTokens = tokenizeWords(cand.body || '');
    const candTokens = [...candTitleTokens, ...candBodyTokens];

    // Title similarity has higher weight (60%) than full body similarity (40%)
    const titleSim = calculateJaccardSimilarity(targetTitleTokens, candTitleTokens);
    const bodySim = calculateJaccardSimilarity(targetTokens, candTokens);
    const combinedScore = (titleSim * 0.6) + (bodySim * 0.4);

    if (combinedScore >= minScore) {
      // Find matching keywords
      const candSet = new Set(candTokens);
      const matchingKeywords = Array.from(new Set(targetTitleTokens.filter((t) => candSet.has(t)))).slice(0, 5);

      results.push({
        number: cand.number,
        title: cand.title,
        url: cand.html_url || `https://github.com/issues/${cand.number}`,
        similarityScore: Math.round(combinedScore * 100),
        matchingKeywords,
        state: cand.state || 'open',
        explanation: matchingKeywords.length > 0
          ? `Shares keywords: "${matchingKeywords.join(', ')}"`
          : 'Similar vocabulary in issue title/description'
      });
    }
  }

  // Sort descending by similarity score and slice
  return results.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
}

/**
 * Inspect an issue to evaluate if it is stale under repository criteria
 *
 * @param {object} issue
 * @param {object} [options]
 * @param {number} [options.daysInactive=30]
 * @param {Array<string>} [options.exemptLabels]
 * @returns {object}
 */
export function evaluateStaleIssue(issue = {}, { daysInactive = 30, exemptLabels = DEFAULT_EXEMPT_STALE_LABELS } = {}) {
  const issueNumber = issue.number || null;
  const updatedAt = issue.updated_at ? new Date(issue.updated_at) : new Date();
  const now = new Date();
  const diffDays = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));

  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === 'string' ? l.toLowerCase() : String(l?.name || '').toLowerCase()))
    : [];

  const exempt = labels.some((l) => exemptLabels.map((e) => e.toLowerCase()).includes(l));
  const isSecurity = labels.includes('security') || /security|vulnerabilit/i.test(issue.title || '');

  const isStale = !exempt && !isSecurity && diffDays >= daysInactive;

  let reason = '';
  if (exempt) {
    reason = 'Exempt from stale status by protected label.';
  } else if (isSecurity) {
    reason = 'Security-related issues are exempt from automated stale classification.';
  } else if (isStale) {
    reason = `No activity recorded for ${diffDays} days (threshold is ${daysInactive} days).`;
  } else {
    reason = `Active within the last ${diffDays} days (threshold is ${daysInactive} days).`;
  }

  return {
    issueNumber,
    title: issue.title || '',
    daysInactive: diffDays,
    thresholdDays: daysInactive,
    updatedAt: issue.updated_at,
    isStale,
    isExempt: exempt || isSecurity,
    reason,
    suggestedAction: isStale ? 'Add stale label and notify participants' : 'No action needed'
  };
}

/**
 * Generate draft release notes from merged pull requests
 *
 * @param {object} params
 * @param {Array<object>} params.pulls
 * @param {string} [params.releaseTitle='Release Notes']
 * @param {string} [params.previousTag]
 * @param {string} [params.currentTag]
 * @param {string} [params.repoUrl]
 * @returns {string}
 */
export function generateReleaseNotesFromPulls({
  pulls = [],
  releaseTitle = 'Release Notes',
  previousTag = null,
  currentTag = null,
  repoUrl = ''
} = {}) {
  const categories = {
    breaking: { title: '⚠️ Breaking Changes', items: [] },
    feat: { title: '🚀 Features & Enhancements', items: [] },
    fix: { title: '🐛 Bug Fixes', items: [] },
    docs: { title: '📖 Documentation', items: [] },
    perf: { title: '⚡ Performance Improvements', items: [] },
    security: { title: '🔒 Security', items: [] },
    maintenance: { title: '🛠️ Maintenance & Chores', items: [] },
    other: { title: '📦 Other Changes', items: [] }
  };

  for (const pr of pulls) {
    const title = String(pr.title || '').trim();
    if (!title) continue;

    const prNumber = pr.number;
    const author = pr.user?.login || pr.author?.login || null;
    const url = pr.html_url || (repoUrl ? `${repoUrl.replace(/\/+$/, '')}/pull/${prNumber}` : `#${prNumber}`);
    const labels = Array.isArray(pr.labels)
      ? pr.labels.map((l) => (typeof l === 'string' ? l.toLowerCase() : String(l?.name || '').toLowerCase()))
      : [];

    let formatted = `- ${title} ([#${prNumber}](${url}))`;
    if (author) {
      formatted += ` by @${author}`;
    }

    // Determine category
    const isBreaking = /breaking change/i.test(pr.body || '') || /^([a-z]+)(\([a-z0-9_-]+\))?!:/i.test(title);
    if (isBreaking) {
      categories.breaking.items.push(formatted);
      continue;
    }

    if (labels.includes('security') || /security|cve|vulnerabilit/i.test(title)) {
      categories.security.items.push(formatted);
    } else if (labels.includes('bug') || /^fix(\([a-z0-9_-]+\))?:/i.test(title)) {
      categories.fix.items.push(formatted);
    } else if (labels.includes('enhancement') || labels.includes('feature') || /^feat(\([a-z0-9_-]+\))?:/i.test(title)) {
      categories.feat.items.push(formatted);
    } else if (labels.includes('documentation') || /^docs(\([a-z0-9_-]+\))?:/i.test(title)) {
      categories.docs.items.push(formatted);
    } else if (labels.includes('performance') || /^perf(\([a-z0-9_-]+\))?:/i.test(title)) {
      categories.perf.items.push(formatted);
    } else if (labels.includes('maintenance') || /^(chore|build|ci|refactor|test)(\([a-z0-9_-]+\))?:/i.test(title)) {
      categories.maintenance.items.push(formatted);
    } else {
      categories.other.items.push(formatted);
    }
  }

  const lines = [
    `# ${releaseTitle}`,
    ''
  ];

  if (currentTag || previousTag) {
    const tagRange = previousTag && currentTag
      ? `Changes between \`${previousTag}\` and \`${currentTag}\``
      : `Release \`${currentTag || previousTag}\``;
    lines.push(tagRange);
    lines.push('');
  }

  let hasSections = false;
  for (const cat of Object.values(categories)) {
    if (cat.items.length > 0) {
      hasSections = true;
      lines.push(`## ${cat.title}`);
      lines.push('');
      for (const item of cat.items) {
        lines.push(item);
      }
      lines.push('');
    }
  }

  if (!hasSections) {
    lines.push('No merged pull requests found in this release.');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse and validate repository configuration (.github/open-workers.yml)
 *
 * @param {string|object} raw
 * @returns {object}
 */