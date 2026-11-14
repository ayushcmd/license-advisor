/**
 * Open Workers — Shared Frontend UI Utilities
 *
 * Reusable, framework-free helpers for DOM escaping, URL sanitization,
 * safe element creation, clipboard interaction, file downloads, loading states,
 * and accessible announcements.
 *
 * Zero credential storage: never reads or writes to localStorage/sessionStorage.
 */

/**
 * Escapes HTML characters to prevent XSS injection.
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes a URL, allowing only safe relative paths or http/https URLs.
 * Rejects javascript:, data:, vbscript: and malformed protocols.
 * @param {string} url
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeUrl(url, fallback = '#') {
  if (typeof url !== 'string' || !url.trim()) return fallback;
  const trimmed = url.trim();

  // Block obvious dangerous schemes immediately
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) {
    return fallback;
  }

  // Safe relative paths: /path, ./path, #anchor, or ?query
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('?')
  ) {
    return trimmed;
  }

  try {
    const base = typeof window !== 'undefined' && window?.location?.origin
      ? window.location.origin
      : 'https://open-workers.onrender.com';
    const parsed = new URL(trimmed, base);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

/**
 * Safe DOM element builder that avoids innerHTML interpolation.
 * @param {string} tag
 * @param {Record<string, unknown>} props
 * @param {Array<Node | string | number | null | undefined> | Node | string | number} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  if (typeof document === 'undefined') {
    throw new Error('el() requires a DOM environment');
  }
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'className') {
      element.className = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(element.dataset, value);
    } else if (key === 'hidden' || key === 'disabled' || key === 'checked' || key === 'required') {
      if (value) element.setAttribute(key, '');
      else element.removeAttribute(key);
    } else {
      element.setAttribute(key, String(value));
    }
  }

  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  }

  return element;
}

/**
 * Fallback text copy using hidden textarea when Clipboard API is unavailable.
 * @param {string} text
 * @returns {boolean}
 */
function fallbackCopyText(text) {
  if (typeof document === 'undefined') return false;
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.setAttribute('aria-hidden', 'true');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}

/**
 * Copies text to the clipboard with modern API and legacy fallback.
 * @param {string} text
 * @param {HTMLElement|null} buttonOrEl
 * @param {string} successLabel
 * @param {HTMLElement|null} feedbackEl
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(
  text,
  buttonOrEl = null,
  successLabel = 'Copied!',
  feedbackEl = null
) {
  let succeeded = false;

  try {
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      succeeded = true;
    } else {
      succeeded = fallbackCopyText(text);
    }
  } catch {
    succeeded = fallbackCopyText(text);
  }

  if (succeeded) {
    if (buttonOrEl) {
      const originalText = buttonOrEl.textContent;
      buttonOrEl.textContent = successLabel;
      setTimeout(() => {
        if (buttonOrEl.textContent === successLabel) {
          buttonOrEl.textContent = originalText;
        }
      }, 2000);
    }
    if (feedbackEl) {
      feedbackEl.textContent = successLabel;
      feedbackEl.setAttribute('role', 'status');
    }
  }

  return succeeded;
}

/**
 * Triggers a browser download of text/blob content.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadBlob(content, filename, mimeType = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split('/').pop() || filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Manages button loading state and aria-busy attribute.
 * @param {HTMLButtonElement|HTMLElement|null} button
 * @param {boolean} isLoading
 * @param {string} loadingText
 * @param {string|null} defaultText
 * @param {HTMLElement|null} spinnerEl
 */
export function setButtonLoading(
  button,
  isLoading,
  loadingText = 'Loading...',
  defaultText = null,
  spinnerEl = null
) {
  if (!button) return;
  button.disabled = isLoading;
  button.setAttribute('aria-busy', String(isLoading));

  if (isLoading) {
    if (!button.dataset.defaultText && defaultText) {
      button.dataset.defaultText = defaultText;
    } else if (!button.dataset.defaultText) {
      button.dataset.defaultText = button.textContent || '';
    }
    if (loadingText) button.textContent = loadingText;
    if (spinnerEl) spinnerEl.style.display = 'inline-block';
  } else {
    if (button.dataset.defaultText) {
      button.textContent = button.dataset.defaultText;
    }
    if (spinnerEl) spinnerEl.style.display = 'none';
  }
}

/**
 * Renders an accessible flash banner message.
 * @param {HTMLElement|null} container
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 */
export function showBanner(container, message, type = 'info') {
  if (!container || typeof document === 'undefined') return;
  container.innerHTML = '';

  const alertClass =
    type === 'error'
      ? 'banner-error'
      : type === 'warning'
        ? 'banner-warning'
        : type === 'success'
          ? 'banner-success'
          : 'banner-info';

  const role = type === 'error' ? 'alert' : 'status';
  const div = document.createElement('div');
  div.className = `flash ${alertClass}`;
  div.style.marginTop = 'var(--space-3)';
  div.setAttribute('role', role);
  div.textContent = message;
  container.appendChild(div);
}

/**
 * Extracts a query parameter safely.
 * @param {string} name
 * @param {string|null} urlString
 * @returns {string|null}
 */
export function getQueryParam(name, urlString = null) {
  try {
    const search = urlString
      ? new URL(urlString).search
      : typeof window !== 'undefined'
        ? window.location.search
        : '';
    const params = new URLSearchParams(search);
    return params.get(name);
  } catch {
    return null;
  }
}

/**
 * Client-side validation for GitHub repository input (owner/repo).
 * @param {string} rawInput
 * @returns {{ owner: string, repo: string, fullName: string }}
 */
export function parseRepoInput(rawInput) {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    throw new Error('Enter a GitHub repository in "owner/repo" format or a https://github.com/owner/repo URL.');
  }

  let cleaned = rawInput.trim();

  // Support git@github.com:owner/repo.git
  const sshMatch = cleaned.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    cleaned = `${sshMatch[1]}/${sshMatch[2]}`;
  } else if (/^https?:\/\//i.test(cleaned)) {
    let url;
    try {
      url = new URL(cleaned);
    } catch {
      throw new Error('Invalid repository URL.');
    }
    if (url.hostname.toLowerCase() !== 'github.com' && url.hostname.toLowerCase() !== 'www.github.com') {
      throw new Error('Only github.com repositories are supported.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error('GitHub URL must include both owner and repository name (e.g., https://github.com/owner/repo).');
    }
    cleaned = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
  }

  const segments = cleaned.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (segments.length !== 2) {
    throw new Error('Repository must be specified as "owner/repo" (for example, "expressjs/express").');
  }

  const [owner, repo] = segments;
  const OWNER_REPO_SEGMENT = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])|_(?=[a-z\d])|\.(?=[a-z\d])){0,99}$/i;
  if (
    !OWNER_REPO_SEGMENT.test(owner) ||
    !OWNER_REPO_SEGMENT.test(repo) ||
    owner === '.' ||
    owner === '..' ||
    repo === '.' ||
    repo === '..'
  ) {
    throw new Error('Repository owner or name contains unsupported characters.');
  }

  return { owner, repo, fullName: `${owner}/${repo}` };
}
