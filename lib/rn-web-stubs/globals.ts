/**
 * The globals Metro injects, which a web bundler does not.
 *
 * React Native code — the framework's own and the app's — reads `__DEV__`
 * freely. Metro defines it at build time; nothing in a Next build does, so
 * the first RN module to evaluate throws `__DEV__ is not defined` and the
 * whole preview renders as a client-side exception with no other clue.
 *
 * IMPORT ORDER IS LOad-BEARING. This must be imported BEFORE anything that
 * reaches React Native. ES module imports evaluate in declaration order, so
 * putting this import first in the preview client is what makes the global
 * exist by the time the screen's module graph runs. Move it below the
 * screen import and the preview breaks in a way that looks unrelated.
 *
 * `false` rather than `true` on purpose: dev mode turns on React Native's
 * own warnings and invariant messages, which would fire against a web
 * renderer that legitimately does not implement every native path. The
 * preview is a production-shaped render of a screen, not a debug session.
 */
declare global {
  // eslint-disable-next-line no-var
  var __DEV__: boolean;
}

if (typeof globalThis.__DEV__ === "undefined") {
  globalThis.__DEV__ = false;
}

export {};
