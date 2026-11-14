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