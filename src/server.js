/**
 * Express Application Entry Point
 *
 * Serves static vanilla HTML/CSS/ES6 assets from `public/`, mounts raw body
 * HMAC verification on `/api/webhooks` before JSON parsing, and exposes
 * stateless REST API endpoints under `/api`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { createGitHubContext } from './config/github.js';
import { createApiRouter } from './routes/api.js';
import { createWebhookRouter } from './routes/webhooks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function parseAllowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS || env.APP_URL || 'http://localhost:3000';
  return new Set(
    raw
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

/**
 * Construct and configure the Express application instance without binding a port.
 *
 * @param {object} [options]
 * @returns {{ app: import('express').Express, githubContext: object }}
 */
export function createApp(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const githubContext = options.githubContext || createGitHubContext(env, {
    logger,
    silent: Boolean(options.silentConfig)
  });

  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://api.github.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  const allowedOrigins = parseAllowedOrigins(env);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ''))) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'OPTIONS']
    })
  );

  // Raw unparsed body MUST run before express.json() for accurate HMAC SHA-256 verification
  app.use(
    '/api/webhooks',
    express.raw({ type: '*/*', limit: '1mb' }),
    createWebhookRouter({
      webhookSecret: githubContext.webhookSecret,
      logger,
      maxDeliveryCache: options.maxDeliveryCache,
      onEvent: options.onWebhookEvent
    })
  );

  app.use(express.json({ limit: '256kb' }));
  app.use('/api', createApiRouter({ githubContext, env, createUserClient: options.createUserClient }));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err, req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Malformed JSON request body.', code: 'INVALID_JSON' });
    }
    const status = typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) {
      logger.error('[server] Unhandled error:', err.message);
    }
    if (req.path.startsWith('/api')) {
      return res.status(status).json({
        error: status >= 500 ? 'Internal server error.' : err.message
      });
    }
    return res.status(status).send(status >= 500 ? 'Internal server error.' : err.message);
  });

  return { app, githubContext };
}

/**
 * Load `.env` configuration and start the HTTP server.
 */
export function startServer() {
  dotenv.config({ quiet: true });
  const port = Number(process.env.PORT) || 3000;
  const { app, githubContext } = createApp({ env: process.env });

  const server = app.listen(port, () => {
    console.log(`[server] Open Workers listening on http://localhost:${port}`);
    console.log(`[server] Static dir: ${PUBLIC_DIR}`);
    console.log(`[server] GitHub App configured: ${githubContext.isAppConfigured}`);
  });

  return server;
}

const isMainModule = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  startServer();
}

