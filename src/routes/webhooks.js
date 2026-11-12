/**
 * GitHub App Webhook Receiver
 *
 * Verifies every incoming delivery with HMAC SHA-256 (`X-Hub-Signature-256`)
 * via `@octokit/webhooks`, ignores duplicate delivery IDs safely in memory,
 * and handles installation and repository lifecycle events without persistence.
 */

import { Router } from 'express';
import { Webhooks } from '@octokit/webhooks';

const DEFAULT_MAX_DELIVERY_CACHE = 1000;

/**
 * Create an Express router for `/api/webhooks`.
 * Expects raw unparsed body middleware (`express.raw`) mounted ahead of it.
 *
 * @param {object} options
 * @param {string|null} options.webhookSecret
 * @param {object} [options.logger]
 * @param {number} [options.maxDeliveryCache]
 * @param {Function} [options.onEvent]
 * @returns {Router}
 */
export function createWebhookRouter({
  webhookSecret,
  logger = console,
  maxDeliveryCache = DEFAULT_MAX_DELIVERY_CACHE,
  onEvent
} = {}) {
  const router = Router();
  const seenDeliveries = new Set();

  const webhooks = webhookSecret ? new Webhooks({ secret: webhookSecret }) : null;

  if (webhooks) {
    const recordEvent = async (eventName, summary) => {
      logger.info(`[webhook] Processed ${eventName}`, summary);
      if (typeof onEvent === 'function') {
        await onEvent(eventName, summary);
      }
    };

    webhooks.on('ping', async ({ payload }) => {
      await recordEvent('ping', {
        hookId: payload.hook_id || null,
        zen: payload.zen || ''
      });
    });

    webhooks.on('installation', async ({ payload }) => {
      await recordEvent('installation', {
        action: payload.action,
        installationId: payload.installation?.id || null,
        account: payload.installation?.account?.login || null,
        repositoryCount: Array.isArray(payload.repositories) ? payload.repositories.length : null
      });
    });

    webhooks.on('installation_repositories', async ({ payload }) => {
      await recordEvent('installation_repositories', {
        action: payload.action,
        installationId: payload.installation?.id || null,
        addedCount: Array.isArray(payload.repositories_added) ? payload.repositories_added.length : 0,
        removedCount: Array.isArray(payload.repositories_removed) ? payload.repositories_removed.length : 0
      });
    });

    webhooks.on('repository', async ({ payload }) => {
      await recordEvent('repository', {
        action: payload.action,
        repository: payload.repository?.full_name || null,
        installationId: payload.installation?.id || null
      });
    });

    webhooks.onError((err) => {
      logger.error('[webhook] Event handler error:', err.message);
    });
  }

  function rememberDelivery(deliveryId) {
    if (seenDeliveries.size >= maxDeliveryCache) {
      const oldest = seenDeliveries.values().next().value;
      if (oldest !== undefined) seenDeliveries.delete(oldest);
    }
    seenDeliveries.add(deliveryId);
  }

  router.post('/', async (req, res) => {
    if (!webhooks) {
      return res.status(503).json({
        error: 'Webhook receiver is unavailable because GITHUB_WEBHOOK_SECRET is not configured.'
      });
    }

    const signature = req.get('x-hub-signature-256');
    const eventName = req.get('x-github-event');
    const deliveryId = req.get('x-github-delivery');

    if (!signature) {
      return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header.' });
    }

    if (!eventName || !deliveryId) {
      return res.status(400).json({ error: 'Missing required X-GitHub-Event or X-GitHub-Delivery header.' });
    }

    const rawPayload = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : null;

    if (rawPayload === null || rawPayload.length === 0) {
      return res.status(400).json({ error: 'Raw webhook request body is required.' });
    }

    const isValidSignature = await webhooks.verify(rawPayload, signature);
    if (!isValidSignature) {
      logger.warn(`[webhook] Rejected invalid signature for delivery ${deliveryId}`);
      return res.status(401).json({ error: 'Invalid webhook HMAC signature.' });
    }

    // Deduplicate only AFTER signature verification so unauthenticated requests cannot poison IDs
    if (seenDeliveries.has(deliveryId)) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        deliveryId,
        event: eventName
      });
    }

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch {
      return res.status(400).json({ error: 'Webhook payload must be valid JSON.' });
    }

    rememberDelivery(deliveryId);

    await webhooks.receive({
      id: deliveryId,
      name: eventName,
      payload: parsedPayload
    });

    return res.status(200).json({
      ok: true,
      duplicate: false,
      deliveryId,
      event: eventName,
      action: parsedPayload?.action || null
    });
  });

  return router;
}

