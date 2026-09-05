const { Markup } = require('telegraf');
const style = require('./buttonStyle');

/** Repo list — each repo is its own tappable row, plus pagination + filter/sort labels */
function repoList(repos, page, totalPages, filterLabel, sortLabel) {
  const rows = repos.map((r) => [style.callback(`📦 ${r.name}`, `repo:${r.name}`, style.BLUE)]);
  const pagination = [];
  if (page > 1) pagination.push(style.callback('⬅️ Prev', `repos:page:${page - 1}`, style.BLUE));
  if (page < totalPages) pagination.push(style.callback('Next ➡️', `repos:page:${page + 1}`, style.BLUE));
  if (pagination.length) rows.push(pagination);
  rows.push([style.callback('🔄 Refresh', 'repos:refresh', style.BLUE), style.callback('📊 Stats', 'repos:stats', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

const filterMenu = Markup.inlineKeyboard([
  [style.callback('All', 'filter:all'), style.callback('🌐 Public', 'filter:public')],
  [style.callback('🔒 Private', 'filter:private'), style.callback('🍴 Forks', 'filter:forks')],
  [style.callback('⚖️ Has License', 'filter:haslicense'), style.callback('🚫 No License', 'filter:nolicense')],
  [style.callback('🏷️ By Tag ▾', 'filter:tagmenu'), style.callback('💻 By Language ▾', 'filter:langmenu')],
  [style.callback('⬅️ Back', 'repos:back', style.BLUE)],
]);

const sortMenu = Markup.inlineKeyboard([
  [style.callback('🕒 Recently Updated', 'sort:updated')],
  [style.callback('🔤 Name (A-Z)', 'sort:name')],
  [style.callback('⭐ Most Stars', 'sort:stars')],
  [style.callback('📅 Recently Created', 'sort:created')],
  [style.callback('💻 Dominant Language (A-Z)', 'sort:language')],
  [style.callback('⬅️ Back', 'repos:back', style.BLUE)],
]);

/** Repo View info card — Rename, Pin/Unpin, Tags stay inline; Delete Repo is the destructive one */
function repoActions(repoName, pinned = false, repoUrl, webhookState = 'none', hasReadme = false) {
  const rows = [
    [
      style.callback('✏️ Rename', `repo:rename:${repoName}`, style.BLUE),
      style.callback('✏️ Description', `repo:description:${repoName}`, style.BLUE),
    ],
    [
      style.callback(pinned ? '📌 Unpin' : '📌 Pin', `repo:pin:${repoName}`),
      style.callback('🏷️ Tags', `repo:tags:${repoName}`, style.BLUE),
    ],
    // Clone URL is informational, not navigation — stays colorless (#3).
    // Open in Browser genuinely leaves the bot for github.com, so it's
    // navigation like everything else in that tier (#13).
    [style.callback('📋 Clone URL', `repo:cloneurl:${repoName}`), style.callback('📄 Export JSON', `repo:export:${repoName}`)],
  ];
  if (hasReadme) rows.push([style.callback('📖 Send Full README', `repo:readme:${repoName}`)]);
  if (repoUrl) rows.push([style.url('🔗 Open in Browser', repoUrl, style.BLUE)]);
  // Live notifications toggle — a settings-style adjustment, colorless
  // like every other toggle (Pin, Notifications), not a navigation action.
  if (webhookState === 'none') {
    rows.push([style.callback('🔔 Enable Live Alerts', `repo:webhook:enable:${repoName}`)]);
  } else {
    rows.push([style.callback(webhookState === 'muted' ? '🔔 Unmute Alerts' : '🔕 Mute Alerts', `repo:webhook:toggle:${repoName}`)]);
  }
  rows.push([style.callback('🗑 Delete Repo', `repo:delete:${repoName}`, style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function deleteRepoConfirm(repoName) {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Delete', `repo:delete:confirm:${repoName}`, style.RED)],
    [style.callback('❌ Cancel', `repo:delete:cancel:${repoName}`, style.GREEN)],
  ]);
}

function visibilityConfirm(repoName, currentlyPrivate) {
  const label = currentlyPrivate ? '🌐 Switch to Public' : '🔒 Switch to Private';
  return Markup.inlineKeyboard([
    [style.callback(label, `repo:visibility:confirm:${repoName}`, style.BLUE)],
    [style.callback('❌ Cancel', `repo:visibility:cancel:${repoName}`, style.BLUE)],
  ]);
}

const createRepoVisibility = Markup.inlineKeyboard([
  [style.callback('🔒 Private', 'create:visibility:private')],
  [style.callback('🌐 Public', 'create:visibility:public')],
]);

const createRepoConfirm = Markup.inlineKeyboard([
  [style.callback('✅ Create Now', 'create:confirm', style.GREEN)],
  [style.callback('📅 Schedule for Later', 'createrepo:schedule', style.BLUE)],
  [style.callback('❌ Cancel', 'create:cancel', style.RED)],
]);

const cancelConfirm = (scenePrefix) => Markup.inlineKeyboard([
  [style.callback('✅ Yes, Cancel', `${scenePrefix}:cancel:confirm`, style.RED)],
  [style.callback('⬅️ No, Go Back', `${scenePrefix}:cancel:abort`, style.GREEN)],
]);

function createRepoSuccess(repoName) {
  return Markup.inlineKeyboard([
    [style.callback('📦 Open Repo', `repo:${repoName}`, style.BLUE)],
    [style.callback('⬆️ Upload Files', `upload:start:${repoName}`, style.BLUE)],
  ]);
}

/** File/folder tree navigator — folders and files both rendered as rows */
/** Folder/file tree navigator — folders and files rendered as rows, with pagination for large folders */
function fileTree(entries, currentPath, pagination = null, repoUrl = null) {
  const rows = entries.map((e) => {
    const label = e.type === 'tree' ? `📁 ${e.name}/` : `📄 ${e.name}`;
    const action = e.type === 'tree' ? `browse:dir:${e.path}` : `browse:file:${e.path}`;
    return [style.callback(label, action, style.BLUE)];
  });

  if (pagination && pagination.totalPages > 1) {
    const nav = [];
    if (pagination.page > 1) nav.push(style.callback('⬅️ Prev', `browse:dirpage:${pagination.page - 1}:${currentPath}`, style.BLUE));
    if (pagination.page < pagination.totalPages) nav.push(style.callback('Next ➡️', `browse:dirpage:${pagination.page + 1}:${currentPath}`, style.BLUE));
    if (nav.length) rows.push(nav);
  }

  if (currentPath) {
    const parent = currentPath.split('/').slice(0, -1).join('/');
    rows.push([style.callback('⬅️ Up One Level', `browse:dir:${parent}`, style.BLUE)]);
  }
  // #13 — Open in Browser fallback, same reasoning as Repo View's version
  if (repoUrl) {
    const ghPath = currentPath ? `${repoUrl}/tree/HEAD/${currentPath}` : repoUrl;
    rows.push([style.url('🔗 Open in Browser', ghPath, style.BLUE)]);
  }
  return Markup.inlineKeyboard(rows);
}

function fileActions(path) {
  return Markup.inlineKeyboard([
    [style.callback('👁 View Content', `file:view:${path}`, style.BLUE), style.callback('📥 Send as File', `file:raw:${path}`, style.BLUE)],
    [style.callback('✏️ Edit', `file:edit:${path}`, style.BLUE), style.callback('🔁 Replace', `file:replace:${path}`, style.BLUE)],
    [style.callback('🗑 Delete File', `file:delete:${path}`, style.BLUE)],
    [style.callback('⬅️ Back to Folder', `browse:parent:${path}`, style.BLUE)],
  ]);
}

/** Fallback shown when a file can't be rendered inline — always offers the
 * raw download, and a direct link to GitHub's own (much broader) preview
 * support when we know the repo's URL for this session. */
function filePreviewFallback(path, githubUrl) {
  const rows = [[style.callback('📥 Send as File', `file:raw:${path}`, style.BLUE)]];
  if (githubUrl) rows.push([style.url('🌐 View on GitHub', githubUrl, style.BLUE)]);
  rows.push([style.callback('⬅️ Back', `browse:parent:${path}`, style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function deleteFileConfirm(path) {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Delete', `file:delete:confirm:${path}`, style.RED)],
    [style.callback('❌ Cancel', `file:delete:cancel:${path}`, style.GREEN)],
  ]);
}

function uploadPathChoice() {
  return Markup.inlineKeyboard([
    [style.callback('📁 Browse Folders', 'upload:choose:browse', style.BLUE)],
    [style.callback('📍 Root Directory', 'upload:choose:root', style.BLUE)],
  ]);
}

function uploadSummaryConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('📋 View File List', 'upload:summary:list')],
    [style.callback('✅ Commit Changes', 'upload:commit', style.GREEN), style.callback('❌ Cancel', 'upload:cancel', style.RED)],
  ]);
}

function externalRepoActions() {
  return Markup.inlineKeyboard([
    [style.callback('⬇️ Download as ZIP', 'external:download', style.BLUE)],
    [style.callback('🍴 Fork to My Account', 'external:fork', style.BLUE)],
    [Markup.button.url('🔗 View on GitHub', '{{url}}')], // url patched by caller
    [style.callback('⬅️ Cancel', 'external:cancel', style.BLUE)],
  ]);
}

function forkConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('✅ Confirm Fork', 'external:fork:confirm', style.GREEN)],
    [style.callback('❌ Cancel', 'external:fork:cancel', style.RED)],
  ]);
}

