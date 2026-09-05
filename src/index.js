const config = require('./config');
const { migrate } = require('./db/migrate');
const redisDb = require('./db/redis');
const pgDb = require('./db/postgres');
const createBot = require('./bot');
const createApp = require('./server/app');
const logger = require('./lib/logger');

let bot;
let httpServer;
let shuttingDown = false;
let botMode = null; // 'webhook' | 'polling' — tracks which so shutdown knows whether bot.stop() is even valid

/**
 * Closes everything in order (bot polling/webhook, HTTP server, Redis,
 * Postgres) before the process exits. Used for real SIGTERM/SIGINT from
 * Railway, the voluntary memory-watchdog restart, and an uncaught
 * exception — every path ends here so connections close cleanly instead
 * of the process just disappearing mid-write.
 *
 * Every step below has its own timeout, AND the
 * whole sequence is capped by a hard deadline — httpServer.close() famously
 * hangs waiting for idle keep-alive connections to close on their own (it
 * doesn't force them), and Redis's client.quit() has known hangs under
 * certain reconnect states. Either one hanging would mean process.exit()
 * never runs, silently defeating the entire point of the watchdog: instead
 * of a clean preemptive restart, the process would just sit there — still
 * consuming memory — until Railway's kernel eventually force-killed it anyway.
 */
const SHUTDOWN_STEP_TIMEOUT_MS = 5000;
const SHUTDOWN_HARD_DEADLINE_MS = 8000;

function withStepTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), SHUTDOWN_STEP_TIMEOUT_MS)),
  ]);
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { reason });

  // Absolute last resort: if the graceful sequence below is still running
  // past this deadline for ANY reason, force-exit anyway. A forced exit
  // that skips some cleanup is still strictly better than never exiting —
  // Railway's kernel would eventually force-kill it regardless, just
  // later and after more memory had piled up in the meantime.
  const hardDeadline = setTimeout(() => {
    logger.error('Shutdown exceeded hard deadline — forcing exit', { reason });
    process.exit(1);
  }, SHUTDOWN_HARD_DEADLINE_MS);
  hardDeadline.unref?.();

  // bot.stop() only means something in polling mode (it stops the getUpdates
  // loop). In webhook mode there's no such loop running, so calling it just
  // throws "Bot is not running!" every time — noise that was cluttering the
  // exact logs needed to debug real issues. Skipped entirely in webhook mode.
  if (botMode === 'polling') {
    try {
      if (bot) bot.stop(reason);
    } catch (err) {
      logger.error('Error stopping bot', { message: err.message });
    }
  }
  try {
    if (httpServer) await withStepTimeout(new Promise((resolve) => httpServer.close(resolve)), 'HTTP server close');
  } catch (err) {
    logger.error('Error closing HTTP server', { message: err.message });
  }
  try {
    await withStepTimeout(redisDb.close(), 'Redis close');
  } catch (err) {
    logger.error('Error closing Redis', { message: err.message });
  }
  try {
    await withStepTimeout(pgDb.close(), 'Postgres pool close');
  } catch (err) {
    logger.error('Error closing Postgres pool', { message: err.message });
  }

  clearTimeout(hardDeadline);
  logger.info('Shutdown complete');
  process.exit(0);
}

/**
 * Checks RSS memory against a self-imposed ceiling comfortably under
 * Railway's hard container limit, and triggers the SAME clean shutdown
 * path above rather than waiting for the kernel to SIGKILL the process.
 *
 * Two design choices worth noting:
 *
 * 1. Adaptive check interval, not just a fixed 2-minute post-boot window.
 *    A flat 30s cadence after boot would leave a real blind spot: a sharp
 *    spike well after startup (e.g. a burst of concurrent GitHub requests)
 *    could blow past the ceiling within that 30s gap before the watchdog
 *    even looks again. Checks every 5s whenever RSS is within 20% of the
 *    ceiling, regardless of how long the process has been up — the fast
 *    cadence follows actual risk, not just a fixed post-boot window.
 *
 * 2. An early-warning log at 80% of the ceiling. I can't verify from
 *    static analysis alone whether MEMORY_WATCHDOG_MB's margin under
 *    --max-old-space-size is actually right — that needs real Railway
 *    telemetry, not more guessing. This doesn't change the threshold
 *    itself; it makes the trend visible in the logs before a restart
 *    happens, so if the margin ever IS wrong, there's real data to look
 *    at instead of another unverified assumption.
 */
