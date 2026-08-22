const config = require('../config');
const logger = require('../utils/logger');

function accessGate() {
  return async (ctx, next) => {
    const fromId = ctx.from && ctx.from.id;
    if (fromId === config.adminId) {
      return next();
    }
    // Silent-ish for anyone else — this bot never has a public audience,
    // but if someone does find it, don't reveal anything about what it does.
    if (fromId) {
      logger.warn('Ignored update from non-admin user', { fromId });
    }
    try {
      await ctx.reply('This bot is private.');
    } catch {
      /* non-fatal */
    }
    return undefined;
  };
}

module.exports = { accessGate };