function notificationsMenu(prefs) {
  const check = (b) => (b ? '✅' : '⬜');
  const rollupLabel = { off: '⬜ Off', daily: '☀️ Daily', weekly: '🗓️ Weekly' }[prefs.rollup || 'off'];
  const quietLabel = (prefs.quietStart != null && prefs.quietEnd != null)
    ? `🌙 ${String(prefs.quietStart).padStart(2, '0')}:00–${String(prefs.quietEnd).padStart(2, '0')}:00 UTC`
    : '🌙 Off';
  return Markup.inlineKeyboard([
    [style.callback(`${check(prefs.githubActivity)} GitHub Activity`, 'notif:toggle:githubActivity')],
    [style.callback(`${check(prefs.systemAlerts)} System Alerts`, 'notif:toggle:systemAlerts')],
    [style.callback(`${check(prefs.longOps)} Long Operations`, 'notif:toggle:longOps')],
    [style.callback(`${check(prefs.tokenHealth)} Token Health`, 'notif:toggle:tokenHealth')],
    [style.callback(`${check(prefs.staleNudge)} Stale Repo Nudge (weekly)`, 'notif:toggle:staleNudge')],
    // Daily/weekly rollup summary + quiet hours cycle on tap rather than
    // a separate picker screen — keeps this one flat menu.
    [style.callback(`Rollup: ${rollupLabel}`, 'notif:cyclerollup')],
    [style.callback(`Quiet Hours: ${quietLabel}`, 'notif:setquiet')],
    [style.callback('⬅️ Back', 'settings:back', style.BLUE)],
  ]);
}

function disconnectConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Disconnect', 'settings:disconnect:confirm', style.RED)],
    [style.callback('❌ Cancel', 'settings:disconnect:cancel', style.GREEN)],
  ]);
}

/** 🔧 Rules & Insights — the 2x2 grid of everything grouped under here.
 * Exploiting inline here rather than more BBTB rows, per the redesign:
 * these are content destinations picked once per visit, not frequent
 * actions that deserve permanent thumb-reach real estate. */
/** 🤖 Automation hub content — Log moved here from BBTB, paired with a
 * Refresh action so the live stats in the hub text (active rule counts,
 * queued schedule count, last-run time) can be updated without
 * re-navigating. Same edit-in-place pattern as My Repos' inline Refresh. */
function automationHubActions() {
  return Markup.inlineKeyboard([
    [
      style.callback('📜 Log', 'automation:log', style.BLUE),
      style.callback('🔄 Refresh', 'automation:refresh', style.BLUE),
    ],
  ]);
}

/** 📅 Schedule — the 2-option grid for its hub-of-hubs (Scheduled Commits
 * and Timezone), same shape as 🔧 Rules' own grid. */
function scheduleHubMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('📅 Scheduled Commits', 'automation:scheduledcommits', style.BLUE),
      style.callback('🌍 Timezone', 'automation:timezone', style.BLUE),
    ],
    [style.callback('⬅️ Back', 'automation:hub', style.BLUE)],
  ]);
}

function rulesHubMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('🏷️ Auto-Tag', 'automation:tagrules', style.BLUE),
      style.callback('🔕 Auto-Mute', 'automation:muterules', style.BLUE),
    ],
    [
      style.callback('💾 Auto-Backup', 'automation:backuprules', style.BLUE),
      style.callback('🗂️ Stale Repos', 'automation:stalerepos', style.BLUE),
    ],
    [style.callback('⬅️ Back', 'automation:hub', style.BLUE)],
  ]);
}

/** 🏷️ Auto-Tag Rules list — one row per tag, ⚡ = rule active / ➖ = none.
 * Run Rules Now moved to BBTB (it's a frequent, low-risk action — belongs
 * there, not competing for space with the content below it). */
function autoTagRulesMenu(userTags) {
  const rows = userTags.map((t) => [
    style.callback(`${t.auto_rule_json ? '⚡' : '➖'} ${t.emoji} ${t.name}`, `automation:rule:edit:${t.id}`),
  ]);
  rows.push([style.callback('⬅️ Back', 'automation:ruleshub', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

/** Field picker for one tag's rule — 2x2, condition types are equal-weight
 * picks, not a sequence. Clear Rule only shown once a rule already exists,
 * and stays colorless: removing a rule is reversible and low-stakes, not
 * in the same tier as Delete Repo/File. */
function ruleFieldMenu(tagId, hasRule) {
  const rows = [
    [
      style.callback('💻 Language', `automation:rule:field:${tagId}:language`),
      style.callback('📛 Name', `automation:rule:field:${tagId}:name`),
    ],
    [
      style.callback('🔒 Visibility', `automation:rule:field:${tagId}:visibility`),
      style.callback('🍴 Fork', `automation:rule:field:${tagId}:fork`),
    ],
  ];
  if (hasRule) rows.push([style.callback('🗑 Clear Rule', `automation:rule:clear:${tagId}`)]);
  rows.push([style.callback('⬅️ Back', 'automation:tagrules', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function ruleVisibilityMenu(tagId) {
  return Markup.inlineKeyboard([
    [
      style.callback('🔒 Private', `automation:rule:setvisibility:${tagId}:private`),
      style.callback('🌐 Public', `automation:rule:setvisibility:${tagId}:public`),
    ],
    [style.callback('⬅️ Back', `automation:rule:edit:${tagId}`, style.BLUE)],
  ]);
}

function ruleForkMenu(tagId) {
  return Markup.inlineKeyboard([
    [
      style.callback('🍴 Is a Fork', `automation:rule:setfork:${tagId}:fork`),
      style.callback('🌱 Not a Fork', `automation:rule:setfork:${tagId}:notfork`),
    ],
    [style.callback('⬅️ Back', `automation:rule:edit:${tagId}`, style.BLUE)],
  ]);
}

/** One-tap suggestion offered inline on Repo View when an auto-tag rule
 * matches a repo that doesn't have that tag yet — colorless (a value pick,
 * same tier as any other suggestion), with an explicit Dismiss so it
 * doesn't feel like it's demanding an answer. */
function autoTagSuggestion(repoName, tagId) {
  return Markup.inlineKeyboard([
    [
      style.callback('✅ Apply', `automation:applysuggested:${repoName}:${tagId}`),
      style.callback('➖ Dismiss', 'automation:dismisssuggested'),
    ],
  ]);
}

/** 🔕 Auto-Mute rules list — each rule's description lives in the message
 * text (numbered), buttons are purely actions: delete #N, add, back. A
 * button whose only job was to display text with no real tap behavior
 * isn't a real button, so descriptions never become tappable labels here. */
function muteRulesMenu(rules) {
  const rows = rules.map((r, i) => [style.callback(`🗑 Delete #${i + 1}`, `automation:mute:delete:${r.id}`)]);
  rows.push([style.callback('➕ Add Rule', 'automation:mute:add', style.BLUE)]);
  rows.push([style.callback('⬅️ Back', 'automation:ruleshub', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function muteRuleFieldMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('💻 Language', 'automation:mute:field:language'),
      style.callback('📛 Name', 'automation:mute:field:name'),
    ],
    [
      style.callback('🔒 Visibility', 'automation:mute:field:visibility'),
      style.callback('🍴 Fork', 'automation:mute:field:fork'),
    ],
    [style.callback('⬅️ Back', 'automation:muterules', style.BLUE)],
  ]);
}

function muteRuleVisibilityMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('🔒 Private', 'automation:mute:setvisibility:private'),
      style.callback('🌐 Public', 'automation:mute:setvisibility:public'),
    ],
    [style.callback('⬅️ Back', 'automation:mute:add', style.BLUE)],
  ]);
}

function muteRuleForkMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('🍴 Is a Fork', 'automation:mute:setfork:fork'),
      style.callback('🌱 Not a Fork', 'automation:mute:setfork:notfork'),
    ],
    [style.callback('⬅️ Back', 'automation:mute:add', style.BLUE)],
  ]);
}

