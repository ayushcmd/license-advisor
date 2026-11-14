/**
 * Open Workers — Webhook & Action Idempotency
 *
 * Provides markers and guards to prevent duplicate comments, bot reply loops,
 * and repeated automated actions across stateless executions.
 */

export const MARKERS = Object.freeze({
  WELCOME: '<!-- open-workers:welcome -->',
  MANAGED: '<!-- open-workers:managed -->',
  CHECKLIST_REMINDER: '<!-- open-workers:checklist-reminder -->'
});

/**
 * Check if a string contains a specific idempotency marker
 *
 * @param {string} text
 * @param {string} marker
 * @returns {boolean}
 */
export function hasMarker(text, marker) {
  if (typeof text !== 'string' || !marker) return false;
  return text.includes(marker);
}

/**
 * Append an idempotency marker to markdown content
 *
 * @param {string} text
 * @param {string} marker
 * @returns {string}
 */
export function appendMarker(text, marker) {
  const base = typeof text === 'string' ? text.trimEnd() : '';
  if (!marker || hasMarker(base, marker)) return base;
  return `${base}\n\n${marker}`;
}

/**
 * Detect whether a webhook sender is an automated bot account to prevent event loops
 *
 * @param {object} sender
 * @returns {boolean}
 */
export function isBotSender(sender) {
  if (!sender || typeof sender !== 'object') return false;
  if (sender.type === 'Bot') return true;
  const login = String(sender.login || '').toLowerCase();
  if (login.endsWith('[bot]') || login.includes('open-workers') || login === 'open-license-advisor[bot]') {
    return true;
  }
  return false;
}

/**
 * Create a simple in-memory bounded LRU set for tracking delivery IDs
 *
 * @param {number} [maxSize=1000]
 * @returns {{ has: Function, add: Function, size: Function, clear: Function }}
 */
export function createDeliveryTracker(maxSize = 1000) {
  const set = new Set();
  return {
    has(id) {
      return set.has(id);
    },
    add(id) {
      if (set.size >= maxSize) {
        const oldest = set.values().next().value;
        if (oldest !== undefined) set.delete(oldest);
      }
      set.add(id);
    },
    size() {
      return set.size;
    },
    clear() {
      set.clear();
    }
  };
}
