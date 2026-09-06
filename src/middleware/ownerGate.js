const config = require('../config');

// Owner-only bot — anyone who isn't ADMIN_TELEGRAM_ID is silently ignored,
// no error message (avoids confirming the bot's existence/behavior to
// randoms who stumble onto it).
function ownerGate() {
  return (ctx, next) => {
    const fromId = ctx.from && ctx.from.id;
    if (fromId !== config.adminId) return; // eslint-disable-line consistent-return
    return next();
  };
}

module.exports = ownerGate;
