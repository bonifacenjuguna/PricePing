// Runs on its own timer (see index.js), separate from the fast price-poll
// tick. For every active channel with digest_mode on, checks whether its
// configured interval has elapsed since the last flush AND it's not
// currently in quiet hours — if both hold and there's anything queued,
// sends one combined summary message and clears the queue.
const channelsDb = require('../db/channels');
const digestQueue = require('./digestQueue');
const tz = require('../lib/timezone');
const format = require('../lib/format');
const logger = require('../lib/logger');
const { isWithinQuietHours } = require('./poller');

function buildDigestText(channel, entries) {
  const milestones = entries.filter((e) => e.alertType === 'milestone');
  const thresholds = entries.filter((e) => e.alertType === 'threshold');
  // Largest moves first — most useful thing to see at the top of a digest.
  thresholds.sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0));

  const lines = [`🗞 *Digest* — ${entries.length} update${entries.length === 1 ? '' : 's'}\n`];

  if (milestones.length) {
    lines.push('*Milestones:*');
    for (const m of milestones) {
      lines.push(`${format.directionSymbol(m.direction)} ${m.symbol} crossed $${m.milestoneLevel.toLocaleString()}`);
    }
    lines.push('');
  }
  if (thresholds.length) {
    lines.push('*Price moves:*');
    for (const t of thresholds) {
      lines.push(`${format.directionSymbol(t.direction)} ${t.symbol} ${format.formatPct(t.changePct)} → $${format.formatPrice(t.price)}`);
    }
  }
  return lines.join('\n');
}

async function flushChannel(bot, channel) {
  const now = new Date();
  const hourLocal = tz.getHourInZone(now, channel.timezone || 'UTC');
  if (isWithinQuietHours(hourLocal, channel.quiet_hours_start, channel.quiet_hours_end)) return; // hold the queue until quiet hours end

  const lastFlush = await digestQueue.getLastFlushAt(channel.id);
  const intervalMs = (channel.digest_interval_minutes || 60) * 60 * 1000;
  if (Date.now() - lastFlush < intervalMs) return;

  const entries = await digestQueue.peekAll(channel.id);
  if (!entries.length) {
    await digestQueue.setLastFlushNow(channel.id); // nothing to say, but reset the clock so we check again a full interval from now
    return;
  }

  try {
    await bot.telegram.sendMessage(channel.chat_id, buildDigestText(channel, entries), { parse_mode: 'Markdown' });
    await digestQueue.clear(channel.id);
    await digestQueue.setLastFlushNow(channel.id);
  } catch (err) {
    logger.error('Digest flush failed to send', { channelId: channel.id, message: err.message });
    // Deliberately don't clear the queue on send failure — keep the entries
    // and retry on the next scheduler tick rather than silently drop them.
  }
}

async function tick(bot) {
  let channels;
  try {
    channels = (await channelsDb.getActiveChannels()).filter((c) => c.digest_mode);
  } catch (err) {
    logger.error('Digest scheduler could not load channels', { message: err.message });
    return;
  }
  for (const channel of channels) {
    // eslint-disable-next-line no-await-in-loop
    await flushChannel(bot, channel).catch((err) => logger.error('Digest flush threw', { channelId: channel.id, message: err.message }));
  }
}

module.exports = { tick, buildDigestText };
