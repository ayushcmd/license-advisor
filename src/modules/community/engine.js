import { readFileSync } from 'node:fs';
import { ServiceError } from '../../services/licenseService.js';

const covenant = readFileSync(new URL('./templates/contributor-covenant-3.0.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const field = (id, label, type = 'text', required = false, defaultValue = '') => ({ id, label, type, required, defaultValue, maxLength: type === 'textarea' ? 6000 : 500 });
const project = field('projectName', 'Project name', 'text', true);
const section = (heading, value) => value ? `## ${heading}\n\n${value}\n\n` : '';
export function escapeMarkdown(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
}
const definitions = [
  { id: 'contributing', name: 'Contribution Guidelines', filename: 'CONTRIBUTING.md', version: '1.0', fields: [project,
    field('projectDescription', 'Project description', 'textarea'), field('repositoryUrl', 'Repository URL', 'url'),
    field('prerequisites', 'Development prerequisites', 'textarea'), field('setup', 'Local setup instructions', 'textarea'),
    field('testing', 'Testing instructions', 'textarea'), field('workflow', 'Contribution workflow', 'textarea', false, 'Discuss substantial changes before starting. Keep contributions focused and explain how they were tested.'),
    field('branchConvention', 'Branch naming convention'), field('commitConvention', 'Commit message convention'),
    field('pullRequests', 'Pull request guidelines', 'textarea', false, 'Describe the change, link related issues, and include relevant tests.'),
    field('issues', 'Issue reporting guidelines', 'textarea', false, 'Search existing issues first. Include reproduction steps and expected behavior. Report vulnerabilities privately.'),
    field('community', 'Community communication guidelines', 'textarea', false, 'Be respectful, constructive, and welcoming.')],
    render: (v) => `# Contributing to ${v.projectName}\n\nThank you for contributing.\n\n` + section('About the Project', v.projectDescription) + section('Ways to Contribute', 'Report bugs, improve documentation, review changes, or propose focused improvements.') + section('Getting Started', v.repositoryUrl ? `[Project repository](<${v.repositoryUrl}>)` : '') + section('Development Prerequisites', v.prerequisites) + section('Development Setup', v.setup) + section('Testing', v.testing) + section('Contribution Workflow', v.workflow) + section('Branch Naming', v.branchConvention) + section('Commit Messages', v.commitConvention) + section('Reporting Issues', v.issues) + section('Submitting Pull Requests', v.pullRequests) + section('Community Guidelines', v.community)
  },
  { id: 'code-of-conduct', name: 'Code of Conduct', filename: 'CODE_OF_CONDUCT.md', version: 'Contributor Covenant 3.0', fields: [field('communityName', 'Community name', 'text', true), field('maintainerContact', 'Maintainer contact'), field('enforcementContact', 'Private enforcement contact (required)', 'text', true), field('reportingInstructions', 'Reporting instructions', 'textarea', false, 'Contact the enforcement team privately. Include relevant context and evidence.')],
    render: (v) => `# ${v.communityName} Community\n\n` + section('Community Contacts', v.maintainerContact) + section('Reporting Instructions', v.reportingInstructions) + covenant.replace('**[NOTE: describe your means of reporting here.]**', () => `contact ${v.enforcementContact} privately.`).replace(/\*\*\[NOTE: The remedies[^\n]+\*\*\n/, '').trim() + '\n\nThis document uses Contributor Covenant 3.0, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This adaptation uses the same CC BY-SA 4.0 license. Changes: community name, contacts, reporting instructions, and removal of the editorial enforcement note.\n'
  },
  { id: 'security', name: 'Security Policy', filename: 'SECURITY.md', version: '1.0', fields: [project, field('supportedVersions', 'Supported versions', 'textarea', true), field('reportingContact', 'Private vulnerability reporting contact', 'text', true), field('reportingInstructions', 'Private reporting instructions', 'textarea', false, 'Send details privately, including affected versions, impact, and reproduction steps. Do not open a public issue for an undisclosed vulnerability.'), field('responsePolicy', 'Expected response policy', 'textarea'), field('disclosurePolicy', 'Disclosure policy', 'textarea', false, 'Coordinate disclosure with the maintainers so users have an opportunity to update.'), field('updateProcess', 'Security update process', 'textarea')],
    render: (v) => `# Security Policy for ${v.projectName}\n\n` + section('Supported Versions', v.supportedVersions) + section('Reporting a Vulnerability', `Report vulnerabilities privately to: ${v.reportingContact}\n\n${v.reportingInstructions}\n\nDo not disclose vulnerabilities in public issues.`) + section('Response Policy', v.responsePolicy) + section('Coordinated Disclosure', v.disclosurePolicy) + section('Security Updates', v.updateProcess)
  },
  { id: 'support', name: 'Support Guidelines', filename: 'SUPPORT.md', version: '1.0', fields: [project, field('channels', 'Support channels', 'textarea'), field('discussionsUrl', 'GitHub Discussions URL', 'url'), field('issuesUrl', 'Issue tracker URL', 'url'), field('documentationUrl', 'Documentation URL', 'url'), field('contact', 'Contact details'), field('questionsVsBugs', 'Questions versus bug reports', 'textarea', false, 'Use support channels for questions. Use the issue tracker for reproducible bugs. Send vulnerability reports privately using the security policy.'), field('responseGuidelines', 'Expected response guidelines', 'textarea')],
    render: (v) => `# Support for ${v.projectName}\n\n` + section('Support Channels', v.channels) + section('Discussions', v.discussionsUrl ? `[Ask a question](<${v.discussionsUrl}>)` : '') + section('Issue Tracker', v.issuesUrl ? `[Report a bug](<${v.issuesUrl}>)` : '') + section('Documentation', v.documentationUrl ? `[Read the documentation](<${v.documentationUrl}>)` : '') + section('Contact', v.contact) + section('Questions and Bug Reports', v.questionsVsBugs) + section('Response Expectations', v.responseGuidelines)
  }
];

export function listTemplates() {
  return definitions.map(({ render: _render, ...metadata }) => structuredClone(metadata));
}

function invalid(message, fieldId) { throw new ServiceError(400, message, 'INVALID_INPUT', fieldId ? { field: fieldId } : undefined); }
export function generateDocument(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('A JSON object is required.');
  if (Object.keys(input).some((key) => !['templateId', 'options'].includes(key))) invalid('Unknown request field.');
  const template = definitions.find((entry) => entry.id === input.templateId);
  if (!template) throw new ServiceError(400, 'Choose an available template.', 'UNKNOWN_TEMPLATE');
  const options = input.options === undefined ? {} : input.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('options must be an object.');
  if (Object.keys(options).some((key) => !template.fields.some((entry) => entry.id === key))) invalid('Unknown template option.');
  const values = {};
  for (const schema of template.fields) {
    const raw = Object.hasOwn(options, schema.id) ? options[schema.id] : schema.defaultValue;
    if (typeof raw !== 'string' || raw.length > schema.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) invalid(`${schema.label} must be text of at most ${schema.maxLength} characters.`, schema.id);
    const value = raw.trim().replace(/\r\n?/g, '\n');
    if (schema.required && !value) invalid(`${schema.label} is required.`, schema.id);
    if (schema.type !== 'textarea' && /\n/.test(value)) invalid(`${schema.label} must be a single line.`, schema.id);
    if (schema.type === 'url' && value) {
      let url;
      try { url = new URL(value); } catch { invalid(`${schema.label} must be a valid HTTP or HTTPS URL.`, schema.id); }
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\s<>\\]/.test(value)) invalid(`${schema.label} must be an HTTP or HTTPS URL without credentials.`, schema.id);
      values[schema.id] = url.href.replace(/[<>]/g, (char) => encodeURIComponent(char));
    } else values[schema.id] = escapeMarkdown(value);
  }
  return { filename: template.filename, content: template.render(values).trim() + '\n', templateId: template.id };
}
