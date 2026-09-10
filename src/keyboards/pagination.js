const { callback } = require('./buttonStyle');

// items: full array, page: 0-indexed, pageSize: items per page, prefix:
// callback data prefix for the Prev/Next buttons (screen-specific).
// Returns { pageItems, controlRow } — controlRow is [] if only one page.
function paginate(items, page, pageSize, prefix) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = clampedPage * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  if (totalPages <= 1) return { pageItems, controlRow: [], page: clampedPage, totalPages };

  const row = [];
  row.push(clampedPage > 0 ? callback('⬅️ Prev', `${prefix}:page:${clampedPage - 1}`) : callback(' ', 'noop'));
  row.push(callback(`${clampedPage + 1}/${totalPages}`, 'noop'));
  row.push(clampedPage < totalPages - 1 ? callback('Next ➡️', `${prefix}:page:${clampedPage + 1}`) : callback(' ', 'noop'));
  return { pageItems, controlRow: [row], page: clampedPage, totalPages };
}

module.exports = { paginate };