function startMemoryWatchdog() {
  const startTime = Date.now();
  const FAST_INTERVAL_MS = 5000;
  const FAST_WINDOW_MS = 2 * 60 * 1000;
  const WARNING_THRESHOLD_MB = config.MEMORY_WATCHDOG_MB * 0.8;
  const PROXIMITY_ZONE_MB = config.MEMORY_WATCHDOG_MB * 0.2; // "close to the ceiling" band
  let lastWarnedAt = 0;

  function check() {
    const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (rssMB >= config.MEMORY_WATCHDOG_MB) {
      logger.warn('Memory watchdog threshold crossed — restarting cleanly', { rssMB, ceilingMB: config.MEMORY_WATCHDOG_MB });
      shutdown('memory-watchdog');
      return;
    }
    if (rssMB >= WARNING_THRESHOLD_MB && Date.now() - lastWarnedAt > 60000) {
      // Debounced to once/minute — this is a heads-up, not a per-check spam risk
      logger.warn('Memory approaching watchdog ceiling', { rssMB, ceilingMB: config.MEMORY_WATCHDOG_MB });
      lastWarnedAt = Date.now();
    }

    const inFastWindow = Date.now() - startTime < FAST_WINDOW_MS;
    const nearCeiling = rssMB >= config.MEMORY_WATCHDOG_MB - PROXIMITY_ZONE_MB;
    const nextInterval = (inFastWindow || nearCeiling) ? FAST_INTERVAL_MS : config.MEMORY_WATCHDOG_CHECK_INTERVAL_MS;
    setTimeout(check, nextInterval).unref();
  }
  setTimeout(check, FAST_INTERVAL_MS).unref();
}

/**
 * Flushes any webhook digest windows that have come due (see
 * lib/webhookDigest.js). A plain setInterval, deliberately separate from
 * the memory watchdog's adaptive-cadence logic above — unrelated concern,
 * unrelated failure modes; tangling them would make both harder to reason
 * about. 30s cadence is frequent enough that a 2-minute digest window
 * never overshoots by more than half a poll cycle.
 *
 * Quiet hours: if the user has a configured quiet_hours_start/end and the
 * current hour (in UTC — this is a single-owner bot with one timezone of
 * concern, the owner's; a per-user TZ field doesn't exist so UTC hour is
 * the only thing available to compare against) falls inside that window,
 * the digest is simply left unflushed — it stays in Redis and gets picked
 * up again on the next poll after quiet hours end, rather than being
 * flushed on time and then queued client-side (simpler, and nothing is
 * lost either way).
 */
function startWebhookDigestPoller(bot) {
  const DIGEST_POLL_INTERVAL_MS = 30 * 1000;
  async function poll() {
    try {
      const webhookDigest = require('./lib/webhookDigest');
      const users = require('./lib/users');
      const due = await webhookDigest.flushDue();
      for (const { telegramId, repo, events } of due) {
        const user = await users.getUser(telegramId).catch(() => null);
        if (user && user.quiet_hours_start != null && user.quiet_hours_end != null) {
          const hour = new Date().getUTCHours();
          const { quiet_hours_start: qs, quiet_hours_end: qe } = user;
          const inQuietWindow = qs <= qe ? (hour >= qs && hour < qe) : (hour >= qs || hour < qe); // handles wrap past midnight
          if (inQuietWindow) {
            // Re-buffer for the next poll rather than dropping — push each
            // event back in under a fresh window.
            for (const e of events) await webhookDigest.push(telegramId, repo, e.summary);
            continue;
          }
        }
        const message = webhookDigest.composeDigestMessage(repo, events);
        await bot.telegram.sendMessage(telegramId, message).catch((err) => {
          logger.error('Digest delivery failed', { telegramId, repo, message: err.message });
        });
      }
    } catch (err) {
      logger.error('Webhook digest poll failed', { message: err.message });
    }
    setTimeout(poll, DIGEST_POLL_INTERVAL_MS).unref();
  }
  setTimeout(poll, DIGEST_POLL_INTERVAL_MS).unref();
}

