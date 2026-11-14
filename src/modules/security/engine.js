/**
 * Open Workers — Security Engine
 *
 * Defines supported security checks, configuration templates, validation schemas,
 * and deterministic YAML generators for Dependabot and CodeQL.
 */

export const SUPPORTED_ECOSYSTEMS = Object.freeze([
  { id: 'npm', name: 'npm (JavaScript / TypeScript)', defaultDirectory: '/' },
  { id: 'pip', name: 'pip (Python)', defaultDirectory: '/' },
  { id: 'github-actions', name: 'GitHub Actions', defaultDirectory: '/' },
  { id: 'docker', name: 'Docker', defaultDirectory: '/' },
  { id: 'maven', name: 'Maven (Java)', defaultDirectory: '/' },
  { id: 'gradle', name: 'Gradle (Java / Kotlin)', defaultDirectory: '/' },
  { id: 'bundler', name: 'Bundler (Ruby)', defaultDirectory: '/' },
  { id: 'cargo', name: 'Cargo (Rust)', defaultDirectory: '/' }
]);

export const SUPPORTED_CODEQL_LANGUAGES = Object.freeze([
  { id: 'javascript-typescript', name: 'JavaScript / TypeScript', buildMode: 'none' },
  { id: 'python', name: 'Python', buildMode: 'none' },
  { id: 'ruby', name: 'Ruby', buildMode: 'none' },
  { id: 'go', name: 'Go', buildMode: 'autobuild' },
  { id: 'java-kotlin', name: 'Java / Kotlin', buildMode: 'autobuild' },
  { id: 'c-cpp', name: 'C / C++', buildMode: 'autobuild' },
  { id: 'csharp', name: 'C#', buildMode: 'autobuild' },
  { id: 'rust', name: 'Rust', buildMode: 'autobuild' }
]);

export const SECURITY_CHECKS = Object.freeze([
  {
    id: 'security-policy',
    name: 'Security Policy (SECURITY.md)',
    category: 'policy',
    severity: 'high',
    description: 'Instructions for researchers to report security vulnerabilities privately.',
    canGenerateFix: false,
    fixUrl: '/community.html?template=security',
    fixLabel: 'Generate in Community module'
  },
  {
    id: 'dependabot-config',
    name: 'Dependabot Configuration',
    category: 'dependencies',
    severity: 'medium',
    description: 'Automated dependency update configuration (.github/dependabot.yml).',
    canGenerateFix: true,
    fixTemplateId: 'dependabot',
    fixLabel: 'Generate Dependabot config'
  },
  {
    id: 'codeql-analysis',
    name: 'CodeQL Static Analysis',
    category: 'code-scanning',
    severity: 'medium',
    description: 'Automated semantic code analysis workflow (.github/workflows/codeql.yml).',
    canGenerateFix: true,
    fixTemplateId: 'codeql',
    fixLabel: 'Generate CodeQL workflow'
  },
  {
    id: 'branch-protection',
    name: 'Default Branch Protection',
    category: 'branch-governance',
    severity: 'medium',
    description: 'Protects default branch from direct pushes, unreviewed PRs, and failed checks.',
    canGenerateFix: false
  },
  {
    id: 'secret-scanning',
    name: 'Secret Scanning',
    category: 'secrets',
    severity: 'high',
    description: 'Detects accidentally committed secrets, tokens, and credentials.',
    canGenerateFix: false
  },
  {
    id: 'dependabot-alerts',
    name: 'Dependabot Vulnerability Alerts',
    category: 'dependencies',
    severity: 'high',
    description: 'Alerts maintainers about vulnerable dependencies.',
    canGenerateFix: false
  }
]);

export const SECURITY_TEMPLATES = Object.freeze([
  {
    id: 'dependabot',
    name: 'Dependabot Configuration',
    filename: '.github/dependabot.yml',
    description: 'Automated version and security updates for package dependencies and GitHub Actions.',
    supportedEcosystems: SUPPORTED_ECOSYSTEMS.map((e) => e.id),
    defaultSchedule: { interval: 'weekly', day: 'monday', time: '06:00', timezone: 'Etc/UTC' }
  },
  {
    id: 'codeql',
    name: 'CodeQL Static Analysis Workflow',
    filename: '.github/workflows/codeql.yml',
    description: 'Semantic code vulnerability scanning on push, pull request, and schedule.',
    supportedLanguages: SUPPORTED_CODEQL_LANGUAGES.map((l) => l.id),
    defaultLanguages: ['javascript-typescript'],
    defaultBranches: ['main'],
    defaultCron: '30 6 * * 1'
  }
]);

export function listSecurityChecks() {
  return SECURITY_CHECKS.map((c) => ({ ...c }));
}

export function listSecurityTemplates() {
  return SECURITY_TEMPLATES.map((t) => ({ ...t }));
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\r\n\0]/g, '').trim().slice(0, maxLength);
}

