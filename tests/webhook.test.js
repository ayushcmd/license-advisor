import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGitHubContext, loadPrivateKey } from '../src/config/github.js';
import { createApp } from '../src/server.js';

const WEBHOOK_SECRET = 'test-webhook-secret-value-12345';

function signPayload(rawBody, secret = WEBHOOK_SECRET) {
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

async function startTestServer(options = {}) {
  const { app, githubContext } = createApp({
    silentConfig: true,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    ...options
  });

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return { server, baseUrl, app, githubContext };
}

describe('GitHub App Credential Loading & Graceful Fallback', () => {
  it('degrades gracefully when credentials are omitted during local development', () => {
    const ctx = createGitHubContext({}, { silent: true });
    assert.equal(ctx.isAppConfigured, false);
    assert.equal(ctx.isWebhookConfigured, false);
    assert.equal(ctx.app, null);
    assert.ok(ctx.warnings.length >= 2);
  });

  it('loads inline PEM private keys (with escaped newlines) and PEM files safely', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });

    const escaped = privateKey.replace(/\n/g, '\\n');
    const envCtx = createGitHubContext(
      {
        GITHUB_APP_ID: '98765',
        GITHUB_APP_SLUG: 'demo-license-advisor',
        GITHUB_PRIVATE_KEY: escaped,
        GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET
      },
      { silent: true }
    );

    assert.equal(envCtx.isAppConfigured, true);
    assert.equal(envCtx.isWebhookConfigured, true);
    assert.equal(envCtx.keySource, 'env');
    assert.equal(envCtx.getInstallationUrl(), 'https://github.com/apps/demo-license-advisor/installations/new');

    const tmpPem = path.join(os.tmpdir(), `test-gh-app-${Date.now()}.pem`);
    fs.writeFileSync(tmpPem, privateKey, 'utf8');
    try {
      const fileResult = loadPrivateKey({ privateKeyPath: tmpPem });
      assert.ok(fileResult.key);
      assert.equal(fileResult.source, 'file');
    } finally {
      fs.unlinkSync(tmpPem);
    }

    const badPem = loadPrivateKey({ privateKey: 'not-a-valid-pem' });
    assert.equal(badPem.key, null);
    assert.match(badPem.warning, /valid PEM/);
  });
});