/**
 * Daily/weekly rollup delivery. Checked hourly; a Redis marker
 * (not in-memory) records the last date a rollup was sent per user+period,
 * so a bot restart can't cause a duplicate send within the same day/week —
 * same reasoning as the digest poller's "durable due-marker over
 * setTimeout" choice above.
 */
function startRollupScheduler(bot) {
  const HOURLY_MS = 60 * 60 * 1000;
  const ROLLUP_HOUR_UTC = 8; // 08:00 UTC — arbitrary fixed send time, single-owner bot has one timezone of concern

  async function poll() {
    try {
      const now = new Date();
      if (now.getUTCHours() === ROLLUP_HOUR_UTC) {
        const { pool } = require('./db/postgres');
        const redisDb = require('./db/redis');
        const rollup = require('./lib/rollup');
        const isMonday = now.getUTCDay() === 1;

        const { rows: users } = await pool.query("SELECT telegram_id, notif_rollup FROM users WHERE notif_rollup != 'off'");
        for (const u of users) {
          if (u.notif_rollup === 'weekly' && !isMonday) continue;
          const days = u.notif_rollup === 'weekly' ? 7 : 1;
          const marker = `rollup-sent:${u.telegram_id}:${now.toISOString().slice(0, 10)}:${u.notif_rollup}`;
          const already = await redisDb.client.exists(marker);
          if (already) continue;

          const summary = await rollup.compose(u.telegram_id, days);
          if (summary) {
            await bot.telegram.sendMessage(u.telegram_id, summary, { parse_mode: 'MarkdownV2' }).catch(() => {});
          }
          await redisDb.client.set(marker, '1', { EX: 25 * 60 * 60 }); // outlives the check window comfortably, self-expires
        }
      }
    } catch (err) {
      logger.error('Rollup scheduler failed', { message: err.message });
    }
    setTimeout(poll, HOURLY_MS).unref();
  }
  setTimeout(poll, HOURLY_MS).unref();
}

/**
 * 🤖 Automation's background tasks — daily log pruning, weekly auto-backup
 * runs, and weekly stale-repo nudges. Same hourly-check + Redis-marker
 * pattern as the rollup scheduler above, offset by an hour so the two
 * don't hit the database in the same tick.
 */
function startAutomationScheduler(bot) {
  const HOURLY_MS = 60 * 60 * 1000;
  const TASK_HOUR_UTC = 9;

  async function poll() {
    try {
      const now = new Date();
      if (now.getUTCHours() === TASK_HOUR_UTC) {
        const redisDb = require('./db/redis');
        const dateKey = now.toISOString().slice(0, 10);

        // Daily: prune activity_log (per-user retention, see
        // dataStore.pruneAllUsersActivity) + access_log (fixed retention —
        // it's a security log, not a per-user preference) — neither table
        // has any other reliable cleanup path.
        const pruneMarker = `automation-prune:${dateKey}`;
        if (!(await redisDb.client.exists(pruneMarker))) {
          const config = require('./config');
          const dataStore = require('./lib/dataStore');
          const accessLog = require('./lib/accessLog');
          const trash = require('./lib/trash');
          const prunedActivity = await dataStore.pruneAllUsersActivity();
          const prunedAccess = await accessLog.pruneOlderThan(config.LOG_RETENTION_DAYS);
          const prunedTrash = await trash.pruneExpired();
          logger.info('Automation: pruned old logs', { prunedActivity, prunedAccess, prunedTrash });
          await redisDb.client.set(pruneMarker, '1', { EX: 25 * 60 * 60 });
        }

        // Weekly (Monday): auto-backup runs + stale-repo nudges
        if (now.getUTCDay() === 1) {
          const weekMarker = `automation-weekly:${dateKey}`;
          if (!(await redisDb.client.exists(weekMarker))) {
            await runWeeklyAutomation(bot);
            await redisDb.client.set(weekMarker, '1', { EX: 25 * 60 * 60 });
          }
        }
      }
    } catch (err) {
      logger.error('Automation scheduler failed', { message: err.message });
    }
    setTimeout(poll, HOURLY_MS).unref();
  }
  setTimeout(poll, HOURLY_MS).unref();
}

/** Only visits users who could actually have something to do this week —
 * at least one backup rule, or the stale nudge toggled on — rather than
 * looping every connected account regardless of whether automation is
 * configured at all. */
