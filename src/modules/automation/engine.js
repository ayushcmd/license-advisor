/**
 * Open Workers — Repository Automation Engine
 *
 * Deterministic generators for CI workflows (Node.js, Python, Multi-platform Matrix,
 * PR Validation, Scheduled Maintenance) and code quality standards (.editorconfig,
 * .prettierrc.json, eslint.config.js, .gitattributes, .gitignore).
 * Includes Workflow Health Inspector and Repository Setup Auditor.
 */

// Supported runtime options and limits
export const SUPPORTED_NODE_VERSIONS = Object.freeze(['18', '20', '22', '24']);
export const SUPPORTED_PYTHON_VERSIONS = Object.freeze(['3.9', '3.10', '3.11', '3.12', '3.13']);
export const SUPPORTED_OPERATING_SYSTEMS = Object.freeze(['ubuntu-latest', 'windows-latest', 'macos-latest']);
export const SUPPORTED_PACKAGE_MANAGERS = Object.freeze(['npm', 'yarn', 'pnpm']);

// Known deprecated GitHub Actions references
export const DEPRECATED_ACTIONS = Object.freeze([
  { prefix: 'actions/checkout@v1', recommendation: 'Upgrade to actions/checkout@v4' },
  { prefix: 'actions/checkout@v2', recommendation: 'Upgrade to actions/checkout@v4' },
  { prefix: 'actions/setup-node@v1', recommendation: 'Upgrade to actions/setup-node@v4' },
  { prefix: 'actions/setup-node@v2', recommendation: 'Upgrade to actions/setup-node@v4' },
  { prefix: 'actions/setup-python@v1', recommendation: 'Upgrade to actions/setup-python@v5' },
  { prefix: 'actions/setup-python@v2', recommendation: 'Upgrade to actions/setup-python@v5' },
  { prefix: 'actions/setup-python@v3', recommendation: 'Upgrade to actions/setup-python@v5' },
  { prefix: 'actions/upload-artifact@v1', recommendation: 'Upgrade to actions/upload-artifact@v4' },
  { prefix: 'actions/upload-artifact@v2', recommendation: 'Upgrade to actions/upload-artifact@v4' },
  { prefix: 'actions/upload-artifact@v3', recommendation: 'Upgrade to actions/upload-artifact@v4' },
  { prefix: 'actions/download-artifact@v1', recommendation: 'Upgrade to actions/download-artifact@v4' },
  { prefix: 'actions/download-artifact@v2', recommendation: 'Upgrade to actions/download-artifact@v4' },
  { prefix: 'actions/download-artifact@v3', recommendation: 'Upgrade to actions/download-artifact@v4' }
]);

export const AUTOMATION_CHECKS = Object.freeze([
  {
    id: 'ci-workflow',
    name: 'CI / Testing Workflow',
    category: 'ci',
    severity: 'high',
    description: 'Continuous Integration workflow executing automated tests on push and pull requests.',
    canGenerateFix: true,
    fixTemplateId: 'node-ci',
    fixLabel: 'Generate CI workflow'
  },
  {
    id: 'editorconfig',
    name: 'EditorConfig (.editorconfig)',
    category: 'quality',
    severity: 'medium',
    description: 'Consistent indentation, charset, and newline configurations across diverse IDEs.',
    canGenerateFix: true,
    fixTemplateId: 'editorconfig',
    fixLabel: 'Generate .editorconfig'
  },
  {
    id: 'prettier',
    name: 'Prettier Configuration',
    category: 'quality',
    severity: 'low',
    description: 'Automated code formatting configuration for web and JavaScript projects.',
    canGenerateFix: true,
    fixTemplateId: 'prettier',
    fixLabel: 'Generate Prettier config'
  },
  {
    id: 'eslint',
    name: 'ESLint Configuration',
    category: 'quality',
    severity: 'medium',
    description: 'Static analysis and code quality linting rules for JavaScript/TypeScript.',
    canGenerateFix: true,
    fixTemplateId: 'eslint',
    fixLabel: 'Generate ESLint config'
  },
  {
    id: 'gitattributes',
    name: 'Git Attributes (.gitattributes)',
    category: 'quality',
    severity: 'medium',
    description: 'Line-ending normalization (LF/CRLF) and binary file handling across platforms.',
    canGenerateFix: true,
    fixTemplateId: 'gitattributes',
    fixLabel: 'Generate .gitattributes'
  },
  {
    id: 'gitignore',
    name: 'Git Ignore (.gitignore)',
    category: 'quality',
    severity: 'high',
    description: 'Excludes dependencies, environment secrets, and build artifacts from version control.',
    canGenerateFix: true,
    fixTemplateId: 'gitignore',
    fixLabel: 'Generate .gitignore'
  },
  {
    id: 'workflow-health',
    name: 'Workflow Security & Hygiene',
    category: 'ci',
    severity: 'high',
    description: 'Audits existing GitHub Actions workflows for explicit permissions, timeouts, and unpinned actions.',
    canGenerateFix: false,
    fixUrl: '/automation.html#inspector',
    fixLabel: 'Inspect workflows'
  },
  {
    id: 'repo-metadata',
    name: 'Repository Metadata',
    category: 'maintenance',
    severity: 'low',
    description: 'Public repository description, homepage, and discovery topics on GitHub.',
    canGenerateFix: false,
    fixLabel: 'Configure in GitHub settings'
  }
]);

