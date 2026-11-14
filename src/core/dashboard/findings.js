/**
 * Open Workers — Dashboard Findings Normalizer & Aggregator
 *
 * Normalizes results from the six core product modules and compiles
 * prioritized cross-module actionable recommendations.
 */

/**
 * Normalize Licensing Audit Result
 */
export function normalizeLicensingFindings(result, repoFullName) {
  if (!result) {
    return {
      module: 'licensing',
      status: 'failed',
      summary: 'Licensing analysis failed or was unavailable.',
      score: null,
      findings: [],
      recommendations: []
    };
  }

  const isLicensed =
    result.status === 'licensed' ||
    result.hasLicense === true ||
    Boolean(result.license?.spdx_id && result.license.spdx_id !== 'NOASSERTION');

  const isUnrecognized =
    result.status === 'unrecognized' ||
    (result.hasLicense && result.license?.spdx_id === 'NOASSERTION');

  const detected =
    result.detectedLicense?.name ||
    result.detectedLicense?.spdxId ||
    result.license?.name ||
    result.license?.spdx_id ||
    null;

  const enc = encodeURIComponent(repoFullName);

  const findings = [];
  const licensePresent = Boolean(
    result.licenseFile?.present ||
    (Array.isArray(result.files) && result.files.some((f) => /licen[sc]e|copying/i.test(typeof f === 'string' ? f : f?.name || ''))) ||
    result.hasLicense
  );

  findings.push({
    id: 'license-file',
    title: 'License File',
    status: licensePresent ? 'present' : 'missing',
    description: licensePresent
      ? `License file detected in repository.`
      : 'No LICENSE or COPYING file found in repository root.'
  });

  if (result.noticeFile !== undefined) {
    findings.push({
      id: 'notice-file',
      title: 'Notice File',
      status: result.noticeFile?.present ? 'present' : 'missing',
      description: result.noticeFile?.present
        ? `Notice file detected at "${result.noticeFile.path}".`
        : 'No NOTICE file found.'
    });
  }

  if (result.readmeFile !== undefined) {
    findings.push({
      id: 'readme-license',
      title: 'README License Reference',
      status: result.readmeFile?.hasLicenseMention ? 'present' : 'missing',
      description: result.readmeFile?.hasLicenseMention
        ? 'README contains license section or badge.'
        : 'README does not mention licensing.'
    });
  }

  const recommendations = [];
  if (!isLicensed) {
    recommendations.push({
      module: 'licensing',
      priority: 'high',
      title: 'Choose and Apply an Open-Source License',
      description: isUnrecognized
        ? 'A license file was detected, but the terms could not be matched to a standard SPDX identifier.'
        : 'The repository is unlicensed. Without an open-source license, default copyright laws apply and others cannot legally use or modify the code.',
      actionUrl: `/questionnaire.html?repo=${enc}`,
      actionLabel: 'Find a License'
    });
  } else if (result.readmeFile && !result.readmeFile.hasLicenseMention) {
    recommendations.push({
      module: 'licensing',
      priority: 'low',
      title: 'Add License Badge to README',
      description: `Repository is licensed under ${detected || 'an open source license'}. Adding a status badge makes permissions clear to visitors.`,
      actionUrl: `/documentation.html?repo=${enc}`,
      actionLabel: 'Generate Badge'
    });
  }

  let score = null;
  if (isLicensed) {
    score = result.readmeFile?.hasLicenseMention ? 100 : 85;
  } else if (isUnrecognized) {
    score = 40;
  } else {
    score = 0;
  }

  return {
    module: 'licensing',
    status: isLicensed ? 'available' : 'warning',
    summary: isLicensed
      ? `Licensed under ${detected || 'OSI-approved license'}.`
      : isUnrecognized
        ? 'Unrecognized custom license text detected.'
        : 'No open source license detected (All Rights Reserved).',
    score,
    findings,
    recommendations
  };
}

/**
 * Normalize Community Health Audit Result
 */