async function runWeeklyAutomation(bot) {
  const { pool } = require('./db/postgres');
  const users = require('./lib/users');
  const backupRules = require('./lib/automationBackupRules');
  const repoCache = require('./lib/repoCache');
  const github = require('./lib/github');
  const activity = require('./lib/activity');

  const { rows: candidates } = await pool.query(
    `SELECT DISTINCT u.telegram_id FROM users u
     LEFT JOIN automation_backup_rules abr ON abr.telegram_id = u.telegram_id
     WHERE u.notif_stale_nudge = TRUE OR abr.id IS NOT NULL`
  );

  for (const { telegram_id: telegramId } of candidates) {
    try {
      const token = await users.getDecryptedToken(telegramId);
      if (!token) continue;
      const user = await repoCache.getUser(telegramId, token).catch(() => null);
      if (!user) continue;
      const allRepos = await repoCache.getRepos(telegramId, token);

      // Auto-Backup
      const matches = await backupRules.matchingRepos(telegramId, allRepos);
      let backedUp = 0;
      for (const repo of matches) {
        try {
          const zipBuffer = await github.downloadZip(token, user.login, repo.name, repo.default_branch);
          await bot.telegram.sendDocument(
            telegramId,
            { source: zipBuffer, filename: `${repo.name}-backup-${new Date().toISOString().slice(0, 10)}.zip` },
            { caption: `💾 Weekly backup: ${repo.name}` }
          );
          backedUp++;
        } catch (err) {
          logger.error('Weekly backup failed for one repo', { telegramId, repo: repo.name, message: err.message });
        }
      }
      if (backedUp > 0) {
        await activity.log(telegramId, '💾', `Weekly auto-backup → ${backedUp} repo(s) sent`, { isAutomated: true });
      }

      // Stale-repo nudge
      const prefs = await users.getNotificationPrefs(telegramId);
      if (prefs && prefs.staleNudge) {
        const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const stale = allRepos.filter((r) => new Date(r.pushed_at).getTime() < cutoff);
        if (stale.length > 0) {
          const names = stale.slice(0, 10).map((r) => `• ${r.name}`).join('\n');
          const message =
            `🗂️ Weekly nudge: ${stale.length} repo(s) haven't been pushed to in 90+ days:\n\n${names}` +
            `${stale.length > 10 ? `\n… and ${stale.length - 10} more` : ''}` +
            `\n\nOpen 🤖 Automation → 🗂️ Stale Repos for details.`;
          await bot.telegram.sendMessage(telegramId, message).catch(() => {});
        }
      }
    } catch (err) {
      logger.error('Weekly automation failed for user', { telegramId, message: err.message });
    }
  }
}

/**
 * 📅 Scheduled Commits — checked every 5 minutes rather than the hourly
 * fixed-UTC-hour pattern the other schedulers use, since a person picking
 * a specific time for repo creation has some reasonable expectation of
 * precision an hourly check can't give. Mirrors the exact same success
 * path as the manual Create Repo flow (scenes/createRepo.js) — same
 * README-removal behavior, same activity log shape — so a scheduled repo
 * looks no different from one created by hand once it exists.
 */
