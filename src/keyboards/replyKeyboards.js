const { Markup } = require('telegraf');

// Persistent bottom keyboard shown at the Home screen — the main sections,
// 2-3 per row. Swaps out for a minimal Back/Cancel pair inside any flow
// (see cancelOnly below), same pattern reviewed from the reference bots.
const home = Markup.keyboard([
  ['📊 Prices', '📈 Charts'],
  ['🐋 Milestones', '😨 Fear & Greed'],
  ['⚙️ Settings', 'ℹ️ Help'],
]).resize();

const cancelOnly = Markup.keyboard([['❌ Cancel']]).resize();

module.exports = { home, cancelOnly };