describe('Express Server, Security Headers, Static Assets & Public API', () => {
  let activeServer = null;

  afterEach(async () => {
    if (activeServer) {
      await new Promise((resolve) => activeServer.close(resolve));
      activeServer = null;
    }
  });

  it('serves static frontend with Helmet CSP and exposes /api/health and /api/config without secrets', async () => {
    const started = await startTestServer({
      env: {
        APP_URL: 'http://localhost:3000',
        GITHUB_APP_SLUG: 'license-advisor',
        GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET
      }
    });
    activeServer = started.server;

    const indexRes = await fetch(`${started.baseUrl}/`);
    assert.equal(indexRes.status, 200);
    const csp = indexRes.headers.get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy header must be present');
    assert.ok(csp.includes("script-src 'self'"));
    assert.ok(csp.includes('https://api.github.com'));
    assert.equal(indexRes.headers.get('x-powered-by'), null);
    const html = await indexRes.text();
    assert.ok(html.includes('GitHub License Advisor'));

    const healthRes = await fetch(`${started.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.mode, 'database-free');
    assert.equal(health.catalogCount, 12);
    assert.equal(health.webhookConfigured, true);

    const configRes = await fetch(`${started.baseUrl}/api/config`);
    assert.equal(configRes.status, 200);
    const config = await configRes.json();
    assert.equal(config.planTier, 'free');
    assert.equal(config.supportedPermissions.metadata, 'read');
    assert.equal(config.supportedPermissions.contents, 'write');
    assert.equal(config.supportedPermissions.pull_requests, 'write');
    assert.equal(JSON.stringify(config).includes(WEBHOOK_SECRET), false);

    const notFoundRes = await fetch(`${started.baseUrl}/api/unknown-endpoint`);
    assert.equal(notFoundRes.status, 404);
  });
});

describe('Webhook HMAC SHA-256 Verification & Duplicate Delivery Protection', () => {
  let activeServer = null;

  afterEach(async () => {
    if (activeServer) {
      await new Promise((resolve) => activeServer.close(resolve));
      activeServer = null;
    }
  });

  it('accepts valid HMAC SHA-256 signatures and preserves exact raw formatting', async () => {
    const receivedEvents = [];
    const started = await startTestServer({
      env: { GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET },
      onWebhookEvent: (name, summary) => {
        receivedEvents.push({ name, summary });
      }
    });
    activeServer = started.server;

    // Non-minified JSON spacing tests that raw body bytes are hashed before any JSON parsing
    const rawBody = '{\n  "action":   "created",\n  "installation": { "id": 42, "account": { "login": "ayushcmd" } },\n  "repositories": [{ "full_name": "ayushcmd/demo" }]\n}';
    const signature = signPayload(rawBody);

    const res = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'installation',
        'X-GitHub-Delivery': 'delivery-001',
        'X-Hub-Signature-256': signature
      },
      body: rawBody
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      ok: true,
      duplicate: false,
      deliveryId: 'delivery-001',
      event: 'installation',
      action: 'created'
    });
    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].name, 'installation');
    assert.equal(receivedEvents[0].summary.installationId, 42);
  });

  it('rejects missing or tampered HMAC signatures with HTTP 401 and missing headers with HTTP 400', async () => {
    const receivedEvents = [];
    const started = await startTestServer({
      env: { GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET },
      onWebhookEvent: (name) => receivedEvents.push(name)
    });
    activeServer = started.server;

    const payload = JSON.stringify({ action: 'added', installation: { id: 7 }, repositories_added: [] });

    // Missing signature header
    const missingSigRes = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'installation_repositories',
        'X-GitHub-Delivery': 'delivery-missing-sig'
      },
      body: payload
    });
    assert.equal(missingSigRes.status, 401);

    // Invalid signature
    const badSigRes = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'installation_repositories',
        'X-GitHub-Delivery': 'delivery-bad-sig',
        'X-Hub-Signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
      },
      body: payload
    });
    assert.equal(badSigRes.status, 401);

    // Tampered payload after signing
    const validSigForOriginal = signPayload(payload);
    const tamperedRes = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'installation_repositories',
        'X-GitHub-Delivery': 'delivery-tampered',
        'X-Hub-Signature-256': validSigForOriginal
      },
      body: payload.replace('added', 'removed')
    });
    assert.equal(tamperedRes.status, 401);

    // Missing X-GitHub-Delivery header
    const missingDeliveryRes = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'repository',
        'X-Hub-Signature-256': validSigForOriginal
      },
      body: payload
    });
    assert.equal(missingDeliveryRes.status, 400);

    assert.equal(receivedEvents.length, 0);
  });

  it('deduplicates repeated X-GitHub-Delivery deliveries safely without re-triggering handlers', async () => {
    const receivedEvents = [];
    const started = await startTestServer({
      env: { GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET },
      onWebhookEvent: (name, summary) => receivedEvents.push({ name, summary })
    });
    activeServer = started.server;

    const payload = JSON.stringify({
      action: 'created',
      repository: { full_name: 'ayushcmd/license-advisor' },
      installation: { id: 99 }
    });
    const signature = signPayload(payload);

    const headers = {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'repository',
      'X-GitHub-Delivery': 'delivery-repeat-01',
      'X-Hub-Signature-256': signature
    };

    const firstRes = await fetch(`${started.baseUrl}/api/webhooks`, { method: 'POST', headers, body: payload });
    assert.equal(firstRes.status, 200);
    const firstJson = await firstRes.json();
    assert.equal(firstJson.duplicate, false);

    // Forged invalid-signature request using the same delivery ID must still return 401
    const forgedRepeat = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { ...headers, 'X-Hub-Signature-256': 'sha256=deadbeef' },
      body: payload
    });
    assert.equal(forgedRepeat.status, 401);

    // Authentic GitHub retry with same delivery ID returns 200 duplicate: true without re-running handler
    const retryRes = await fetch(`${started.baseUrl}/api/webhooks`, { method: 'POST', headers, body: payload });
    assert.equal(retryRes.status, 200);
    const retryJson = await retryRes.json();
    assert.equal(retryJson.duplicate, true);
    assert.equal(receivedEvents.length, 1);
  });

  it('fails closed with HTTP 503 when GITHUB_WEBHOOK_SECRET is not configured', async () => {
    const started = await startTestServer({ env: {} });
    activeServer = started.server;

    const res = await fetch(`${started.baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-GitHub-Delivery': 'delivery-no-secret',
        'X-Hub-Signature-256': 'sha256=anything'
      },
      body: '{}'
    });
    assert.equal(res.status, 503);
  });
});

