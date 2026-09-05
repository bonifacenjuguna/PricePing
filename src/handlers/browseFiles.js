const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const config = require('../config');
const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const ephemeral = require('../lib/ephemeral');

const TEXT_EXTENSIONS = new Set([
  // Code
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'py', 'java', 'kt', 'kts',
  'swift', 'dart', 'go', 'rs', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'jl', 'nim', 'lua', 'r', 'pl', 'pm',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'vim', 'm', 'mm',
  // Data / config
  'json', 'jsonc', 'yml', 'yaml', 'xml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'env', 'lock', 'csv', 'tsv', 'sql', 'graphql', 'gql', 'proto',
  // Docs / markup
  'md', 'mdx', 'txt', 'rst', 'tex', 'adoc', 'log', 'diff', 'patch',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg',
  // Misc
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'babelrc', 'eslintrc',
  'prettierrc', 'dockerignore', 'gemfile', 'rakefile', 'podfile', 'ipynb',
]);

// Filenames the extension check alone would miss — no dot, or the dot isn't
// really an extension (Dockerfile, Makefile, and friends).
const TEXT_FILENAMES = new Set([
  'dockerfile', 'makefile', 'rakefile', 'gemfile', 'podfile', 'procfile',
  'license', 'licence', 'readme', 'changelog', 'authors', 'contributing',
  'notice', 'copying', 'vagrantfile', 'brewfile', 'jenkinsfile',
]);

// Raster formats Telegram's sendPhoto actually accepts — SVG is deliberately
// excluded here (it's XML text, not a raster image Telegram can render as a
// photo) and instead flows through the text-preview path above.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const MAX_INLINE_PHOTO_BYTES = 10 * 1024 * 1024; // Telegram's own ceiling for photo uploads

function isTextFile(filename) {
  const base = filename.toLowerCase();
  if (TEXT_FILENAMES.has(base)) return true;
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return TEXT_EXTENSIONS.has(ext);
}

function isImageFile(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return IMAGE_EXTENSIONS.has(ext);
}

/** Renders a Jupyter notebook (.ipynb, which is really just JSON) as a
 * readable cell-by-cell transcript instead of a wall of raw JSON — GitHub
 * renders these specially too, this is the text-mode equivalent. */
function renderNotebookPreview(jsonText) {
  const nb = JSON.parse(jsonText);
  const cells = nb.cells || [];
  if (cells.length === 0) return '(empty notebook)';
  return cells
    .map((c, i) => {
      const src = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
      const label = c.cell_type === 'markdown' ? '📝 Markdown' : c.cell_type === 'code' ? '💻 Code' : '▪️ Cell';
      return `── ${label} [${i + 1}] ──\n${src}`;
    })
    .join('\n\n');
}

/** Builds a one-level directory listing from the full recursive tree */
function listDirectory(tree, dirPath) {
  const prefix = dirPath ? `${dirPath}/` : '';
  const seen = new Map();

  for (const entry of tree) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (!rest) continue;
    const [first, ...remainder] = rest.split('/');
    if (remainder.length === 0) {
      seen.set(first, { name: first, path: entry.path, type: 'blob' });
    } else if (!seen.has(first)) {
      seen.set(first, { name: first, path: `${prefix}${first}`, type: 'tree' });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function showDirectory(ctx, repoName, dirPath = '', page = 1) {
  const token = await requireConnected(ctx);
  if (!token) return;

  ctx.session = ctx.session || {};
  ctx.session.currentBrowseDir = dirPath; // used by "Upload Here" / "Replace Folder" BBTB buttons

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const tree = await github.getTree(token, user.login, repoName);

    if (tree.length === 0) {
      return ctx.reply(
        '📁 This repo is empty — nothing uploaded yet\\.',
        { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard([[style.callback('⬆️ Upload Files', `upload:start:${repoName}`, style.BLUE)]]) }
      );
    }

    const allEntries = listDirectory(tree, dirPath);
    const perPage = config.FILES_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(allEntries.length / perPage));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const entries = allEntries.slice((safePage - 1) * perPage, safePage * perPage);

    let label = dirPath ? `📁 /${dirPath}` : '📁 / (root)';
    if (allEntries.length > perPage) label += ` — ${allEntries.length} items, page ${safePage} of ${totalPages}`;

    await ephemeral.sendEphemeral(ctx, '📁 Browse Files', bbtb.browseFiles);
    await ctx.reply(format.escapeMd(label), {
      parse_mode: 'MarkdownV2',
      ...inline.fileTree(
        entries.map((e) => ({ ...e, type: e.type === 'tree' ? 'tree' : 'blob' })),
        dirPath,
        { page: safePage, totalPages },
        ctx.session.repoUrl || null
      ),
    });
  } catch (err) {
    await ctx.reply(format.errorMessage(
      `Couldn\u2019t load files for "${repoName}"`,
      err.message,
      'Try again, or go back to the repo.'
    ));
  }
}

async function showFileActions(ctx, repoName, filePath) {
  const fileName = filePath.split('/').pop();
  await ctx.reply(
    `📄 *${format.escapeMd(fileName)}*\n📍 \`${format.escapeMd(filePath)}\``,
    { parse_mode: 'MarkdownV2', ...inline.fileActions(filePath) }
  );
}

