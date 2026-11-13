import { CAPABILITIES } from './capabilities.js';
const grid = document.getElementById('capability-grid');
for (const capability of CAPABILITIES) {
  const card = document.createElement('article'); card.className = 'card';
  const status = document.createElement('span'); status.className = 'eyebrow'; status.textContent = capability.status === 'available' ? 'Available' : 'Upcoming';
  const heading = document.createElement('h2'); heading.textContent = capability.name;
  const description = document.createElement('p'); description.textContent = capability.description;
  card.append(status, heading, description);
  if (capability.routes.page) {
    const link = document.createElement('a'); link.href = capability.routes.page; link.textContent = `Explore ${capability.name.toLowerCase()}`; card.append(link);
  }
  grid.append(card);
}
