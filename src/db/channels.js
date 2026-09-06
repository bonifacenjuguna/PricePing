const { pool } = require('./pool');

// `channels` table already existed (name, chat_id, is_default) — extended
// with `channel_post_types` (new in v1.0.0) for the per-channel per-post-
// type opt-out. Every post type defaults to enabled for a brand-new
// channel (see addChannel below) — an owner opts a channel OUT of noise,
// rather than having to opt every channel IN to everything.

const POST_TYPES = ['threshold', 'milestone', 'manual', 'chart', 'movers', 'feargreed', 'digest'];

async function getAll() {
  const res = await pool.query('SELECT * FROM channels ORDER BY is_default DESC, name ASC');
  return res.rows;
}

async function getPrimary() {
  const res = await pool.query('SELECT * FROM channels WHERE is_default = true LIMIT 1');
  return res.rows[0] || null;
}

async function get(name) {
  const res = await pool.query('SELECT * FROM channels WHERE name = $1', [name]);
  return res.rows[0] || null;
}

async function addChannel(name, chatId) {
  await pool.query(
    `INSERT INTO channels (name, chat_id, is_default) VALUES ($1, $2, false)
     ON CONFLICT (name) DO UPDATE SET chat_id = EXCLUDED.chat_id`,
    [name, chatId]
  );
  for (const postType of POST_TYPES) {
    await pool.query(
      `INSERT INTO channel_post_types (channel_name, post_type, enabled) VALUES ($1, $2, true)
       ON CONFLICT (channel_name, post_type) DO NOTHING`,
      [name, postType]
    );
  }
}

// The primary channel (is_default = true) can never be removed via this —
// callers must check isDefault before offering the button at all.
async function removeChannel(name) {
  const channel = await get(name);
  if (channel && channel.is_default) {
    throw new Error('The primary channel cannot be removed.');
  }
  await pool.query('DELETE FROM channel_post_types WHERE channel_name = $1', [name]);
  await pool.query('DELETE FROM channels WHERE name = $1', [name]);
}

async function getPostTypeToggles(name) {
  const res = await pool.query('SELECT post_type, enabled FROM channel_post_types WHERE channel_name = $1', [name]);
  const map = {};
  for (const t of POST_TYPES) map[t] = true; // default on if row missing (e.g. primary channel, seeded at migration time)
  for (const row of res.rows) map[row.post_type] = row.enabled;
  return map;
}

async function setPostTypeEnabled(name, postType, enabled) {
  await pool.query(
    `INSERT INTO channel_post_types (channel_name, post_type, enabled) VALUES ($1, $2, $3)
     ON CONFLICT (channel_name, post_type) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [name, postType, enabled]
  );
}

// Channels that currently have a given post type enabled — what
// telegramSender.js actually broadcasts to for that post.
async function getChannelsForPostType(postType) {
  const all = await getAll();
  const out = [];
  for (const channel of all) {
    const toggles = await getPostTypeToggles(channel.name);
    if (toggles[postType]) out.push(channel);
  }
  return out;
}

module.exports = {
  POST_TYPES,
  getAll,
  getPrimary,
  get,
  addChannel,
  removeChannel,
  getPostTypeToggles,
  setPostTypeEnabled,
  getChannelsForPostType,
};