/** 💾 Auto-Backup rules list — same shape as Auto-Mute's list. */
function backupRulesMenu(rules) {
  const rows = rules.map((r, i) => [style.callback(`🗑 Delete #${i + 1}`, `automation:backup:delete:${r.id}`)]);
  rows.push([style.callback('➕ Add Rule', 'automation:backup:add', style.BLUE)]);
  rows.push([style.callback('⬅️ Back', 'automation:ruleshub', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function backupRuleFieldMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('💻 Language', 'automation:backup:field:language'),
      style.callback('📛 Name', 'automation:backup:field:name'),
    ],
    [
      style.callback('🔒 Visibility', 'automation:backup:field:visibility'),
      style.callback('🍴 Fork', 'automation:backup:field:fork'),
    ],
    [style.callback('⬅️ Back', 'automation:backuprules', style.BLUE)],
  ]);
}

function backupRuleVisibilityMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('🔒 Private', 'automation:backup:setvisibility:private'),
      style.callback('🌐 Public', 'automation:backup:setvisibility:public'),
    ],
    [style.callback('⬅️ Back', 'automation:backup:add', style.BLUE)],
  ]);
}

function backupRuleForkMenu() {
  return Markup.inlineKeyboard([
    [
      style.callback('🍴 Is a Fork', 'automation:backup:setfork:fork'),
      style.callback('🌱 Not a Fork', 'automation:backup:setfork:notfork'),
    ],
    [style.callback('⬅️ Back', 'automation:backup:add', style.BLUE)],
  ]);
}

/** 🗂️ Stale Repos — each repo reuses the exact same 'repo:<name>' callback
 * My Repos' own list uses, so tapping one opens the real Repo View. */
