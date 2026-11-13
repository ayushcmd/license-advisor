import path from 'node:path';
import { updateReadmeLicense } from '../../public/js/readme.js';
import { ServiceError } from './licenseService.js';

export async function prepareReadmeUpdate(octokit, { owner, repo, ref, license, licensePath, placement }) {
  if (placement === 'none') return null;
  let file;
  try {
    file = (await octokit.rest.repos.getReadme({ owner, repo, ref })).data;
  } catch (err) {
    if (err.status !== 404) throw new ServiceError(502, `Unable to read repository README: ${err.message}`, 'README_READ_FAILED');
  }
  if (file && (!/\.(md|markdown)$/i.test(file.path || '') || file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || !file.sha)) {
    throw new ServiceError(409, 'README updates require a readable Markdown file. Choose "Do not change README" to continue without editing it.', 'UNSUPPORTED_README');
  }
  const filename = file?.path || 'README.md';
  const original = file ? Buffer.from(file.content, 'base64').toString('utf8') : '';
  const link = path.posix.relative(path.posix.dirname(filename), licensePath);
  const content = updateReadmeLicense(original, license, placement, link);
  return {
    path: filename, sha: file?.sha, content, changed: content !== original,
    // Preserve custom attribution and flag it for review instead of rewriting it.
    reviewExisting: /licen[cs]e|shields\.io\/badge\/licen[cs]e/i.test(original.replace(/<!-- license-advisor:(top|bottom):start -->[\s\S]*?<!-- license-advisor:\1:end -->/g, ''))
  };
}
