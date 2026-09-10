const config = require('../config');
const logger = require('../lib/logger');

async function notifyAdmin(bot, text) {
  if (!config.ADMIN_ID) return;
  try {
    await bot.telegram.sendMessage(config.ADMIN_ID, text);
  } catch (err) {
    logger.error('Could not notify admin', { message: err.message });
  }
}

module.exports = { notifyAdmin };
