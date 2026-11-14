/**
 * Open Workers — Event Dispatcher
 *
 * Routes verified GitHub webhook events to registered module automation handlers
 * with error isolation, bounded execution, and execution summaries.
 */

export class EventDispatcher {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.handlers = new Map();
  }

  /**
   * Register a handler for a webhook event or event.action
   *
   * @param {string} eventName e.g. 'issues', 'pull_request', 'issues.opened'
   * @param {Function} handler async (payload, context) => result
   */
  register(eventName, handler) {
    if (typeof eventName !== 'string' || typeof handler !== 'function') {
      throw new TypeError('eventName must be a string and handler must be a function.');
    }
    const key = eventName.toLowerCase().trim();
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    this.handlers.get(key).push(handler);
  }

  /**
   * Dispatch a verified webhook event to all matching handlers
   *
   * @param {object} params
   * @param {string} params.name Event name e.g. 'issues', 'pull_request'
   * @param {object} params.payload
   * @param {object} [params.context]
   * @returns {Promise<{ event: string, action: string|null, handled: boolean, results: Array<object> }>}
   */
  async dispatch({ name, payload, context = {} }) {
    const event = String(name || '').toLowerCase().trim();
    const action = payload?.action ? String(payload.action).toLowerCase().trim() : null;
    const compoundKey = action ? `${event}.${action}` : null;

    const matchedHandlers = [
      ...(this.handlers.get(event) || []),
      ...(compoundKey ? (this.handlers.get(compoundKey) || []) : [])
    ];

    if (matchedHandlers.length === 0) {
      return {
        event,
        action,
        handled: false,
        results: []
      };
    }

    const results = [];
    for (const handler of matchedHandlers) {
      try {
        const result = await handler(payload, context);
        results.push({ success: true, result });
      } catch (err) {
        this.logger.error(`[event-dispatcher] Handler error on "${compoundKey || event}":`, err.message);
        results.push({
          success: false,
          error: err.message,
          code: err.code || 'HANDLER_ERROR'
        });
      }
    }

    return {
      event,
      action,
      handled: true,
      handledCount: matchedHandlers.length,
      results
    };
  }
}

/**
 * Singleton or factory dispatcher instance
 */
export function createDispatcher(options) {
  return new EventDispatcher(options);
}
