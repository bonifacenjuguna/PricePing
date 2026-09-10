// Real back-stack navigation, not a flat "back always goes home" shortcut.
// Each screen push records { screen, params } in ctx.session.navStack.
// "Back" pops the stack and re-renders whatever's now on top. "Home" clears
// the stack down to just the home screen. Session is Redis-backed (see
// bot.js's session middleware), so this survives across messages for the
// same user.
const MAX_STACK = 20; // guard against runaway growth from a weird click pattern

function push(ctx, screen, params = {}) {
  if (!ctx.session.navStack) ctx.session.navStack = [];
  const top = ctx.session.navStack[ctx.session.navStack.length - 1];
  // Don't push a duplicate of the current top (e.g. re-rendering the same
  // screen after an in-place edit shouldn't grow the stack).
  if (top && top.screen === screen && JSON.stringify(top.params) === JSON.stringify(params)) return;
  ctx.session.navStack.push({ screen, params });
  if (ctx.session.navStack.length > MAX_STACK) ctx.session.navStack.shift();
}

function pop(ctx) {
  if (!ctx.session.navStack || ctx.session.navStack.length <= 1) return current(ctx); // already at home / empty
  ctx.session.navStack.pop();
  return current(ctx);
}

function current(ctx) {
  if (!ctx.session.navStack || !ctx.session.navStack.length) return { screen: 'home', params: {} };
  return ctx.session.navStack[ctx.session.navStack.length - 1];
}

function reset(ctx) {
  ctx.session.navStack = [{ screen: 'home', params: {} }];
}

module.exports = { push, pop, current, reset };