export const AUTOMATION_TEMPLATES = Object.freeze([
  {
    id: 'node-ci',
    name: 'Node.js CI Workflow',
    filename: '.github/workflows/node-ci.yml',
    category: 'workflow',
    description: 'Build, lint, and test Node.js applications with automated dependency caching.',
    requiresWorkflowPermission: true
  },
  {
    id: 'python-ci',
    name: 'Python CI Workflow',
    filename: '.github/workflows/python-ci.yml',
    category: 'workflow',
    description: 'Test, lint, and type-check Python code across multiple runtime versions.',
    requiresWorkflowPermission: true
  },
  {
    id: 'matrix-ci',
    name: 'Multi-Platform Matrix CI',
    filename: '.github/workflows/matrix-ci.yml',
    category: 'workflow',
    description: 'Cross-platform testing on Ubuntu, Windows, and macOS with bounded job matrix.',
    requiresWorkflowPermission: true
  },
  {
    id: 'pr-validation',
    name: 'Pull Request Validation',
    filename: '.github/workflows/pr-validation.yml',
    category: 'workflow',
    description: 'Fast, secure validation workflow strictly scoped for incoming pull requests.',
    requiresWorkflowPermission: true
  },
  {
    id: 'maintenance',
    name: 'Scheduled Maintenance',
    filename: '.github/workflows/maintenance.yml',
    category: 'workflow',
    description: 'Weekly scheduled workflow for automated dependency audits and non-destructive maintenance.',
    requiresWorkflowPermission: true
  },
  {
    id: 'editorconfig',
    name: 'EditorConfig',
    filename: '.editorconfig',
    category: 'quality',
    description: 'Standard editor whitespace, indentation, charset, and newline definitions.',
    requiresWorkflowPermission: false
  },
  {
    id: 'prettier',
    name: 'Prettier Configuration',
    filename: '.prettierrc.json',
    category: 'quality',
    description: 'JSON formatting rules for code formatting consistency.',
    requiresWorkflowPermission: false
  },
  {
    id: 'eslint',
    name: 'ESLint Flat Configuration',
    filename: 'eslint.config.js',
    category: 'quality',
    description: 'Modern ESLint flat config for JavaScript and TypeScript projects.',
    requiresWorkflowPermission: false
  },
  {
    id: 'gitattributes',
    name: 'Git Attributes',
    filename: '.gitattributes',
    category: 'quality',
    description: 'Cross-platform text normalization and binary asset declarations.',
    requiresWorkflowPermission: false
  },
  {
    id: 'gitignore',
    name: 'Git Ignore',
    filename: '.gitignore',
    category: 'quality',
    description: 'Starter gitignore rules tailored for Node.js, Python, or multi-language projects.',
    requiresWorkflowPermission: false
  }
]);

export function listAutomationChecks() {
  return AUTOMATION_CHECKS;
}

export function listAutomationTemplates() {
  return AUTOMATION_TEMPLATES;
}