export function normalizeCommunityFindings(result, repoFullName) {
  if (!result) {
    return {
      module: 'community',
      status: 'failed',
      summary: 'Community standards analysis failed or was unavailable.',
      score: null,
      findings: [],
      recommendations: []
    };
  }

  const enc = encodeURIComponent(repoFullName);
  const score = result.summary?.score ?? result.score ?? 0;
  const rawList = Array.isArray(result.findings)
    ? result.findings
    : Array.isArray(result.checks)
      ? result.checks
      : [];

  const findings = rawList.map((f) => ({
    id: f.standard || f.id,
    title: f.label || f.name,
    status: f.status,
    description: f.message || f.recommendation || f.description || ''
  }));

  const recommendations = [];
  const checkMap = new Map(rawList.map((f) => [f.standard || f.id, f]));

  const coc = checkMap.get('code-of-conduct') || checkMap.get('code_of_conduct');
  if (coc && coc.status === 'missing') {
    recommendations.push({
      module: 'community',
      priority: 'medium',
      title: 'Adopt Code of Conduct (CODE_OF_CONDUCT.md)',
      description: 'Establishes clear behavioral expectations and creates a welcoming environment for all contributors.',
      actionUrl: `/community.html?repo=${enc}&template=code-of-conduct`,
      actionLabel: 'Generate Code of Conduct'
    });
  }

  const contrib = checkMap.get('contributing');
  if (contrib && contrib.status === 'missing') {
    recommendations.push({
      module: 'community',
      priority: 'medium',
      title: 'Add Contributing Guidelines (CONTRIBUTING.md)',
      description: 'Clarifies setup instructions, PR conventions, testing requirements, and issue submission rules.',
      actionUrl: `/community.html?repo=${enc}&template=contributing`,
      actionLabel: 'Generate CONTRIBUTING.md'
    });
  }

  const sec = checkMap.get('security');
  if (sec && sec.status === 'missing') {
    recommendations.push({
      module: 'community',
      priority: 'high',
      title: 'Publish Security Policy (SECURITY.md)',
      description: 'Instructs security researchers and users how to responsibly report vulnerabilities without public disclosure.',
      actionUrl: `/community.html?repo=${enc}&template=security`,
      actionLabel: 'Generate SECURITY.md'
    });
  }

  const issues = checkMap.get('issue-templates') || checkMap.get('issue_templates');
  if (issues && issues.status === 'missing') {
    recommendations.push({
      module: 'community',
      priority: 'low',
      title: 'Configure Structured Issue Templates',
      description: 'Adds bug report and feature request templates in .github/ISSUE_TEMPLATE/ for higher-quality bug tickets.',
      actionUrl: `/community.html?repo=${enc}&template=issue-bug-report`,
      actionLabel: 'Generate Issue Templates'
    });
  }

  const prTpl = checkMap.get('pull-request-template') || checkMap.get('pull_request_template');
  if (prTpl && prTpl.status === 'missing') {
    recommendations.push({
      module: 'community',
      priority: 'low',
      title: 'Add Pull Request Template',
      description: 'Provides contributors with a standard checklist and summary format on every pull request.',
      actionUrl: `/community.html?repo=${enc}&template=pr-template-standard`,
      actionLabel: 'Generate PR Template'
    });
  }

  return {
    module: 'community',
    status: score >= 80 ? 'available' : 'warning',
    summary: `Community profile is ${score}% complete.`,
    score,
    findings,
    recommendations
  };
}

/**
 * Normalize Security Configuration Audit Result
 */
export function normalizeSecurityFindings(result, repoFullName) {
  if (!result || (!Array.isArray(result.checks) && typeof result.score !== 'number')) {
    return {
      module: 'security',
      status: 'failed',
      summary: 'Security configuration analysis failed or was unavailable.',
      score: null,
      findings: [],
      recommendations: []
    };
  }

  const enc = encodeURIComponent(repoFullName);
  const score = result.summary?.healthScore ?? result.score ?? 0;
  const rawChecks = Array.isArray(result.checks) ? result.checks : [];

  const findings = rawChecks.map((c) => ({
    id: c.id,
    title: c.name,
    status: c.status,
    description: c.description || c.recommendation || ''
  }));

  const recommendations = [];
  const checkMap = new Map(rawChecks.map((c) => [c.id, c]));

  const secPolicy = checkMap.get('security-policy') || checkMap.get('security_md');
  if (secPolicy && (secPolicy.status === 'missing' || secPolicy.status === 'needs_attention')) {
    recommendations.push({
      module: 'security',
      priority: 'high',
      title: 'Publish Responsible Security Policy',
      description: 'Document supported versions, safe disclosure channels, and PGP/email encryption keys.',
      actionUrl: `/security.html?repo=${enc}`,
      actionLabel: 'Generate Security Policy'
    });
  }

  const dependabot = checkMap.get('dependabot');
  if (dependabot && (dependabot.status === 'missing' || dependabot.status === 'needs_attention')) {
    recommendations.push({
      module: 'security',
      priority: 'medium',
      title: 'Enable Automated Dependency Updates (Dependabot)',
      description: 'Keeps third-party dependencies updated against known CVE vulnerabilities automatically.',
      actionUrl: `/security.html?repo=${enc}`,
      actionLabel: 'Configure Dependabot'
    });
  }

  const codeql = checkMap.get('codeql');
  if (codeql && (codeql.status === 'missing' || codeql.status === 'needs_attention')) {
    recommendations.push({
      module: 'security',
      priority: 'medium',
      title: 'Configure CodeQL Static Analysis',
      description: 'Scans source code for security flaws and injection vulnerabilities on every PR.',
      actionUrl: `/security.html?repo=${enc}`,
      actionLabel: 'Configure CodeQL'
    });
  }

  return {
    module: 'security',
    status: score >= 80 ? 'available' : 'warning',
    summary: `Security baseline health score is ${score}%.`,
    score,
    findings,
    recommendations
  };
}

