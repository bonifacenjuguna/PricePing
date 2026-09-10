// Structured logging. Every call site passes a context object instead of
// string-concatenating — makes logs greppable/parseable on Railway instead
// of freeform prose, and keeps the shape consistent across the whole app.
function ts() {
  return new Date().toISOString();
}

function log(level, msg, ctx) {
  const line = { ts: ts(), level, msg, ...(ctx || {}) };
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(line));
}

module.exports = {
  info: (msg, ctx) => log('info', msg, ctx),
  warn: (msg, ctx) => log('warn', msg, ctx),
  error: (msg, ctx) => log('error', msg, ctx),
};
