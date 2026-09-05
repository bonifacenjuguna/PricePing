/**
 * Shared composable filter-clause engine.
 *
 * One clause shape, two consumers:
 *  - Bulk Actions' filter builder (ephemeral, session-held clause list)
 *  - Saved Views / Smart Folders (persisted as saved_views.filter_json)
 *
 * A clause is { type, value }. All clauses in a list are AND-ed together —
 * OR support is deliberately not built here; it's real added UI complexity
 * (a clause tree instead of a flat list) that wasn't asked for and isn't
 * needed for "repos matching tag X AND private AND stale", which covers
 * the realistic cases. Evaluation is entirely client-side against a repo
 * list already fetched (repoCache.getRepos) plus a tag map — no extra
 * GitHub calls per clause.
 *
 * Supported clause types:
 *   { type: 'visibility', value: 'private' | 'public' }
 *   { type: 'language',   value: 'JavaScript' }
 *   { type: 'stale',      value: <days> }          // updated_at older than N days
 *   { type: 'tag',        value: <tagId> }          // includes nested descendant tags
 *   { type: 'name',       value: '<substring>' }    // case-insensitive contains
 */

const STALE_DEFAULT_DAYS = 180;

function matchesClause(repo, clause, ctx) {
  switch (clause.type) {
    case 'visibility':
      return repo.private === (clause.value === 'private');
    case 'language':
      return (repo.language || '').toLowerCase() === String(clause.value).toLowerCase();
    case 'stale': {
      const days = Number(clause.value) || STALE_DEFAULT_DAYS;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      return new Date(repo.updated_at).getTime() < cutoff;
    }
    case 'tag': {
      const tagRepoNames = ctx.tagRepoNameSets && ctx.tagRepoNameSets[clause.value];
      return !!(tagRepoNames && tagRepoNames.has(repo.name));
    }
    case 'name':
      return repo.name.toLowerCase().includes(String(clause.value).toLowerCase());
    default:
      return true; // unknown clause type — fail open rather than silently excluding everything
  }
}

/**
 * Applies every clause (AND) to a repo list.
 * `ctx.tagRepoNameSets` is a pre-built `{ tagId: Set<repoName> }` map —
 * caller builds this once (via lib/tags.reposWithTag per tag clause
 * present) rather than each clause hitting the DB independently.
 */
function applyClauses(repos, clauses, ctx = {}) {
  if (!clauses || clauses.length === 0) return repos;
  return repos.filter((repo) => clauses.every((c) => matchesClause(repo, c, ctx)));
}

/** Builds the ctx.tagRepoNameSets map for whichever tag clauses are present. */
async function buildTagContext(telegramId, clauses) {
  const tags = require('./tags');
  const tagClauses = clauses.filter((c) => c.type === 'tag');
  const tagRepoNameSets = {};
  for (const c of tagClauses) {
    const names = await tags.reposWithTag(telegramId, Number(c.value));
    tagRepoNameSets[c.value] = new Set(names);
  }
  return { tagRepoNameSets };
}

/** Human-readable one-liner for a clause, used in filter-builder UI and
 * saved-view labels. */
function describeClause(clause, { tagName } = {}) {
  switch (clause.type) {
    case 'visibility': return clause.value === 'private' ? '🔒 Private' : '🌐 Public';
    case 'language': return `💻 ${clause.value}`;
    case 'stale': return `😴 Stale ${clause.value}d+`;
    case 'tag': return `🏷️ ${tagName || clause.value}`;
    case 'name': return `🔤 Name contains "${clause.value}"`;
    default: return String(clause.type);
  }
}

function describeClauses(clauses, tagNameLookup = {}) {
  if (!clauses || clauses.length === 0) return 'No filters';
  return clauses.map((c) => describeClause(c, { tagName: tagNameLookup[c.value] })).join(' AND ');
}

module.exports = { applyClauses, matchesClause, buildTagContext, describeClause, describeClauses, STALE_DEFAULT_DAYS };