function sanitizeDirectory(dir) {
  if (typeof dir !== 'string') return '/';
  const trimmed = dir.trim();
  if (!trimmed || trimmed === '/') return '/';
  if (!trimmed.startsWith('/')) {
    throw new Error('Directory path must start with "/" (e.g. "/" or "/packages/core").');
  }
  if (trimmed.includes('\\') || trimmed.includes('\0') || trimmed.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('Directory path must be a clean relative path without traversal segments (".." or ".").');
  }
  return trimmed.replace(/\/+$/, '') || '/';
}

/**
 * Generate a valid, deterministic Dependabot YAML configuration
 *
 * @param {object} [options]
 * @returns {string}
 */
export function generateDependabotConfig(options = {}) {
  const updatesInput = Array.isArray(options.updates) && options.updates.length > 0
    ? options.updates
    : [
        {
          packageEcosystem: 'npm',
          directory: '/',
          schedule: { interval: 'weekly', day: 'monday', time: '06:00', timezone: 'Etc/UTC' },
          openPullRequestsLimit: 10,
          labels: ['dependencies']
        }
      ];

  if (updatesInput.length > 15) {
    throw new Error('Maximum of 15 ecosystem updates allowed per Dependabot configuration.');
  }

  const validEcosystems = new Set(SUPPORTED_ECOSYSTEMS.map((e) => e.id));
  const validIntervals = new Set(['daily', 'weekly', 'monthly']);
  const validDays = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  const seenPairs = new Set();
  const normalizedUpdates = [];

  for (const raw of updatesInput) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Each Dependabot update entry must be an object.');
    }

    const ecosystem = String(raw.packageEcosystem || raw['package-ecosystem'] || '').trim().toLowerCase();
    if (!validEcosystems.has(ecosystem)) {
      throw new Error(`Unsupported package ecosystem "${ecosystem}". Supported: ${[...validEcosystems].join(', ')}.`);
    }

    const directory = sanitizeDirectory(raw.directory);
    const pairKey = `${ecosystem}:${directory}`;
    if (seenPairs.has(pairKey)) {
      throw new Error(`Duplicate ecosystem/directory combination found: "${ecosystem}" at "${directory}".`);
    }
    seenPairs.add(pairKey);

    const rawSched = raw.schedule || {};
    const interval = String(rawSched.interval || 'weekly').trim().toLowerCase();
    if (!validIntervals.has(interval)) {
      throw new Error(`Invalid schedule interval "${interval}". Must be daily, weekly, or monthly.`);
    }

    let day = null;
    if (interval === 'weekly') {
      day = String(rawSched.day || 'monday').trim().toLowerCase();
      if (!validDays.has(day)) {
        throw new Error(`Invalid schedule day "${day}". Must be a valid day of the week (e.g. monday).`);
      }
    }

    const time = rawSched.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(rawSched.time).trim())
      ? String(rawSched.time).trim()
      : '06:00';
    const timezone = sanitizeString(rawSched.timezone || 'Etc/UTC', 40) || 'Etc/UTC';

    let limit = 10;
    const rawLimit = raw.openPullRequestsLimit ?? raw['open-pull-requests-limit'];
    if (rawLimit !== undefined && rawLimit !== null) {
      const parsedLimit = parseInt(rawLimit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        throw new Error('open-pull-requests-limit must be an integer between 1 and 50.');
      }
      limit = parsedLimit;
    }

    const labels = Array.isArray(raw.labels)
      ? raw.labels.map((l) => sanitizeString(l, 50)).filter(Boolean)
      : ['dependencies'];

    const targetBranch = raw.targetBranch || raw['target-branch']
      ? sanitizeString(raw.targetBranch || raw['target-branch'], 100)
      : null;

    const reviewers = Array.isArray(raw.reviewers)
      ? raw.reviewers.map((r) => sanitizeString(r, 40).replace(/^@/, '')).filter(Boolean)
      : [];

    normalizedUpdates.push({
      ecosystem,
      directory,
      interval,
      day,
      time,
      timezone,
      limit,
      labels,
      targetBranch,
      reviewers
    });
  }

  // Build deterministic YAML
  const lines = [
    '# Open Workers — Dependabot Configuration',
    '# Automated version updates for package dependencies and GitHub Actions.',
    '# Documentation: https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file',
    '',
    'version: 2',
    'updates:'
  ];

  for (const item of normalizedUpdates) {
    lines.push(`  - package-ecosystem: "${item.ecosystem}"`);
    lines.push(`    directory: "${item.directory}"`);
    lines.push('    schedule:');
    lines.push(`      interval: "${item.interval}"`);
    if (item.day) {
      lines.push(`      day: "${item.day}"`);
    }
    lines.push(`      time: "${item.time}"`);
    lines.push(`      timezone: "${item.timezone}"`);
    lines.push(`    open-pull-requests-limit: ${item.limit}`);

    if (item.targetBranch) {
      lines.push(`    target-branch: "${item.targetBranch}"`);
    }

    if (item.labels.length > 0) {
      lines.push('    labels:');
      for (const label of item.labels) {
        lines.push(`      - "${label}"`);
      }
    }

    if (item.reviewers.length > 0) {
      lines.push('    reviewers:');
      for (const reviewer of item.reviewers) {
        lines.push(`      - "${reviewer}"`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate a valid, deterministic CodeQL GitHub Actions workflow
 *
 * @param {object} [options]
 * @returns {string}
 */
export function generateCodeQLWorkflow(options = {}) {
  const validLangMap = new Map(SUPPORTED_CODEQL_LANGUAGES.map((l) => [l.id, l]));

  let selectedLangs = Array.isArray(options.languages) && options.languages.length > 0
    ? options.languages.map((l) => String(l).trim().toLowerCase())
    : ['javascript-typescript'];

  // Remove duplicates while preserving order
  selectedLangs = [...new Set(selectedLangs)];

  for (const lang of selectedLangs) {
    if (!validLangMap.has(lang)) {
      throw new Error(`Unsupported CodeQL language "${lang}". Supported: ${[...validLangMap.keys()].join(', ')}.`);
    }
  }

  const branchesInput = Array.isArray(options.branches) && options.branches.length > 0
    ? options.branches.map((b) => sanitizeString(b, 100)).filter(Boolean)
    : ['main'];

  const branches = branchesInput.length > 0 ? branchesInput : ['main'];

  // Cron schedule: default to Monday 06:30 UTC
  const cron = options.cron && typeof options.cron === 'string' && /^[0-9*,-/]+(\s+[0-9*,-/]+){4}$/.test(options.cron.trim())
    ? options.cron.trim()
    : '30 6 * * 1';

  const workflowName = sanitizeString(options.workflowName || 'CodeQL Analysis', 50) || 'CodeQL Analysis';

  const lines = [
    '# Open Workers — CodeQL Static Analysis Workflow',
    '# Automated semantic security analysis to discover vulnerabilities before merge.',
    '# Documentation: https://docs.github.com/en/code-security/code-scanning',
    '',
    `name: "${workflowName}"`,
    '',
    'on:',
    '  push:',
    `    branches: [ ${branches.map((b) => `"${b}"`).join(', ')} ]`,
    '  pull_request:',
    `    branches: [ ${branches.map((b) => `"${b}"`).join(', ')} ]`,
    '  schedule:',
    `    - cron: "${cron}"`,
    '',
    'permissions:',
    '  actions: read',
    '  contents: read',
    '  security-events: write',
    '',
    'jobs:',
    '  analyze:',
    '    name: Analyze (${{ matrix.language }})',
    "    runs-on: ${{ (matrix.language == 'swift' ? 'macos-latest' : 'ubuntu-latest') }}",
    '    timeout-minutes: ${{ (matrix.language == \'swift\' ? 120 : 360) }}',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        include:'
  ];

  for (const langId of selectedLangs) {
    const meta = validLangMap.get(langId);
    lines.push(`          - language: ${langId}`);
    lines.push(`            build-mode: ${meta.buildMode}`);
  }

  lines.push('');
  lines.push('    steps:');
  lines.push('      - name: Checkout repository');
  lines.push('        uses: actions/checkout@v4');
  lines.push('');
  lines.push('      - name: Initialize CodeQL');
  lines.push('        uses: github/codeql-action/init@v3');
  lines.push('        with:');
  lines.push('          languages: ${{ matrix.language }}');
  lines.push('          build-mode: ${{ matrix.build-mode }}');
  lines.push('');
  lines.push('      - name: Perform CodeQL Analysis');
  lines.push('        uses: github/codeql-action/analyze@v3');
  lines.push('        with:');
  lines.push('          category: "/language:${{ matrix.language }}"');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a security configuration document by templateId
 *
 * @param {object} params
 * @param {string} params.templateId
 * @param {object} [params.options]
 * @returns {{ templateId: string, filename: string, content: string, options: object }}
 */
export function generateSecurityConfig({ templateId, options = {} } = {}) {
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('templateId is required.');
  }

  const id = templateId.trim().toLowerCase();
  if (id === 'dependabot') {
    const content = generateDependabotConfig(options);
    return {
      templateId: 'dependabot',
      filename: '.github/dependabot.yml',
      content,
      options
    };
  }

  if (id === 'codeql') {
    const content = generateCodeQLWorkflow(options);
    return {
      templateId: 'codeql',
      filename: '.github/workflows/codeql.yml',
      content,
      options
    };
  }

  throw new Error(`Unknown security template "${templateId}". Supported: dependabot, codeql.`);
}
