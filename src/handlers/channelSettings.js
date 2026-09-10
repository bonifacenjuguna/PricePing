const { Markup } = require('telegraf');
const channelsDb = require('../db/channels');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit, sendEphemeral } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');

const INTERVAL_PRESETS = [15, 30, 60, 120];
const QUIET_HOUR_PRESETS = [
  { label: '10pm-7am', start: 22, end: 7 },
  { label: '11pm-6am', start: 23, end: 6 },
  { label: 'Off', start: null, end: null },
];

async function showChannelSettings(ctx, channelId) {
  navStack.push(ctx, 'channelSettings', { channelId });
  const channel = await channelsDb.getById(channelId);
  if (!channel) {
    return safeEdit(ctx, '⚠️ Add me to a channel first.', Markup.inlineKeyboard([[callback('📡 Manage Channels', 'managechannels:show')], navRow()]));
  }

  const quietLabel = channel.quiet_hours_start === null || channel.quiet_hours_start === undefined
    ? 'off'
    : `${channel.quiet_hours_start}:00-${channel.quiet_hours_end}:00 (${channel.timezone})`;

  const text =
    `📡 *Alert Delivery* — ${channel.title || channel.chat_id}\n\n` +
    `Mode: ${channel.digest_mode ? `Digest (every ${channel.digest_interval_minutes}m)` : 'Instant'}\n` +
    `Quiet hours: ${quietLabel}`;

  const rows = [
    [callback(channel.digest_mode ? '⚡ Switch to Instant' : '🗞 Switch to Digest', `chsettings:togglemode:${channelId}`)],
  ];
  if (channel.digest_mode) {
    rows.push(INTERVAL_PRESETS.map((m) => callback(`${m}m${channel.digest_interval_minutes === m ? ' ✅' : ''}`, `chsettings:interval:${channelId}:${m}`)));
  }
  rows.push(QUIET_HOUR_PRESETS.map((q) => callback(
    `${q.label}${channel.quiet_hours_start === q.start && channel.quiet_hours_end === q.end ? ' ✅' : ''}`,
    `chsettings:quiet:${channelId}:${q.start === null ? 'off' : `${q.start}-${q.end}`}`
  )));
  rows.push(navRow());

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function toggleDigestMode(ctx, channelId) {
  const channel = await channelsDb.getById(channelId);
  await channelsDb.setDigestMode(channelId, !channel.digest_mode, channel.digest_interval_minutes);
  await sendEphemeral(ctx, '✅ Delivery mode updated.');
  await showChannelSettings(ctx, channelId);
}

async function setInterval_(ctx, channelId, minutes) {
  await channelsDb.setDigestMode(channelId, true, minutes);
  await showChannelSettings(ctx, channelId);
}

async function setQuietHours(ctx, channelId, spec) {
  if (spec === 'off') {
    await channelsDb.setQuietHours(channelId, null, null);
  } else {
    const [start, end] = spec.split('-').map(Number);
    await channelsDb.setQuietHours(channelId, start, end);
  }
  await sendEphemeral(ctx, '✅ Quiet hours updated.');
  await showChannelSettings(ctx, channelId);
}

module.exports = { showChannelSettings, toggleDigestMode, setInterval: setInterval_, setQuietHours };
