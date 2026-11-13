// Shared by Express and the browser. Planned modules have no operational links.
export const CAPABILITIES = Object.freeze([
  { id: 'licensing', name: 'Licensing', description: 'Choose, compare, and apply an open-source license.', category: 'repository', status: 'available', operations: ['explore', 'recommend', 'compare', 'analyze', 'generate', 'create-pr'], permissions: { contents: 'write', pull_requests: 'write' }, routes: { page: '/explorer.html', api: '/api/recommend' } },
  { id: 'community', name: 'Community', description: 'Generate contribution, conduct, security, and support documents.', category: 'repository', status: 'available', operations: ['preview', 'copy', 'download'], permissions: {}, routes: { page: '/community.html', api: '/api/community/templates' } },
  { id: 'security', name: 'Security', description: 'Repository security checks and guidance. Policy generation is available in Community.', category: 'repository', status: 'upcoming', operations: [], permissions: {}, routes: {} },
  { id: 'documentation', name: 'Documentation', description: 'Tools to improve and maintain project documentation.', category: 'repository', status: 'upcoming', operations: [], permissions: {}, routes: {} },
  { id: 'issues', name: 'PR & Issue Management', description: 'Organize incoming issues and pull requests.', category: 'workflow', status: 'upcoming', operations: [], permissions: {}, routes: {} },
  { id: 'automation', name: 'Repository Automation', description: 'Repeatable repository maintenance workflows.', category: 'workflow', status: 'upcoming', operations: [], permissions: {}, routes: {} }
].map((entry) => Object.freeze({ ...entry, operations: Object.freeze(entry.operations), permissions: Object.freeze(entry.permissions), routes: Object.freeze(entry.routes) })));

export function getCapability(id) {
  return CAPABILITIES.find((entry) => entry.id === id) || null;
}
