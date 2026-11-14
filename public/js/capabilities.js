// Shared by Express and the browser. Planned modules have no operational links.
export const CAPABILITIES = Object.freeze([
  { id: 'licensing', name: 'Licensing', description: 'Choose, compare, and apply an open-source license.', category: 'repository', status: 'available', operations: ['explore', 'recommend', 'compare', 'analyze', 'generate', 'create-pr'], permissions: { contents: 'write', pull_requests: 'write' }, routes: { page: '/explorer.html', api: '/api/recommend' } },
  { id: 'community', name: 'Community', description: 'Generate community guidelines, conduct, security policies, support documents, issue templates, and automated community PRs.', category: 'repository', status: 'available', operations: ['preview', 'copy', 'download', 'analyze', 'create-pr'], permissions: { contents: 'write', pull_requests: 'write' }, routes: { page: '/community.html', api: '/api/community/templates' } },
  { id: 'security', name: 'Security', description: 'Inspect repository security configurations, generate Dependabot and CodeQL configs, and open security pull requests.', category: 'repository', status: 'available', operations: ['analyze', 'generate', 'preview', 'copy', 'download', 'create-pr'], permissions: { contents: 'write', pull_requests: 'write' }, routes: { page: '/security.html', api: '/api/security/checks' } },
  { id: 'documentation', name: 'Documentation', description: 'Analyze README completeness, generate changelogs and status badges, inspect Markdown links, and open documentation pull requests.', category: 'repository', status: 'available', operations: ['analyze', 'generate', 'check-links', 'preview', 'copy', 'download', 'create-pr'], permissions: { contents: 'write', pull_requests: 'write' }, routes: { page: '/documentation.html', api: '/api/documentation/checks' } },
  { id: 'issues', name: 'PR & Issue Management', description: 'Organize incoming issues and pull requests.', category: 'workflow', status: 'upcoming', operations: [], permissions: {}, routes: {} },
  { id: 'automation', name: 'Repository Automation', description: 'Repeatable repository maintenance workflows.', category: 'workflow', status: 'upcoming', operations: [], permissions: {}, routes: {} }
].map((entry) => Object.freeze({ ...entry, operations: Object.freeze(entry.operations), permissions: Object.freeze(entry.permissions), routes: Object.freeze(entry.routes) })));

export function getCapability(id) {
  return CAPABILITIES.find((entry) => entry.id === id) || null;
}