// Helper: Sanitize string to prevent untrusted script injection
export function inspectWorkflowContent({ path = '.github/workflows/unknown.yml', content = '' } = {}) {
  const findings = [];
  const lines = content.split('\n');

  // Basic YAML validity / structure check
  const hasOn = /^\s*on\s*:/m.test(content);
  const hasJobs = /^\s*jobs\s*:/m.test(content);
  if (!hasOn || !hasJobs) {
    findings.push({
      id: 'malformed-structure',
      category: 'general',
      severity: 'critical',
      title: 'Malformed or incomplete workflow syntax',
      explanation: 'Workflow appears to be missing required top-level "on" trigger or "jobs" declaration.',
      suggestion: 'Ensure the workflow defines both "on:" triggers and at least one job under "jobs:".'
    });
  }

  // 1. Permission checks
  const hasTopLevelPermissions = /^\s*permissions\s*:/m.test(content);
  const hasWriteAll = /permissions\s*:\s*write-all/i.test(content);
  if (hasWriteAll) {
    findings.push({
      id: 'broad-permissions',
      category: 'permissions',
      severity: 'high',
      title: 'Overly broad permissions (write-all)',
      explanation: 'Using "permissions: write-all" grants full write access to all repository scopes, violating the principle of least privilege.',
      suggestion: 'Declare only the minimum permissions needed (e.g. "permissions: contents: read").'
    });
  } else if (!hasTopLevelPermissions) {
    // Check if jobs define permissions
    const hasJobLevelPermissions = /^\s{4}permissions\s*:/m.test(content);
    if (!hasJobLevelPermissions) {
      findings.push({
        id: 'missing-permissions',
        category: 'permissions',
        severity: 'warning',
        title: 'Missing explicit permissions declaration',
        explanation: 'Workflow does not declare top-level or job-level permissions. GitHub default permissions may grant write access to repository contents.',
        suggestion: 'Add an explicit "permissions: contents: read" block to follow least-privilege standards.'
      });
    }
  }

  // 2. Timeout checks
  const hasJobTimeout = /timeout-minutes\s*:\s*\d+/i.test(content);
  if (!hasJobTimeout && hasJobs) {
    findings.push({
      id: 'missing-timeout',
      category: 'timeouts',
      severity: 'warning',
      title: 'Missing job timeout configuration',
      explanation: 'Jobs without "timeout-minutes" can run up to the default GitHub maximum (6 hours) if stuck in an infinite loop, exhausting runner quota.',
      suggestion: 'Add "timeout-minutes: 15" (or appropriate duration) to each job.'
    });
  }

  // 3. Action references and pinning checks
  const actionRegex = /uses\s*:\s*([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?:@([^\s#]+))?/g;
  let match;
  while ((match = actionRegex.exec(content)) !== null) {
    const actionPath = match[1];
    const ref = match[2];
    const fullAction = ref ? `${actionPath}@${ref}` : actionPath;

    if (!ref) {
      findings.push({
        id: 'unpinned-action',
        category: 'actions',
        severity: 'high',
        title: `Unpinned action reference: ${actionPath}`,
        explanation: `Action "${actionPath}" is referenced without a version tag or commit SHA.`,
        suggestion: `Pin the action to a specific release tag or commit SHA (e.g. ${actionPath}@v4).`
      });
      continue;
    }

    // Check for branch references like @master, @main, @HEAD
    if (/^(master|main|head|latest|trunk)$/i.test(ref)) {
      findings.push({
        id: 'mutable-branch-ref',
        category: 'actions',
        severity: 'high',
        title: `Mutable branch reference on action: ${actionPath}@${ref}`,
        explanation: `Action "${actionPath}" references mutable branch "${ref}". Upstream commits can modify behavior unexpectedly.`,
        suggestion: `Pin to a release tag (e.g. @v4) or full commit SHA.`
      });
    }

    // Check for known deprecated actions
    const deprecated = DEPRECATED_ACTIONS.find((d) => fullAction.startsWith(d.prefix) || (actionPath === d.prefix.split('@')[0] && ref === d.prefix.split('@')[1]));
    if (deprecated) {
      findings.push({
        id: 'deprecated-action',
        category: 'actions',
        severity: 'warning',
        title: `Deprecated action reference: ${deprecated.prefix}`,
        explanation: `"${deprecated.prefix}" is outdated or uses an older Node runtime runner.`,
        suggestion: deprecated.recommendation
      });
    }
  }

  // 4. Trigger safety checks
  if (/pull_request_target/i.test(content)) {
    // If pull_request_target is used with checkout of head SHA/ref, flag as critical
    if (/ref\s*:\s*\${{\s*github\.event\.pull_request\.head\.(sha|ref)\s*}}/i.test(content)) {
      findings.push({
        id: 'dangerous-pr-target-checkout',
        category: 'trigger-safety',
        severity: 'critical',
        title: 'Dangerous checkout on pull_request_target',
        explanation: 'Checking out untrusted pull request code with "pull_request_target" triggers can allow external contributors to execute malicious scripts with base repository secrets.',
        suggestion: 'Use "pull_request" trigger for running tests on fork PRs, or check out the base branch ref.'
      });
    } else {
      findings.push({
        id: 'pr-target-warning',
        category: 'trigger-safety',
        severity: 'warning',
        title: 'Privileged pull_request_target trigger',
        explanation: 'Workflow runs with write permissions and secret access on incoming PRs. Ensure no untrusted code is executed.',
        suggestion: 'Verify that any code executed from PRs is strictly sanitized.'
      });
    }
  }

  // 5. Untrusted expression interpolation into shell run blocks
  const runBlockRegex = /run\s*:\s*([^\n]+(?:\n\s{8,}[^\n]+)*)/g;
  let runMatch;
  while ((runMatch = runBlockRegex.exec(content)) !== null) {
    const runText = runMatch[1];
    if (/\${{\s*github\.event\.(issue|pull_request|comment)\.(title|body)/i.test(runText) ||
        /\${{\s*github\.head_ref\s*}}/i.test(runText)) {
      findings.push({
        id: 'untrusted-script-interpolation',
        category: 'trigger-safety',
        severity: 'high',
        title: 'Untrusted expression interpolation in shell script',
        explanation: 'Embedding GitHub event expressions directly inside a "run:" script can allow arbitrary command injection if inputs contain shell metacharacters.',
        suggestion: 'Pass event values through environment variables (e.g. "env: PR_TITLE: ${{ github.event.issue.title }}") and reference $PR_TITLE in shell.'
      });
      break;
    }
  }

  // Calculate health score: start at 100, deduct based on severities
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'critical') score -= 35;
    else if (f.severity === 'high') score -= 20;
    else if (f.severity === 'warning') score -= 10;
    else if (f.severity === 'low') score -= 5;
  }
  score = Math.max(0, score);

  return {
    path,
    findings,
    healthScore: score,
    status: score >= 90 ? 'passed' : score >= 70 ? 'warning' : 'needs_attention',
    summary: `${findings.length} findings (${findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length} high/critical)`
  };
}

/**
 * Pure evaluator for repository setup checks
 */
export function evaluateRepositorySetup({
  repoMetadata = {},
  rootFiles = [],
  dotGithubFiles = [],
  workflowFiles = [],
  workflowHealthReports = []
} = {}) {
  const rootSet = new Set(rootFiles.map((f) => f.name.toLowerCase()));
  const dotGithubSet = new Set(dotGithubFiles.map((f) => f.name.toLowerCase()));

  const findings = [];

  // 1. CI Workflow Check
  const ciWorkflows = workflowFiles.filter((wf) => {
    const name = wf.name.toLowerCase();
    return name.includes('ci') || name.includes('test') || name.includes('build') || name.includes('main');
  });
  if (ciWorkflows.length > 0) {
    findings.push({
      id: 'ci-workflow',
      name: 'CI / Testing Workflow',
      status: 'passed',
      description: `Active CI workflow detected: "${ciWorkflows.map((w) => w.name).join(', ')}".`,
      recommendation: 'CI workflows are present to test incoming changes.',
      canGenerateFix: false
    });
  } else {
    findings.push({
      id: 'ci-workflow',
      name: 'CI / Testing Workflow',
      status: 'missing',
      description: 'No active CI or testing workflows found under .github/workflows/.',
      recommendation: 'Generate a standard Node.js or Python CI workflow to automate tests on push and pull requests.',
      canGenerateFix: true,
      fixTemplateId: 'node-ci',
      fixLabel: 'Generate Node.js CI'
    });
  }

  // 2. EditorConfig
  const hasEditorConfig = rootSet.has('.editorconfig');
  findings.push({
    id: 'editorconfig',
    name: 'EditorConfig (.editorconfig)',
    status: hasEditorConfig ? 'passed' : 'missing',
    description: hasEditorConfig ? '.editorconfig file is present in repository root.' : 'No .editorconfig found to define whitespace and indentation standards.',
    recommendation: hasEditorConfig ? 'Formatting standards are configured.' : 'Generate .editorconfig to ensure uniform indentation across developer environments.',
    canGenerateFix: !hasEditorConfig,
    fixTemplateId: 'editorconfig',
    fixLabel: 'Generate .editorconfig'
  });

  // 3. Prettier
  const prettierVariants = [
    '.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml',
    '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs',
    'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'
  ];
  const hasPrettier = prettierVariants.some((v) => rootSet.has(v));
  findings.push({
    id: 'prettier',
    name: 'Prettier Configuration',
    status: hasPrettier ? 'passed' : 'missing',
    description: hasPrettier ? 'Prettier configuration found in repository root.' : 'No Prettier configuration detected.',
    recommendation: hasPrettier ? 'Prettier code formatting is established.' : 'Generate .prettierrc.json to enforce consistent code style.',
    canGenerateFix: !hasPrettier,
    fixTemplateId: 'prettier',
    fixLabel: 'Generate Prettier config'
  });

  // 4. ESLint
  const eslintVariants = [
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml'
  ];
  const hasEslint = eslintVariants.some((v) => rootSet.has(v));
  findings.push({
    id: 'eslint',
    name: 'ESLint Configuration',
    status: hasEslint ? 'passed' : 'missing',
    description: hasEslint ? 'ESLint configuration detected in repository root.' : 'No ESLint configuration detected.',
    recommendation: hasEslint ? 'Static code quality analysis is active.' : 'Generate modern ESLint flat configuration (eslint.config.js) to catch syntax errors.',
    canGenerateFix: !hasEslint,
    fixTemplateId: 'eslint',
    fixLabel: 'Generate ESLint config'
  });

  // 5. Git Attributes
  const hasGitAttributes = rootSet.has('.gitattributes');
  findings.push({
    id: 'gitattributes',
    name: 'Git Attributes (.gitattributes)',
    status: hasGitAttributes ? 'passed' : 'missing',
    description: hasGitAttributes ? '.gitattributes file found in repository root.' : 'No .gitattributes file found to normalize cross-platform line endings.',
    recommendation: hasGitAttributes ? 'Line ending and binary normalization is active.' : 'Generate .gitattributes to prevent unwanted carriage-return (CRLF) diffs.',
    canGenerateFix: !hasGitAttributes,
    fixTemplateId: 'gitattributes',
    fixLabel: 'Generate .gitattributes'
  });

  // 6. Git Ignore
  const hasGitIgnore = rootSet.has('.gitignore');
  findings.push({
    id: 'gitignore',
    name: 'Git Ignore (.gitignore)',
    status: hasGitIgnore ? 'passed' : 'missing',
    description: hasGitIgnore ? '.gitignore file found in repository root.' : 'No .gitignore file detected. Unversioned files and credentials may be accidentally committed.',
    recommendation: hasGitIgnore ? 'Standard ignore rules are configured.' : 'Generate starter .gitignore to exclude build artifacts and secrets.',
    canGenerateFix: !hasGitIgnore,
    fixTemplateId: 'gitignore',
    fixLabel: 'Generate .gitignore'
  });

  // 7. Workflow Health Summary
  if (workflowFiles.length > 0) {
    const totalFindings = workflowHealthReports.reduce((acc, r) => acc + (r.findings?.length || 0), 0);
    const hasHighCritical = workflowHealthReports.some((r) => r.findings?.some((f) => f.severity === 'critical' || f.severity === 'high'));
    findings.push({
      id: 'workflow-health',
      name: 'Workflow Security & Hygiene',
      status: hasHighCritical ? 'needs_attention' : totalFindings > 0 ? 'warning' : 'passed',
      description: `${workflowFiles.length} workflow file(s) inspected. Found ${totalFindings} potential configuration improvement(s).`,
      recommendation: hasHighCritical ? 'Address high/critical findings such as missing timeouts, unpinned actions, or broad permissions.' : 'Workflows meet security standards.',
      canGenerateFix: false
    });
  } else {
    findings.push({
      id: 'workflow-health',
      name: 'Workflow Security & Hygiene',
      status: 'not_applicable',
      description: 'No existing GitHub Actions workflows to audit.',
      recommendation: 'Generate a CI workflow first.',
      canGenerateFix: false
    });
  }

  // 8. Repository Metadata
  const hasDesc = Boolean(repoMetadata.description);
  const hasTopics = Array.isArray(repoMetadata.topics) && repoMetadata.topics.length > 0;
  findings.push({
    id: 'repo-metadata',
    name: 'Repository Metadata',
    status: hasDesc && hasTopics ? 'passed' : hasDesc || hasTopics ? 'warning' : 'missing',
    description: `Description: ${hasDesc ? 'configured' : 'missing'}, Topics: ${hasTopics ? repoMetadata.topics.join(', ') : 'none'}.`,
    recommendation: hasDesc && hasTopics ? 'Repository discovery metadata is complete.' : 'Add a description and topics in GitHub repository settings to enhance discoverability.',
    canGenerateFix: false
  });

  // Calculate overall setup score (percentage of passed/applicable checks)
  const scorable = findings.filter((f) => f.status !== 'not_applicable');
  const passed = scorable.filter((f) => f.status === 'passed').length;
  const setupScore = scorable.length > 0 ? Math.round((passed / scorable.length) * 100) : 0;

  return {
    findings,
    setupScore,
    totalWorkflows: workflowFiles.length,
    defaultBranch: repoMetadata.default_branch || 'main',
    isArchived: Boolean(repoMetadata.archived),
    primaryLanguage: repoMetadata.language || 'Unknown'
  };
}
