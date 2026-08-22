function ts() {
  return new Date().toISOString();
}

function info(msg, meta) {
  console.log(`[${ts()}] INFO  ${msg}`, meta || '');
}

function warn(msg, meta) {
  console.warn(`[${ts()}] WARN  ${msg}`, meta || '');
}

function error(msg, meta) {
  console.error(`[${ts()}] ERROR ${msg}`, meta || '');
}

module.exports = { info, warn, error };
