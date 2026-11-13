/** Small, repeatable README additions; existing author-written text is preserved. */
export const README_PLACEMENTS = ['none', 'top', 'bottom', 'both'];

export function licenseReadmeSnippets(license, licenseLink = 'LICENSE') {
  const link = licenseLink.split('/').map((part) => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
  const badgeId = encodeURIComponent(license.id.replace(/-/g, '--').replace(/_/g, '__'));
  return {
    top: `[![License: ${license.id}](https://img.shields.io/badge/License-${badgeId}-blue.svg)](${link})`,
    bottom: `## License\n\n${license.id === 'Unlicense' ? 'Released into the public domain under' : 'Licensed under'} [${license.name}](${link}).`
  };
}

export function updateReadmeLicense(content, license, placement, licenseLink = 'LICENSE') {
  if (!README_PLACEMENTS.includes(placement)) throw new Error('Invalid README placement.');
  if (placement === 'none') return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  let result = content.replace(/<!-- license-advisor:(top|bottom):start -->[\s\S]*?<!-- license-advisor:\1:end -->(?:\r?\n){0,2}/g, '');
  const snippets = licenseReadmeSnippets(license, licenseLink);
  const block = (position) => `<!-- license-advisor:${position}:start -->\n${snippets[position]}\n<!-- license-advisor:${position}:end -->`.replace(/\n/g, newline);
  if (placement === 'top' || placement === 'both') {
    // Keep YAML front matter at the beginning of the file.
    const frontMatter = result.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/)?.[0] || '';
    const prefix = frontMatter || (result.startsWith('\uFEFF') ? '\uFEFF' : '');
    result = prefix + (prefix && !prefix.endsWith('\n') && prefix !== '\uFEFF' ? newline : '') + block('top') + newline + newline + result.slice(prefix.length);
  }
  if (placement === 'bottom' || placement === 'both') {
    result += (result && !result.endsWith(newline + newline) ? (result.endsWith(newline) ? newline : newline + newline) : '') + block('bottom') + newline;
  }
  return result;
}
