const { Markup } = require('telegraf');
const style = require('./buttonStyle');

/**
 * BBTB = "Buttons Below the Typing Bar" = Telegram Reply Keyboards.
 *
 * Rule locked during design: BBTB carries frequent/reusable/low-risk
 * actions. Inline keyboards carry content + destructive/final confirms.
 * Every zone below matches what was agreed on screen-by-screen.
 *
 * Delete Repo's "Yes, Delete" and "Cancel" are never both red — a color
 * only works as a danger signal if it isn't also used for the safe option.
 * Cancel means exactly one thing everywhere — "the safe way out" — so
 * it's green, not red. Since every actual
 * confirm/cancel PAIR lives in inline keyboards (per the rule above),
 * BBTB never has a true "destructive execute" (red) case either — just
 * Cancel (green) and everything else (blue, the default for
 * frequent/low-risk navigation).
 */
const b = (label) => style.text(label, style.BLUE);
const g = (label) => style.text(label, style.GREEN);

const mainMenu = Markup.keyboard([
  [b('📁 My Repos'), b('➕ New Repo')],
  [b('🔍 Search Repo'), b('⚙️ Settings')],
]).resize();

// Stats and Refresh moved to inline (attached to the repo list message
// itself, see inline.repoList) — Stats renders entirely via inline buttons
// already (no BBTB dependency), and Refresh mirrors the same pattern
// Settings' "🔄 Refresh Status" already uses. Frees this down to 2 rows.
const myRepos = Markup.keyboard([
  [b('🔎 Filter'), b('↕️ Sort'), b('➕ New Repo')],
  [b('⭐ Pinned'), b('🧹 Bulk Select'), b('⬆️ Back to Menu')],
]).resize();

const repoView = Markup.keyboard([
  [b('⬆️ Upload'), b('📁 Browse Files'), b('⬇️ Download Repo')],
  [b('🔒 Visibility'), b('⚖️ License'), b('⬅️ Back to Repos')],
  [b('⬆️ Back to Menu')],
]).resize();

const browseFiles = Markup.keyboard([
  [b('⬆️ Upload Here'), b('🔁 Replace Folder'), b('🔍 Search Files')],
  [b('⬆️ Back to Repo')],
]).resize();

// Refresh Status (#48) and Access Log (#47) both relocated off this
// keyboard — Refresh is now an inline button on the Settings message
// itself (chained fresh-message pattern), and Access Log is reachable
// from inside Activity instead of its own Settings row.
// 💾 Export/Import lives inline inside 📦 Storage & Data now (alongside
// 🗑️ Trash) rather than its own BBTB button — this keeps Settings a true
// 2 rows instead of 3.
const settings = Markup.keyboard([
  [b('📜 Activity'), b('🤖 Automation'), b('📦 Storage')],
  [b('🚪 Disconnect'), b('⬆️ Back to Menu')],
]).resize();

const cancelOnly = Markup.keyboard([[g('❌ Cancel')]]).resize();

const cancelWithSkip = Markup.keyboard([
  [b('⏭️ Skip'), g('❌ Cancel')],
]).resize();

const cancelWithBack = Markup.keyboard([
  [b('⬅️ Back'), g('❌ Cancel')],
]).resize();

const uploadSummary = Markup.keyboard([
  [b('📤 Upload Another'), b('⬆️ Back to Repo')],
]).resize();

const searchAgain = Markup.keyboard([
  [b('🔁 Search Again'), b('⬆️ Back to Menu')],
]).resize();

// Refresh relocated to an inline button on the Activity message itself
// (#49, same chained pattern as Settings' Refresh Status).
const activityLog = Markup.keyboard([
  [b('⬆️ Back to Settings')],
]).resize();

const disconnected = Markup.keyboard([
  [b('🔗 Connect GitHub'), b('⚙️ Settings')],
]).resize();

// Refresh relocated to an inline button alongside the pin reorder arrows
// (#50, same reasoning as Activity's Refresh above).
const pinned = Markup.keyboard([
  [b('⬆️ Back to Menu')],
]).resize();

