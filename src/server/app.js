const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const oauth = require('../lib/oauth');
const github = require('../lib/github');
const users = require('../lib/users');
const activity = require('../lib/activity');
const logger = require('../lib/logger');

const PAGE_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'callback.html'), 'utf8');

const SUCCESS_STEPS = [
  'Verifying request',
  'Exchanging authorization code',
  'Encrypting access token',
  'Saving to secure storage',
  'Linking Telegram session',
];

function renderPage(data) {
  const inject = `<script>window.__GITROHUB__ = ${JSON.stringify(data)};</script>`;
  return PAGE_TEMPLATE.replace('</head>', `${inject}</head>`);
}

// Health check ping cache — avoids re-pinging both DBs on every single
// poll if Railway (or any external monitor) checks frequently.
const HEALTH_CACHE_TTL_MS = 5000;
let healthCache = null;

async function getHealthStatus() {
  if (healthCache && Date.now() - healthCache.timestamp < HEALTH_CACHE_TTL_MS) {
    return healthCache.result;
  }
  const pgDb = require('../db/postgres');
  const redisDb = require('../db/redis');
  const [pgStatus, redisStatus] = await Promise.all([pgDb.ping(), redisDb.ping()]);
  const result = { pgStatus, redisStatus };
  healthCache = { result, timestamp: Date.now() };
  return result;
}

function describeWebhookEvent(event, payload) {
  if (event === 'push') {
    const count = payload.commits ? payload.commits.length : 0;
    if (count === 0) return null; // branch/tag creation pings with no commits — not interesting
    return `${count} new commit${count === 1 ? '' : 's'} pushed`;
  }
  if (event === 'issues' && payload.action === 'opened') return `New issue: "${payload.issue.title}"`;
  if (event === 'pull_request' && payload.action === 'opened') return `New PR: "${payload.pull_request.title}"`;
  if (event === 'release' && payload.action === 'published') return `New release: ${payload.release.tag_name}`;
  // workflow_run fires for every state
  // transition (requested/in_progress/completed) — only the terminal
  // 'completed' action is worth a notification, otherwise a single CI run
  // would spam 2-3 messages for its own lifecycle.
  if (event === 'workflow_run' && payload.action === 'completed') {
    const conclusion = payload.workflow_run.conclusion; // success | failure | cancelled | ...
    const icon = conclusion === 'success' ? '✅' : conclusion === 'failure' ? '❌' : '⚠️';
    return `${icon} Workflow "${payload.workflow_run.name}" ${conclusion}`;
  }
  if (event === 'deployment_status') {
    return `Deployment ${payload.deployment_status.state} → ${payload.deployment_status.environment}`;
  }
  return null;
}