function startScheduledCommitsPoller(bot) {
  const POLL_MS = 5 * 60 * 1000;

  async function poll() {
    try {
      const scheduledRepos = require('./lib/scheduledRepos');
      const due = await scheduledRepos.getDue();

      for (const item of due) {
        try {
          const users = require('./lib/users');
          const github = require('./lib/github');
          const repoCache = require('./lib/repoCache');
          const activity = require('./lib/activity');

          const token = await users.getDecryptedToken(item.telegram_id);
          if (!token) {
            await scheduledRepos.markFailed(item.id, 'GitHub disconnected before this could run');
            await bot.telegram.sendMessage(
              item.telegram_id,
              `⚠️ Scheduled repo "${item.name}" couldn't be created — GitHub isn't connected anymore.`
            ).catch(() => {});
            continue;
          }

          const repo = await github.createRepo(token, {
            name: item.name,
            isPrivate: item.visibility === 'private',
            description: item.description,
            licenseTemplate: item.license,
          });
          repoCache.invalidateRepos(item.telegram_id);

          if (!item.include_readme) {
            try {
              const existing = await github.getFileContent(token, repo.owner.login, repo.name, 'README.md');
              await github.deleteFile(token, repo.owner.login, repo.name, 'README.md', existing.sha, 'Remove default README');
            } catch (_) { /* best-effort, same as the manual flow */ }
          }

          await scheduledRepos.markCompleted(item.id);
          await activity.log(item.telegram_id, '📅', `Scheduled repo created → ${repo.name}`, {
            detail: `visibility:${item.visibility}`, isAutomated: true,
          });
          await bot.telegram.sendMessage(
            item.telegram_id,
            `✅ Scheduled repo created: ${repo.name}\n🔗 ${repo.html_url}`
          ).catch(() => {});
        } catch (err) {
          await scheduledRepos.markFailed(item.id, err.message);
          logger.error('Scheduled repo creation failed', { telegramId: item.telegram_id, name: item.name, message: err.message });
          const reason = err.status === 422 ? `"${item.name}" already exists on your account` : err.message;
          await bot.telegram.sendMessage(
            item.telegram_id,
            `⚠️ Scheduled repo "${item.name}" failed to create: ${reason}`
          ).catch(() => {});
        }
      }
    } catch (err) {
      logger.error('Scheduled commits poller failed', { message: err.message });
    }
    setTimeout(poll, POLL_MS).unref();
  }
  setTimeout(poll, POLL_MS).unref();
}

/**
 * Process-level safety net. An uncaught exception leaves Node in an
 * undefined state — best practice is to log it clearly and exit via the
 * same clean shutdown path. Unhandled promise rejections are logged but
 * don't trigger a restart on their own — most are already recoverable
 * errors caught one level up (e.g. bot.catch).
 */
function installCrashHandlers() {
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { message: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: reason && reason.message ? reason.message : String(reason) });
  });
}

async function main() {
  installCrashHandlers();

  logger.info('Running database migrations...');
  await migrate();

  logger.info('Connecting to Redis...');
  await redisDb.connect();

  logger.info('Starting Telegram bot...');
  bot = createBot();

  // Kept short — Telegram's own command list UI is a compact popup, long
  // descriptions get truncated or crowd out the command names.
  await bot.telegram.setMyCommands([
    { command: 'start', description: '🏠 Main menu' },
    { command: 'settings', description: '⚙️ Settings & status' },
    { command: 'cancel', description: '❌ Cancel & return to menu' },
  ]);

  logger.info('Starting web server (OAuth callback + health check)...');
  const app = createApp(bot);

  const useWebhook = process.env.NODE_ENV === 'production';

  if (useWebhook) {
    botMode = 'webhook';
    const webhookPath = '/telegram-webhook';
    app.use(bot.webhookCallback(webhookPath, { secretToken: config.TELEGRAM_WEBHOOK_SECRET }));
    httpServer = app.listen(config.PORT, async () => {
      logger.info('Server listening', { port: config.PORT });

      // Log how many updates were actually pending before discarding them —
      // turns "I think there's a backlog" into hard evidence in the logs.
      try {
        const info = await bot.telegram.getWebhookInfo();
        if (info.pending_update_count > 0) {
          logger.warn('Discarding pending update backlog on startup', { count: info.pending_update_count });
        }
      } catch (err) {
        logger.error('Could not check webhook backlog before clearing', { message: err.message });
      }

      // drop_pending_updates: without this, any updates that queued up on
      // Telegram's side while the bot was down all got delivered in a burst
      // the instant the webhook came back — each spinning up its own DB/
      // GitHub work roughly at once. Every boot now starts genuinely clean
      // instead of inheriting whatever piled up during any downtime.
      await bot.telegram.setWebhook(`${config.BASE_URL}${webhookPath}`, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
        drop_pending_updates: true,
      });
      logger.info('Telegram webhook set', { url: `${config.BASE_URL}${webhookPath}` });
    });
  } else {
    botMode = 'polling';
    httpServer = app.listen(config.PORT, () => {
      logger.info('Server listening (OAuth callback + health check)', { port: config.PORT });
    });
    await bot.launch({ dropPendingUpdates: true });
    logger.info('Bot running in polling mode (development)');
  }

  startMemoryWatchdog();
  startWebhookDigestPoller(bot);
  startRollupScheduler(bot);
  startAutomationScheduler(bot);
  startScheduledCommitsPoller(bot);

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { message: err.message, stack: err.stack });
  process.exit(1);
});
