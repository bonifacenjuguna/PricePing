function ts() {
  return new Date().toISOString();
}

function info(message, meta) {
  // eslint-disable-next-line no-console
  console.log(`[${ts()}] INFO  ${message}`, meta || '');
}

function warn(message, meta) {
  // eslint-disable-next-line no-console
  console.warn(`[${ts()}] WARN  ${message}`, meta || '');
}

function error(message, meta) {
  // eslint-disable-next-line no-console
  console.error(`[${ts()}] ERROR ${message}`, meta || '');
}

module.exports = { info, warn, error };