function createApp(bot) {
  const app = express();
  // express.static() serves a DIRECTORY, not a single file path — mounting
  // the whole public/ directory at root future-proofs any static assets
  // added to public/ later. The callback page's logo currently points at
  // the GitHub-hosted raw.githubusercontent.com copy instead of this local
  // one, so it renders correctly even before/without this route existing.
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  app.get('/', (req, res) => {
    res.send('GitroHub is running. This endpoint has nothing to show you directly — open the bot on Telegram.');
  });

  // Railway can poll this to detect a degraded instance and restart it
  // proactively, rather than only reacting after a hard OOM kill.
  app.get('/health', async (req, res) => {
    const { pgStatus, redisStatus } = await getHealthStatus();
    const mem = process.memoryUsage();
    const healthy = pgStatus.ok && redisStatus.ok;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      postgres: pgStatus.ok,
      redis: redisStatus.ok,
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    const botDeepLink = 'https://t.me/GitroHubBot';

    // GitHub itself reported denial/cancellation
    if (oauthError) {
      return res.send(renderPage({
        status: 'error',
        steps: ['Verifying request'],
        failStepIndex: 0,
        error: 'Authorization cancelled: you didn\u2019t approve access on GitHub, or closed the page before finishing.',
        botDeepLink,
      }));
    }

    let telegramId;
    try {
      telegramId = oauth.verifyState(state);
    } catch (err) {
      return res.send(renderPage({
        status: 'error',
        steps: ['Verifying request'],
        failStepIndex: 0,
        error: 'The authorization link was invalid or expired. This can happen if you waited too long or reused an old link.',
        botDeepLink,
      }));
    }

    try {
      const tokenData = await oauth.exchangeCodeForToken(code);
      const repoCache = require('../lib/repoCache');
      const ghUser = await repoCache.getUser(telegramId, tokenData.access_token);

      const existingUser = await users.getUser(telegramId);
      const isReconnect = !!(existingUser && existingUser.connected_at);

      await users.saveConnection(telegramId, {
        accessToken: tokenData.access_token,
        scope: tokenData.scope,
        githubUsername: ghUser.login,
      });

      await activity.log(telegramId, '🔗', `Connected GitHub account (@${ghUser.login})`, {});

      const accessLog = require('../lib/accessLog');
      await accessLog.record(telegramId, isReconnect ? 'reconnected' : 'connected', `scope: ${tokenData.scope}`);

      // Proactively push the confirmation into the chat (per design: bot pushes
      // this automatically, no need for the user to tap anything back in Telegram)
      const { escapeMd } = require('../lib/format');
      const bbtb = require('../keyboards/bbtb');
      const updatedUser = await users.getUser(telegramId);
      const alertLine = updatedUser.alert_on_new_connection
        ? '\n\n🔐 New session started — logged in 🔑 Access Log (Settings).'
        : '';
      await bot.telegram.sendMessage(
        telegramId,
        `✅ *GitHub Connected*\nLinked as: ${escapeMd(ghUser.login)}\nScope: repo, delete\\_repo \\(full control, including delete\\)${escapeMd(alertLine)}`,
        { parse_mode: 'MarkdownV2', reply_markup: bbtb.mainMenu.reply_markup }
      );

      return res.send(renderPage({
        status: 'success',
        steps: SUCCESS_STEPS,
        username: ghUser.login,
        botDeepLink,
      }));
    } catch (err) {
      logger.error('OAuth callback error', { message: err.message });
      await activity.log(telegramId, '⚠️', 'GitHub connection failed', { detail: err.message, isError: true }).catch(() => {});

      return res.send(renderPage({
        status: 'error',
        steps: SUCCESS_STEPS.slice(0, 2),
        failStepIndex: 1,
        error: `Couldn\u2019t complete the token exchange with GitHub: ${err.message}. This is usually temporary.`,
        botDeepLink,
      }));
    }
  });

  // GitHub webhook receiver — per-repo notifications (Settings toggles).
  // Raw body needed (not JSON-parsed) since HMAC verification is computed
  // over the exact bytes GitHub sent; this route is scoped to raw parsing
  // only, no global express.json() exists elsewhere to conflict with.
  app.post('/webhook/github', express.raw({ type: 'application/json' }), async (req, res) => {
    const crypto = require('crypto');
    const repoWebhooks = require('../lib/repoWebhooks');
    const notificationMutes = require('../lib/notificationMutes');
    const users = require('../lib/users');

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      return res.status(400).send('Invalid JSON');
    }

    const repoFullName = payload.repository && payload.repository.name;
    if (!repoFullName) return res.status(400).send('Missing repository');

    const registration = await repoWebhooks.getByRepo(repoFullName).catch(() => null);
    if (!registration) return res.status(404).send('Not registered');

    // Verify the signature against OUR stored secret — never trust
    // anything about identity claimed by the payload itself.
    const signature = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', registration.secret).update(req.body).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    if (!valid) {
      logger.warn('Webhook signature mismatch', { repo: repoFullName });
      return res.status(401).send('Invalid signature');
    }

    res.status(200).send('OK'); // ack immediately, don't make GitHub wait on Telegram delivery

    try {
      const muted = await notificationMutes.isMuted(registration.telegram_id, repoFullName);
      if (muted) return;

      const user = await users.getUser(registration.telegram_id);
      if (!user || !user.notif_github_activity) return;

      const event = req.headers['x-github-event'];
      const summary = describeWebhookEvent(event, payload);
      if (!summary) return; // event type we don't have a message for

      await activity.log(registration.telegram_id, '🔔', `${summary} → ${repoFullName}`, {});

      // Digest buffering instead of an immediate send. Quiet
      // hours (if configured) simply widen the effective window: the
      // event still buffers immediately, but delivery is deferred until
      // quiet hours end (checked by the flush poller, see bot.js).
      const webhookDigest = require('../lib/webhookDigest');
      await webhookDigest.push(registration.telegram_id, repoFullName, summary);
    } catch (err) {
      logger.error('Webhook post-processing failed', { message: err.message });
    }
  });

  // Catch-all for anything unexpected in a route that wasn't already
  // handled by its own try/catch — fails clean with a generic 500 instead
  // of an unpredictable Express default error page or a hung response.
  app.use((err, req, res, next) => {
    logger.error('Unhandled Express error', { path: req.path, message: err.message });
    if (res.headersSent) return next(err);
    res.status(500).send('Something went wrong. Please try again.');
  });

  return app;
}

module.exports = createApp;
