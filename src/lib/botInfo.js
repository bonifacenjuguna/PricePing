// Holds the bot's own username once fetched at boot (via bot.telegram.getMe()
// in index.js). Needed synchronously by keyboard builders that construct the
// native "Add to Channel" deep link (t.me/<username>?startchannel=...) —
// storing it here avoids threading an async getMe() call through every
// handler that needs to render that button.
let username = null;

function set(name) {
  username = name;
}

function get() {
  return username;
}

module.exports = { set, get };
