/**
 * Open Workers — Documentation Engine
 *
 * Provides README parsing and completeness analysis, deterministic README generation,
 * changelog generation from Conventional Commits, badge snippet generators,
 * and Markdown link extraction with SSRF-safe URL validation.
 */

// Supported section categories in README
export const README_SECTIONS = Object.freeze([
  { id: 'title', label: 'Project Title', severity: 'high', required: true },
  { id: 'description', label: 'Description & Overview', severity: 'high', required: true },
  { id: 'features', label: 'Key Features', severity: 'medium', required: false },
  { id: 'installation', label: 'Installation / Setup', severity: 'high', required: true },
  { id: 'usage', label: 'Usage & Examples', severity: 'high', required: true },
  { id: 'configuration', label: 'Configuration', severity: 'medium', required: false },
  { id: 'testing', label: 'Testing Instructions', severity: 'medium', required: false },
  { id: 'contributing', label: 'Contributing Guidelines', severity: 'medium', required: false },
  { id: 'support', label: 'Support & Help', severity: 'low', required: false },
  { id: 'license', label: 'License Notice', severity: 'high', required: true },
  { id: 'documentation', label: 'Documentation Links', severity: 'medium', required: false }
]);

export const BADGE_TYPES = Object.freeze([
  { id: 'license', name: 'License Badge' },
  { id: 'workflow', name: 'GitHub Actions Workflow Status' },
  { id: 'release', name: 'Latest Release' },
  { id: 'stars', name: 'GitHub Stars' },
  { id: 'issues', name: 'Open Issues' },
  { id: 'contributors', name: 'Contributors' },
  { id: 'node', name: 'Node.js Version' },
  { id: 'custom', name: 'Custom Badge' }
]);

export function listDocumentationChecks() {
  return [
    { id: 'readme-present', name: 'README File Presence', category: 'readme', description: 'Checks if a repository README file exists in root or standard locations.' },
    { id: 'readme-title-desc', name: 'Project Title & Overview', category: 'readme', description: 'Evaluates whether the README clearly introduces the project title and purpose.' },
    { id: 'readme-installation', name: 'Installation & Setup', category: 'readme', description: 'Checks for clear getting started, prerequisite, or installation instructions.' },
    { id: 'readme-usage', name: 'Usage Instructions', category: 'readme', description: 'Verifies usage guides, CLI references, or code examples.' },
    { id: 'readme-license', name: 'License Documentation', category: 'readme', description: 'Checks for explicit license reference or badge in the README.' },
    { id: 'docs-directory', name: 'Docs Directory', category: 'structure', description: 'Inspects whether a dedicated docs/ directory exists for extended guides.' },
    { id: 'changelog-present', name: 'Changelog Presence', category: 'history', description: 'Checks for a CHANGELOG.md file recording release and version history.' },
    { id: 'links-health', name: 'Markdown Links Health', category: 'links', description: 'Validates that relative repository paths and internal Markdown links are resolvable.' }
  ];
}

export function listDocumentationTemplates() {
  return [
    { id: 'readme', name: 'README Generator & Assistant', filename: 'README.md', description: 'Generates structured READMEs or proposes targeted section improvements.' },
    { id: 'changelog', name: 'Changelog Generator', filename: 'CHANGELOG.md', description: 'Compiles commit history into Conventional Commits grouped release notes.' },
    { id: 'badges', name: 'Badge Generator', description: 'Generates Markdown status badges for licenses, CI, releases, and metrics.' }
  ];
}

/**
 * Sanitize plain strings for Markdown insertion without breaking headings
 */
function sanitizeText(str, maxLength = 2000) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\0\r]/g, '').slice(0, maxLength);
}

/**
 * Parse Markdown headings and detect present sections
 *
 * @param {string} content
 * @returns {object}
 */