/**
 * Normalize Documentation Audit Result
 */
export function normalizeDocumentationFindings(result, repoFullName) {
  if (!result || (!Array.isArray(result.checks) && typeof result.score !== 'number')) {
    return {
      module: 'documentation',
      status: 'failed',
      summary: 'Documentation analysis failed or was unavailable.',
      score: null,
      findings: [],
      recommendations: []
    };
  }

  const enc = encodeURIComponent(repoFullName);
  const score = result.summary?.completenessScore ?? result.completenessScore ?? result.score ?? 0;
  const rawChecks = Array.isArray(result.checks) ? result.checks : [];

  const findings = rawChecks.map((c) => ({
    id: c.id,
    title: c.name,
    status: c.status,
    description: c.message || c.recommendation || ''
  }));

  const recommendations = [];
  const checkMap = new Map(rawChecks.map((c) => [c.id, c]));

  const readme = checkMap.get('readme-present') || checkMap.get('readme_exists');
  if (readme && readme.status === 'missing') {
    recommendations.push({
      module: 'documentation',
      priority: 'high',
      title: 'Create Repository README.md',
      description: 'The repository lacks a README. Document project purpose, quickstart, installation, and usage.',
      actionUrl: `/documentation.html?repo=${enc}`,
      actionLabel: 'Generate README.md'
    });
  }

  const badge = checkMap.get('license-badge') || checkMap.get('license_badge');
  if (badge && badge.status === 'missing') {
    recommendations.push({
      module: 'documentation',
      priority: 'low',
      title: 'Add License Badge to Documentation',
      description: 'Display an official Shields.io license badge in your README header.',
      actionUrl: `/documentation.html?repo=${enc}`,
      actionLabel: 'Generate Badge'
    });
  }

  return {
    module: 'documentation',
    status: score >= 80 ? 'available' : 'warning',
    summary: `Documentation completeness score is ${score}%.`,
    score,
    findings,
    recommendations
  };
}

/**
 * Normalize PR & Issue Health Inspection Result
 */
export function normalizeIssuesFindings(staleResult, repoData, repoFullName) {
  const enc = encodeURIComponent(repoFullName);
  const openCount = repoData?.open_issues_count ?? 0;
  const staleCount = staleResult?.staleCount ?? 0;
  const staleIssues = Array.isArray(staleResult?.staleIssues) ? staleResult.staleIssues : [];

  const findings = [
    {
      id: 'open-tickets',
      title: 'Open Issues & PRs',
      status: 'present',
      description: `${openCount} active issue(s) and pull request(s) tracked in repository.`
    },
    {
      id: 'stale-issues',
      title: 'Dormant / Stale Issues',
      status: staleCount > 0 ? 'warning' : 'passed',
      description: staleCount > 0
        ? `${staleCount} issue(s) without activity in the past 30 days.`
        : 'No dormant issues detected.'
    }
  ];

  const recommendations = [];
  if (staleCount > 0) {
    recommendations.push({
      module: 'issues',
      priority: 'medium',
      title: `Triage ${staleCount} Dormant / Stale Issues`,
      description: 'Review inactive tickets, ping authors for updates, or apply closure notices to keep backlog lean.',
      actionUrl: `/issues.html?repo=${enc}`,
      actionLabel: 'Review Stale Issues'
    });
  }

  return {
    module: 'issues',
    status: staleCount > 0 ? 'warning' : 'available',
    summary: `${openCount} open ticket(s). ${staleCount > 0 ? `${staleCount} stale ticket(s) flagged.` : 'Collaboration triage ready.'}`,
    score: null,
    findings,
    recommendations
  };
}

