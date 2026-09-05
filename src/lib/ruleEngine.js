/**
 * Shared condition matcher for every rule type in 🤖 Automation — Auto-Tag
 * rules (lib/tags.js) and Auto-Mute rules (lib/automationMuteRules.js) both
 * store the same {field, op, value} shape and both match through here, so
 * "what a rule means" is defined in exactly one place.
 *
 * Rule shapes:
 *   {"field":"language",   "op":"eq",      "value":"Python"}
 *   {"field":"name",       "op":"matches", "value":"api-*"}
 *   {"field":"visibility", "op":"eq",      "value":"private"|"public"}
 *   {"field":"fork",       "op":"eq",      "value":"fork"|"notfork"}
 */
function fieldValueFor(rule, repo) {
  if (rule.field === 'language') return repo.language;
  if (rule.field === 'name') return repo.name;
  if (rule.field === 'visibility') return repo.private ? 'private' : 'public';
  if (rule.field === 'fork') return repo.fork ? 'fork' : 'notfork';
  return undefined;
}

function matchesRule(rule, repo) {
  const fieldValue = fieldValueFor(rule, repo);
  if (fieldValue == null) return false;
  if (rule.op === 'eq') return fieldValue === rule.value;
  if (rule.op === 'matches') {
    const re = new RegExp('^' + rule.value.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    return re.test(fieldValue);
  }
  return false;
}

/** Human-readable one-liner for a rule object (or a null/undefined rule). */
function describeRule(rule) {
  if (!rule) return 'No rule set';
  if (rule.field === 'language') return `💻 Language = ${rule.value}`;
  if (rule.field === 'name') return `📛 Name matches "${rule.value}"`;
  if (rule.field === 'visibility') return `🔒 Visibility = ${rule.value === 'private' ? 'Private' : 'Public'}`;
  if (rule.field === 'fork') return `🍴 ${rule.value === 'fork' ? 'Is a fork' : 'Not a fork'}`;
  return 'Unrecognized rule';
}

module.exports = { matchesRule, describeRule };