export function parseReadmeContent(content = '') {
  if (typeof content !== 'string') return { sections: {}, rawHeadings: [], hasBadges: false };

  const lines = content.split('\n');
  const headings = [];
  let title = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/[#*_`]/g, '').trim();
      headings.push({ level, text, lineIndex: i });
      if (level === 1 && !title) {
        title = text;
      }
    }
  }

  // Detect sections by matching heading text against common terms
  const detected = {
    title: Boolean(title),
    titleText: title,
    description: false,
    features: false,
    installation: false,
    prerequisites: false,
    usage: false,
    configuration: false,
    testing: false,
    contributing: false,
    support: false,
    license: false,
    security: false,
    documentation: false
  };

  // Check description: non-empty text before first H2 or under H1
  if (title) {
    const h1Index = headings.find((h) => h.level === 1)?.lineIndex ?? 0;
    const nextHIndex = headings.find((h) => h.level <= 2 && h.lineIndex > h1Index)?.lineIndex ?? lines.length;
    const introLines = lines.slice(h1Index + 1, nextHIndex).map((l) => l.trim()).filter((l) => l && !l.startsWith('[!') && !l.startsWith('<') && !l.startsWith('![') && !l.startsWith('[!['));
    if (introLines.length > 0) {
      detected.description = true;
    }
  }

  for (const h of headings) {
    const t = h.text.toLowerCase();

    if (/feature|highlight|capabilit|what (is|can)|overview/i.test(t)) detected.features = true;
    if (/install|getting started|quick start|setup|prerequisite|requirement/i.test(t)) detected.installation = true;
    if (/prerequisite|requirement|system requirement|dependenc/i.test(t)) detected.prerequisites = true;
    if (/usage|how to use|quick example|basic usage|command|running/i.test(t)) detected.usage = true;
    if (/config|environment|setting|option|env variable/i.test(t)) detected.configuration = true;
    if (/test|testing|run test|test suite/i.test(t)) detected.testing = true;
    if (/contribut|development|workflow|developing|collaborat/i.test(t)) detected.contributing = true;
    if (/support|troubleshoot|help|faq|community|contact/i.test(t)) detected.support = true;
    if (/licen[cs]e|legal|copyright/i.test(t)) detected.license = true;
    if (/security|vulnerabilit|disclosure/i.test(t)) detected.security = true;
    if (/documentation|docs|guide|architecture|api reference/i.test(t)) detected.documentation = true;
  }

  // Check for license mention or badge in raw content even if no H2
  if (!detected.license && /licen[cs]e|shields\.io\/badge\/licen[cs]e|spdx/i.test(content)) {
    detected.license = true;
  }

  // Check for badges
  const hasBadges = /img\.shields\.io|github\.com\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\/badge\.svg|badge\.svg/i.test(content);

  return {
    detected,
    rawHeadings: headings,
    hasBadges,
    lineCount: lines.length
  };
}

/**
 * Generate a clean, complete GitHub-flavored Markdown README
 *
 * @param {object} options
 * @returns {string}
 */