async function viewFileContent(ctx, repoName, filePath) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const fileName = filePath.split('/').pop();
  // Deep-links straight to GitHub's own file view for whatever this bot
  // can't render inline (PDFs, 3D models, Office docs, etc.) — GitHub can
  // preview far more formats than fit in a Telegram message, so rather
  // than dead-ending on "can't show this", hand off to the real thing.
  const githubUrl = ctx.session.repoUrl ? `${ctx.session.repoUrl}/blob/HEAD/${filePath}` : null;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);

    if (isImageFile(fileName)) {
      const { content, size } = await github.getFileContent(token, user.login, repoName, filePath);
      if (size > MAX_INLINE_PHOTO_BYTES) {
        await ctx.reply(
          format.errorMessage('Image too large to preview inline', `${format.formatBytes(size)} exceeds Telegram's inline photo limit`, 'Use "Send as File" instead, or view it on GitHub.'),
          inline.filePreviewFallback(filePath, githubUrl)
        );
        return;
      }
      await ctx.replyWithPhoto({ source: content, filename: fileName }, { caption: `🖼️ ${fileName}` });
      return;
    }

    if (!isTextFile(fileName)) {
      await ctx.reply(
        format.errorMessage('Can\u2019t preview this file type here', `${fileName} isn\u2019t a format Telegram can render inline`, 'Use "Send as File" to download it, or view it on GitHub.'),
        inline.filePreviewFallback(filePath, githubUrl)
      );
      return;
    }

    const { content: contentBuf, size } = await github.getFileContent(token, user.login, repoName, filePath);
    const raw = contentBuf.toString('utf8'); // safe: isTextFile() already gated this call
    const ext = fileName.toLowerCase().includes('.') ? fileName.toLowerCase().split('.').pop() : '';

    let displayText = raw;
    let renderNote = '';
    if (ext === 'ipynb') {
      try { displayText = renderNotebookPreview(raw); } catch (_) { renderNote = '\n⚠️ Couldn\u2019t parse notebook structure — showing raw JSON\\.'; }
    } else if (ext === 'json' || ext === 'jsonc') {
      try { displayText = JSON.stringify(JSON.parse(raw), null, 2); } catch (_) { /* not valid JSON, fall back to raw */ }
    }

    const lines = displayText.split('\n');
    const preview = lines.slice(0, 40).join('\n');
    const truncated = lines.length > 40;

    let text = `📄 *${format.escapeMd(fileName)}* \\(${format.escapeMd(format.formatBytes(size))}\\)\n\n`;
    text += '```\n' + format.escapeCodeBlock(preview.slice(0, 3500)) + '\n```';
    if (truncated) text += `\n⚠️ Showing first 40 lines only\\. Use "Send as File" for full file\\.`;
    text += renderNote;

    await ctx.reply(text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t load file', err.message, 'Try again.'), inline.filePreviewFallback(filePath, githubUrl));
  }
}

async function sendFileAsDocument(ctx, repoName, filePath) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const fileName = filePath.split('/').pop();
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const { content } = await github.getFileContent(token, user.login, repoName, filePath);
    // content is already the raw file Buffer — sending it as-is preserves
    // byte-for-byte fidelity for binary files (images, PDFs, etc.), unlike
    // routing it through a UTF-8 string first.
    await ctx.replyWithDocument({ source: content, filename: fileName });
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t send file', err.message, 'Try again.'));
  }
}

async function askDeleteFile(ctx, repoName, filePath) {
  await ctx.reply(
    `⚠️ Delete "${format.escapeMd(filePath)}" from ${format.escapeMd(repoName)}\\?\nThis cannot be undone\\.`,
    { parse_mode: 'MarkdownV2', ...inline.deleteFileConfirm(filePath) }
  );
}

async function executeDeleteFile(ctx, repoName, filePath) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'deleteFile', () => _executeDeleteFile(ctx, repoName, filePath));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeDeleteFile(ctx, repoName, filePath) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const { sha } = await github.getFileContent(token, user.login, repoName, filePath);
    await github.deleteFile(token, user.login, repoName, filePath, sha, `Delete ${filePath} via GitroHub`);
    repoCache.invalidateRepos(ctx.from.id);
    repoCache.invalidateLanguages(ctx.from.id, repoName);
    repoCache.invalidateTreeStats(ctx.from.id, repoName);
    await activity.log(ctx.from.id, '🗑', `Deleted file → ${filePath} (${repoName})`);
    await ctx.reply(format.successMessage(`Deleted "${filePath}"`));
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Delete file failed → ${filePath}`, { detail: err.message, isError: true });
    await ctx.reply(format.errorMessage('Couldn\u2019t delete file', err.message, 'Try again.'));
  }
}

async function searchFiles(ctx, repoName, query) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const tree = await github.getTree(token, user.login, repoName);
  const matches = tree.filter((f) => f.path.toLowerCase().includes(query.toLowerCase())).slice(0, 15);

  if (matches.length === 0) {
    return ctx.reply(format.errorMessage(
      `No files matched "${query}"`,
      `checked ${tree.length} files across all folders in ${repoName}`,
      'Check spelling, or browse manually.'
    ));
  }

  let text = `🔍 *File results for "${format.escapeMd(query)}" in ${format.escapeMd(repoName)}* \\(${matches.length} matches\\)\n\n`;
  text += matches.map((m, i) => `${i + 1}\\. 📄 ${format.escapeMd(m.path)}`).join('\n');

  const rows = matches.map((m) => [style.callback(m.path, `browse:file:${m.path}`, style.BLUE)]);

  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

module.exports = {
  showDirectory,
  showFileActions,
  viewFileContent,
  sendFileAsDocument,
  askDeleteFile,
  executeDeleteFile,
  searchFiles,
  isTextFile,
  listDirectory,
};