const bulkSelect = Markup.keyboard([
  [b('✅ Done'), g('❌ Cancel'), b('⬆️ Menu')],
]).resize();

const bulkActionMenu = Markup.keyboard([
  [b('◀️ Selection'), g('❌ Cancel'), b('⬆️ Menu')],
]).resize();

const bulkComplete = Markup.keyboard([
  [b('📁 My Repos'), b('⬆️ Menu')],
]).resize();

// 🤖 Automation hub — top level now only holds equal-weight destinations:
// the rules/insights group (everything that used to be 4 separate top-level
// buttons), Scheduled Commits, and Timezone (which Scheduled Commits
// depends on to mean anything). Defaults + Log stay directly reachable
// since they're read/adjusted far more often than any single rule type.
// 🤖 Automation hub — Log moved to inline on the hub message itself (see
// inline.automationHubActions), and Scheduled Commits + Timezone merged
// into one "📅 Schedule" entry (its own intermediate hub, same
// hub-of-hubs shape as 🔧 Rules) — both changes free enough space that
// Defaults fits directly on row one instead of needing its own row.
const automation = Markup.keyboard([
  [b('🔧 Rules'), b('📅 Schedule'), b('⚙️ Defaults')],
  [b('⬆️ Back to Settings')],
]).resize();

// 📅 Schedule — the intermediate hub-of-hubs for Scheduled Commits and
// Timezone (picked via its own inline grid, see inline.scheduleHubMenu).
const automationScheduleHub = Markup.keyboard([
  [b('⬆️ Back to Automation')],
]).resize();

// Scheduled Commits and Timezone both nest one level under 📅 Schedule —
// "Back" targets that intermediate screen now, not Automation directly.
const automationScheduleSub = Markup.keyboard([
  [b('⬆️ Back to Schedule')],
]).resize();

// 🔧 Rules & Insights — the new intermediate hub-of-hubs: Auto-Tag,
// Auto-Mute, Auto-Backup, and Stale Repos all live one level under this
// (picked via its own inline grid, see inline.rulesHubMenu).
const automationRulesHub = Markup.keyboard([
  [b('▶️ Run Rules Now')],
  [b('⬆️ Back to Automation')],
]).resize();

// Auto-Tag Rules / Auto-Mute Rules list screens, one level under Rules &
// Insights — "Back" now targets that intermediate screen, not all the way
// up to the Automation hub, matching the actual nesting depth.
const automationRulesSub = Markup.keyboard([
  [b('▶️ Run Rules Now')],
  [b('⬆️ Back to Rules')],
]).resize();

// Auto-Backup Rules gets its own "Backup Now" instead of the shared "Run
// Rules Now" — see the reasoning where this was first introduced.
const automationBackupRules = Markup.keyboard([
  [b('▶️ Backup Now')],
  [b('⬆️ Back to Rules')],
]).resize();

const backToSettings = Markup.keyboard([
  [b('⬆️ Back to Settings')],
]).resize();

// Nested one level under 🤖 Automation (Defaults, Auto-Tag Rules) — "back"
// from these returns to the Automation hub, not all the way out to
// Settings, matching how Browse Files' "Back to Repo" doesn't jump to Menu.
const backToAutomation = Markup.keyboard([
  [b('⬆️ Back to Automation')],
]).resize();

const remove = Markup.removeKeyboard();

module.exports = {
  mainMenu,
  myRepos,
  repoView,
  browseFiles,
  settings,
  cancelOnly,
  cancelWithSkip,
  cancelWithBack,
  uploadSummary,
  searchAgain,
  activityLog,
  disconnected,
  pinned,
  bulkSelect,
  bulkActionMenu,
  bulkComplete,
  backToSettings,
  backToAutomation,
  automation,
  automationScheduleHub,
  automationScheduleSub,
  automationRulesHub,
  automationRulesSub,
  automationBackupRules,
  remove,
};