export function generateReadme(options = {}) {
  const name = sanitizeText(options.projectName || 'My Project', 100);
  const description = sanitizeText(options.description || '', 500);
  const repoUrl = options.repositoryUrl ? sanitizeText(options.repositoryUrl, 200) : '';
  const license = options.license ? sanitizeText(options.license, 100) : 'MIT';

  const lines = [
    `# ${name}`,
    ''
  ];

  // Optional badges
  if (Array.isArray(options.badges) && options.badges.length > 0) {
    const badgeSnippets = options.badges.map((b) => typeof b === 'string' ? b : generateBadge(b)).filter(Boolean);
    if (badgeSnippets.length > 0) {
      lines.push(badgeSnippets.join(' '));
      lines.push('');
    }
  }

  if (description) {
    lines.push(description);
    lines.push('');
  }

  // Features
  if (Array.isArray(options.features) && options.features.length > 0) {
    lines.push('## Features');
    lines.push('');
    for (const feat of options.features) {
      const clean = sanitizeText(feat, 200);
      if (clean) lines.push(`- ${clean}`);
    }
    lines.push('');
  }

  // Prerequisites
  if (Array.isArray(options.prerequisites) && options.prerequisites.length > 0) {
    lines.push('## Prerequisites');
    lines.push('');
    for (const prereq of options.prerequisites) {
      const clean = sanitizeText(prereq, 200);
      if (clean) lines.push(`- ${clean}`);
    }
    lines.push('');
  }

  // Installation
  lines.push('## Installation');
  lines.push('');
  if (options.installation) {
    lines.push(sanitizeText(options.installation, 2000));
  } else {
    lines.push('Clone the repository and install dependencies:');
    lines.push('');
    lines.push('```bash');
    if (repoUrl) lines.push(`git clone ${repoUrl}`);
    lines.push('cd <project-folder>');
    lines.push('```');
  }
  lines.push('');

  // Usage
  lines.push('## Usage');
  lines.push('');
  if (options.usage) {
    lines.push(sanitizeText(options.usage, 2000));
  } else {
    lines.push('Provide instructions on how to run or use the project:');
    lines.push('');
    lines.push('```bash');
    lines.push('# Example usage command');
    lines.push('```');
  }
  lines.push('');

  // Configuration (optional)
  if (options.configuration) {
    lines.push('## Configuration');
    lines.push('');
    lines.push(sanitizeText(options.configuration, 2000));
    lines.push('');
  }

  // Testing (optional)
  if (options.testing) {
    lines.push('## Running Tests');
    lines.push('');
    lines.push(sanitizeText(options.testing, 1000));
    lines.push('');
  }

  // Documentation (optional)
  if (options.documentationUrl) {
    lines.push('## Documentation');
    lines.push('');
    lines.push(`For detailed guides and architecture references, see the [Documentation](${options.documentationUrl}).`);
    lines.push('');
  }

  // Contributing
  lines.push('## Contributing');
  lines.push('');
  if (options.contributing) {
    lines.push(sanitizeText(options.contributing, 1000));
  } else {
    lines.push('Contributions are welcome! Please open an issue or submit a pull request for improvements.');
  }
  lines.push('');

  // Support (optional)
  if (options.support) {
    lines.push('## Support');
    lines.push('');
    lines.push(sanitizeText(options.support, 1000));
    lines.push('');
  }

  // License
  lines.push('## License');
  lines.push('');
  lines.push(`This project is licensed under the ${license} License - see the [LICENSE](LICENSE) file for details.`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Propose targeted section additions to an existing README without destroying existing content
 *
 * @param {string} originalContent
 * @param {object} sectionsToAdd e.g. { installation: '...', usage: '...', testing: '...' }
 * @returns {{ content: string, addedSections: string[], skippedSections: string[] }}
 */
export function improveExistingReadme(originalContent = '', sectionsToAdd = {}) {
  if (typeof originalContent !== 'string') originalContent = '';

  const parsed = parseReadmeContent(originalContent);
  const detected = parsed.detected;

  const addedSections = [];
  const skippedSections = [];
  const sectionsToAppend = [];

  const sectionMap = {
    installation: { heading: '## Installation', contentKey: 'installation', defaultTitle: 'Installation' },
    usage: { heading: '## Usage', contentKey: 'usage', defaultTitle: 'Usage' },
    features: { heading: '## Features', contentKey: 'features', defaultTitle: 'Features' },
    configuration: { heading: '## Configuration', contentKey: 'configuration', defaultTitle: 'Configuration' },
    testing: { heading: '## Running Tests', contentKey: 'testing', defaultTitle: 'Running Tests' },
    contributing: { heading: '## Contributing', contentKey: 'contributing', defaultTitle: 'Contributing' },
    support: { heading: '## Support', contentKey: 'support', defaultTitle: 'Support' },
    documentation: { heading: '## Documentation', contentKey: 'documentation', defaultTitle: 'Documentation' }
  };

  for (const [key, sectionVal] of Object.entries(sectionsToAdd)) {
    if (!sectionVal) continue;
    const config = sectionMap[key];
    if (!config) continue;

    // Check if section is already present in original content
    if (detected[key]) {
      skippedSections.push(config.defaultTitle);
      continue;
    }

    let textToAdd = '';
    if (Array.isArray(sectionVal)) {
      textToAdd = sectionVal.map((item) => `- ${sanitizeText(item, 200)}`).join('\n');
    } else {
      textToAdd = sanitizeText(sectionVal, 2000);
    }

    if (textToAdd) {
      sectionsToAppend.push(`${config.heading}\n\n${textToAdd}\n`);
      addedSections.push(config.defaultTitle);
    }
  }

  if (sectionsToAppend.length === 0) {
    return { content: originalContent, addedSections, skippedSections };
  }

  // Cleanly append before License or at end of file
  let newContent = originalContent.trimEnd();
  const appendBlock = '\n\n' + sectionsToAppend.join('\n');

  // If there is an existing ## License section, insert before it
  const licenseMatch = newContent.match(/\n(#{2,3}\s+License[\s\S]*)$/i);
  if (licenseMatch && licenseMatch.index) {
    const beforeLicense = newContent.slice(0, licenseMatch.index);
    const licensePart = newContent.slice(licenseMatch.index).trim();
    newContent = beforeLicense + appendBlock + '\n\n' + licensePart + '\n';
  } else {
    newContent += appendBlock + '\n';
  }

  return {
    content: newContent,
    addedSections,
    skippedSections
  };
}

/**
 * Generate a clean changelog section from Git commits
 *
 * @param {object} params
 * @param {string} params.version
 * @param {string} [params.date]
 * @param {Array<object>} params.commits
 * @param {string} [params.previousChangelog]
 * @param {string} [params.repoUrl]
 * @returns {string}
 */
export function generateChangelog({ version, date, commits = [], previousChangelog = '', repoUrl = '' } = {}) {
  const ver = sanitizeText(version || 'Unreleased', 50);
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
    ? date.trim()
    : new Date().toISOString().slice(0, 10);

  const categories = {
    breaking: { title: 'Breaking Changes', items: [] },
    feat: { title: 'Features', items: [] },
    fix: { title: 'Bug Fixes', items: [] },
    perf: { title: 'Performance Improvements', items: [] },
    refactor: { title: 'Refactoring', items: [] },
    docs: { title: 'Documentation', items: [] },
    test: { title: 'Tests', items: [] },
    build: { title: 'Build & CI', items: [] },
    chore: { title: 'Maintenance & Chores', items: [] },
    other: { title: 'Other Changes', items: [] }
  };

  for (const c of commits) {
    const rawMsg = typeof c === 'string' ? c : c?.message || c?.commit?.message || '';
    const firstLine = rawMsg.split('\n')[0].trim();
    if (!firstLine) continue;

    const sha = typeof c === 'object' && c?.sha ? c.sha.slice(0, 7) : null;
    const author = typeof c === 'object' && (c?.author?.login || c?.commit?.author?.name) ? (c.author?.login || c.commit.author.name) : null;

    // Check for breaking changes
    const isBreaking = /BREAKING CHANGE:/i.test(rawMsg) || /^[a-z]+(\([a-z0-9_-]+\))?!:/.test(firstLine);

    // Match conventional commit: type(scope): message
    const match = firstLine.match(/^([a-z]+)(?:\(([a-z0-9_-]+)\))?!?:\s*(.+)$/i);

    let formattedEntry = firstLine;
    let categoryKey = 'other';

    if (match) {
      const type = match[1].toLowerCase();
      const scope = match[2];
      const desc = match[3];

      formattedEntry = scope ? `**${scope}:** ${desc}` : desc;

      if (type === 'feat') categoryKey = 'feat';
      else if (type === 'fix') categoryKey = 'fix';
      else if (type === 'perf') categoryKey = 'perf';
      else if (type === 'refactor') categoryKey = 'refactor';
      else if (type === 'docs') categoryKey = 'docs';
      else if (type === 'test') categoryKey = 'test';
      else if (type === 'build' || type === 'ci') categoryKey = 'build';
      else if (type === 'chore') categoryKey = 'chore';
    }

    if (sha && repoUrl) {
      formattedEntry += ` ([${sha}](${repoUrl.replace(/\/+$/, '')}/commit/${sha}))`;
    } else if (sha) {
      formattedEntry += ` (${sha})`;
    }

    if (author) {
      formattedEntry += ` - @${author}`;
    }

    if (isBreaking) {
      categories.breaking.items.push(formattedEntry);
    } else {
      categories[categoryKey].items.push(formattedEntry);
    }
  }

  // Build the version block
  const versionLines = [
    `## [${ver}] - ${d}`,
    ''
  ];

  let hasItems = false;
  for (const cat of Object.values(categories)) {
    if (cat.items.length > 0) {
      hasItems = true;
      versionLines.push(`### ${cat.title}`);
      versionLines.push('');
      for (const item of cat.items) {
        versionLines.push(`- ${item}`);
      }
      versionLines.push('');
    }
  }

  if (!hasItems) {
    versionLines.push('No notable changes in this release.');
    versionLines.push('');
  }

  const versionBlock = versionLines.join('\n');

  // Prepend to existing changelog or generate full CHANGELOG.md
  if (!previousChangelog || typeof previousChangelog !== 'string' || !previousChangelog.trim()) {
    const header = [
      '# Changelog',
      '',
      'All notable changes to this project will be documented in this file.',
      'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),',
      'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
      '',
      versionBlock
    ].join('\n');
    return header;
  }

  // Prepend cleanly after top header if present
  const headerMatch = previousChangelog.match(/^#\s+Changelog[\s\S]*?(?=\n##\s+\[|\n##\s+v?\d)/i);
  if (headerMatch) {
    const topHeader = headerMatch[0].trimEnd();
    const rest = previousChangelog.slice(topHeader.length).trimStart();
    return `${topHeader}\n\n${versionBlock}\n${rest}`;
  }

  return `${versionBlock}\n${previousChangelog}`;
}

/**
 * Generate a Markdown badge snippet
 *
 * @param {object} badge
 * @returns {string}
 */
export function generateBadge(badge = {}) {
  if (!badge || typeof badge !== 'object') return '';
  const type = badge.type || badge.id;

  if (type === 'license') {
    const spdx = encodeURIComponent(badge.spdx || 'MIT');
    const repo = badge.repo ? badge.repo.trim() : '';
    const link = repo ? `https://github.com/${repo}/blob/main/LICENSE` : 'LICENSE';
    return `[![License](https://img.shields.io/badge/license-${spdx}-blue.svg)](${link})`;
  }

  if (type === 'workflow') {
    const owner = encodeURIComponent(badge.owner || 'owner');
    const repo = encodeURIComponent(badge.repo || 'repo');
    const workflow = encodeURIComponent(badge.workflow || 'ci.yml');
    return `[![CI Status](https://github.com/${owner}/${repo}/actions/workflows/${workflow}/badge.svg)](https://github.com/${owner}/${repo}/actions)`;
  }

  if (type === 'release') {
    const owner = encodeURIComponent(badge.owner || 'owner');
    const repo = encodeURIComponent(badge.repo || 'repo');
    return `[![Latest Release](https://img.shields.io/github/v/release/${owner}/${repo})](https://github.com/${owner}/${repo}/releases)`;
  }

  if (type === 'stars') {
    const owner = encodeURIComponent(badge.owner || 'owner');
    const repo = encodeURIComponent(badge.repo || 'repo');
    return `[![GitHub Stars](https://img.shields.io/github/stars/${owner}/${repo})](https://github.com/${owner}/${repo}/stargazers)`;
  }

  if (type === 'issues') {
    const owner = encodeURIComponent(badge.owner || 'owner');
    const repo = encodeURIComponent(badge.repo || 'repo');
    return `[![Open Issues](https://img.shields.io/github/issues/${owner}/${repo})](https://github.com/${owner}/${repo}/issues)`;
  }

  if (type === 'contributors') {
    const owner = encodeURIComponent(badge.owner || 'owner');
    const repo = encodeURIComponent(badge.repo || 'repo');
    return `[![Contributors](https://img.shields.io/github/contributors/${owner}/${repo})](https://github.com/${owner}/${repo}/graphs/contributors)`;
  }

  if (type === 'node') {
    const ver = encodeURIComponent(badge.version || '>=20.0.0');
    return `[![Node.js Version](https://img.shields.io/badge/node-${ver}-brightgreen)](https://nodejs.org/)`;
  }

  if (type === 'custom') {
    const label = encodeURIComponent(badge.label || 'badge');
    const message = encodeURIComponent(badge.message || 'active');
    const color = encodeURIComponent(badge.color || 'blue');
    const link = badge.link && /^https?:\/\//i.test(badge.link) ? badge.link : '#';
    return `[![${badge.label || 'Badge'}](https://img.shields.io/badge/${label}-${message}-${color})](${link})`;
  }

  return '';
}