function staleReposMenu(repos) {
  const rows = repos.map((r) => [
    style.callback(`📦 ${r.name} — ${r.staleLabel}`, `repo:${r.name}`, style.BLUE),
  ]);
  rows.push([style.callback('⬅️ Back', 'automation:ruleshub', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function automationLogPagination(page, totalPages) {
  const rows = [];
  const nav = [];
  if (page > 1) nav.push(style.callback('⬅️ Prev', `automation:log:page:${page - 1}`, style.BLUE));
  if (page < totalPages) nav.push(style.callback('Next ➡️', `automation:log:page:${page + 1}`, style.BLUE));
  if (nav.length) rows.push(nav);
  rows.push([style.callback('⬅️ Back to Automation', 'automation:hub', style.BLUE)]);
  return Markup.inlineKeyboard(rows);
}

function connectButton(url) {
  return Markup.inlineKeyboard([[Markup.button.url('🔗 Connect GitHub Account', url)]]);
}

/** 💾 Export/Import — the two actions plus Back, no reason for more than
 * one row here. */
function exportImportMenu() {
  return Markup.inlineKeyboard([
    [style.callback('⬇️ Export Settings', 'exportimport:export', style.BLUE)],
    [style.callback('⬆️ Import Settings', 'exportimport:import', style.BLUE)],
    [style.callback('⬅️ Back', 'storage:back', style.BLUE)],
  ]);
}

/** Import is the one genuinely destructive part of this feature (it
 * overwrites Defaults + Notification prefs outright) so it gets the same
 * explicit-confirm treatment as Delete Repo/File — RED for the same reason. */
function importConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Import', 'exportimport:import:confirm', style.RED)],
    [style.callback('❌ Cancel', 'exportimport:import:cancel', style.GREEN)],
  ]);
}

function activityPagination(page, totalPages, errorsOnly) {
  const rows = [];
  const nav = [];
  if (page > 1) nav.push(style.callback('⬅️ Prev', `activity:page:${page - 1}:${errorsOnly}`, style.BLUE));
  if (page < totalPages) nav.push(style.callback('Next ➡️', `activity:page:${page + 1}:${errorsOnly}`, style.BLUE));
  if (nav.length) rows.push(nav);
  rows.push([
    style.callback(errorsOnly ? '⬅️ Back to Full Log' : '⚠️ Errors Only', `activity:filter:${!errorsOnly}`),
  ]);
  // Access Log lives here, reachable from inside Activity rather than its
  // own Settings row. Refresh uses the same chained-fresh-message pattern
  // as Settings' Refresh Status, and lives here instead of its own BBTB
  // row to avoid colliding with My Repos' Refresh button.
  rows.push([
    style.callback('🔑 Access Log', 'activity:accesslog', style.BLUE),
    style.callback('🔄 Refresh', `activity:refresh:${errorsOnly}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

/** Two explicit search entry points instead of one box that guesses intent
 * from the input (fuzzy name vs pasted URL). */
function searchTypeMenu() {
  return Markup.inlineKeyboard([
    [style.callback('📁 My Repos', 'search:type:myrepos', style.BLUE)],
    [style.callback('🌐 Public Repo', 'search:type:public', style.BLUE)],
  ]);
}

module.exports = {
  repoList,
  filterMenu,
  sortMenu,
  repoActions,
  deleteRepoConfirm,
  visibilityConfirm,
  createRepoVisibility,
  createRepoConfirm,
  cancelConfirm,
  createRepoSuccess,
  fileTree,
  fileActions,
  filePreviewFallback,
  deleteFileConfirm,
  uploadPathChoice,
  uploadSummaryConfirm,
  externalRepoActions,
  forkConfirm,
  notificationsMenu,
  disconnectConfirm,
  connectButton,
  activityPagination,
  searchTypeMenu,
  autoTagRulesMenu,
  ruleFieldMenu,
  ruleVisibilityMenu,
  ruleForkMenu,
  autoTagSuggestion,
  muteRulesMenu,
  muteRuleFieldMenu,
  muteRuleVisibilityMenu,
  muteRuleForkMenu,
  backupRulesMenu,
  backupRuleFieldMenu,
  backupRuleVisibilityMenu,
  backupRuleForkMenu,
  staleReposMenu,
  automationLogPagination,
  exportImportMenu,
  importConfirm,
  rulesHubMenu,
  automationHubActions,
  scheduleHubMenu,
};
