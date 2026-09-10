// Central place to add and manage channels. Uses Telegram's native
// "startchannel" deep link so tapping the button opens Telegram's own
// chat picker with the required admin rights already pre-checked — the
// exact flow: tap -> pick a channel -> permissions pre-selected -> confirm
// add as admin. No custom UI needed for that part; Telegram handles it.
const { Markup } = require('telegraf');
const channelsDb = require('../db/channels');
const botInfo = require('../lib/botInfo');
const { callback, url, navRow } = require('../keyboards/buttonStyle');
const { safeEdit } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');

// Admin rights we actually need, preselected in the deep link so the
// channel admin doesn't have to hunt through a permissions list:
//   post_messages — required, this is how alerts/cards get posted
//   edit_messages — used by digest-mode flushes and any future edit-in-place features
// Deliberately NOT requesting delete_messages, pin_messages, invite_users,
// restrict_members, or anything else — least privilege, and it reads as
// more trustworthy to whoever is approving the add.
const REQUIRED_ADMIN_RIGHTS = ['post_messages', 'edit_messages'];

function buildAddChannelUrl() {
  const username = botInfo.get();
  if (!username) return null;
  const admin = REQUIRED_ADMIN_RIGHTS.join('+');
  return `https://t.me/${username}?startchannel=addchannel&admin=${admin}`;
}

async function showManageChannels(ctx) {
  navStack.push(ctx, 'manageChannels', {});
  const channels = await channelsDb.getActiveChannels();
  const addUrl = buildAddChannelUrl();

  const rows = [];
  if (addUrl) {
    rows.push([url('➕ Add Bot to a Channel', addUrl)]);
  } else {
    // Bot username not resolved yet (rare — only right at boot before the
    // first getMe() succeeds). Fall back to a plain-text instruction so
    // the screen is never a dead end even in that edge case.
    rows.push([callback('➕ Add Bot to a Channel (see below)', 'noop')]);
  }

  if (channels.length) {
    for (const c of channels) {
      rows.push([callback(`⚙️ ${c.title || c.chat_id}`, `chsettings:show:${c.id}`)]);
    }
  }
  rows.push(navRow());

  const text = addUrl
    ? `📡 *Manage Channels*\n\nTap "Add Bot to a Channel" — pick your channel, confirm the admin permissions (already preselected), done.${channels.length ? '\n\nYour channels:' : ''}`
    : `📡 *Manage Channels*\n\nTo add me to a channel: open the channel's admin settings and add me as an admin with "Post Messages" permission — registration is automatic once I'm promoted.${channels.length ? '\n\nYour channels:' : ''}`;

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

module.exports = { showManageChannels, buildAddChannelUrl, REQUIRED_ADMIN_RIGHTS };