/**
 * Normalize Repository Automation Audit Result
 */
export function normalizeAutomationFindings(result, repoFullName) {
  if (!result || (!Array.isArray(result.findings) && !Array.isArray(result.checks) && typeof result.score !== 'number')) {
    return {
      module: 'automation',
      status: 'failed',
      summary: 'Repository automation audit failed or was unavailable.',
      score: null,
      findings: [],
      recommendations: []
    };
  }

  const enc = encodeURIComponent(repoFullName);
  const score = result.setupScore ?? result.score ?? 0;
  const rawList = Array.isArray(result.findings)
    ? result.findings
    : Array.isArray(result.checks)
      ? result.checks
      : [];

  const findings = rawList.map((f) => ({
    id: f.id,
    title: f.name || f.title,
    status: f.status,
    description: f.description || ''
  }));

  const recommendations = [];
  const checkMap = new Map(rawList.map((f) => [f.id, f]));

  const ci = checkMap.get('ci-workflow') || checkMap.get('ci_workflow');
  if (ci && ci.status === 'missing') {
    recommendations.push({
      module: 'automation',
      priority: 'high',
      title: 'Generate GitHub Actions CI Workflow',
      description: 'Automate test execution, linting, and build validation on push and pull requests.',
      actionUrl: `/automation.html?repo=${enc}`,
      actionLabel: 'Generate CI Workflow'
    });
  }

  const editorconfig = checkMap.get('editorconfig');
  if (editorconfig && editorconfig.status === 'missing') {
    recommendations.push({
      module: 'automation',
      priority: 'medium',
      title: 'Establish Code Style Standards (.editorconfig)',
      description: 'Ensures consistent indentation, charset, and newline formatting across different IDEs.',
      actionUrl: `/automation.html?repo=${enc}`,
      actionLabel: 'Generate .editorconfig'
    });
  }

  return {
    module: 'automation',
    status: score >= 80 ? 'available' : 'warning',
    summary: `Repository setup health score is ${score}%.`,
    score,
    findings,
    recommendations
  };
}

/**
 * Compile and prioritize cross-module recommendations
 */
export function aggregateDashboardFindings(modules = {}) {
  const allRecommendations = [];

  for (const [moduleKey, mod] of Object.entries(modules)) {
    if (Array.isArray(mod.recommendations)) {
      for (const rec of mod.recommendations) {
        allRecommendations.push({
          module: moduleKey,
          priority: rec.priority || 'medium',
          title: rec.title,
          description: rec.description,
          actionUrl: rec.actionUrl,
          actionLabel: rec.actionLabel
        });
      }
    }
  }

  // Deduplicate recommendations by title
  const seenTitles = new Set();
  const uniqueRecommendations = [];
  for (const rec of allRecommendations) {
    if (!seenTitles.has(rec.title)) {
      seenTitles.add(rec.title);
      uniqueRecommendations.push(rec);
    }
  }

  // Sort by priority: high -> medium -> low
  const priorityWeight = { high: 1, medium: 2, low: 3 };
  uniqueRecommendations.sort((a, b) => (priorityWeight[a.priority] || 4) - (priorityWeight[b.priority] || 4));

  const moduleEntries = Object.values(modules);
  const totalModules = moduleEntries.length;
  const evaluatedCount = moduleEntries.filter((m) => m.status !== 'failed').length;
  const completedCount = moduleEntries.filter((m) => m.status === 'available' || m.status === 'completed').length;
  const attentionCount = moduleEntries.filter((m) => m.status === 'warning' || m.status === 'failed').length;

  const highPriorityCount = uniqueRecommendations.filter((r) => r.priority === 'high').length;
  const mediumPriorityCount = uniqueRecommendations.filter((r) => r.priority === 'medium').length;
  const lowPriorityCount = uniqueRecommendations.filter((r) => r.priority === 'low').length;

  return {
    prioritizedRecommendations: uniqueRecommendations,
    summary: {
      totalModules,
      modulesEvaluated: totalModules,
      modulesAnalyzed: totalModules,
      modulesNeedingAttention: attentionCount,
      totalActionableFindings: uniqueRecommendations.length,
      highPriorityFindings: highPriorityCount,
      highPriorityCount,
      mediumPriorityFindings: mediumPriorityCount,
      lowPriorityFindings: lowPriorityCount,
      completedCount,
      attentionCount
    }
  };
}
