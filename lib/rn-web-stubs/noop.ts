/**
 * A native module the admin preview does not need.
 *
 * The preview renders the app's real challenge screen in the browser so the
 * venue sees exactly what a captain sees. Some of that screen's import
 * graph reaches native bridges — messaging, the keychain — which have no
 * web build and nothing to do with looking at a challenge.
 *
 * Stubbed rather than removed from the app: the app needs them, and the
 * whole point of the preview is that it runs the SAME code. A stub keeps
 * one component serving both.
 *
 * Deliberately loud if anything actually calls it. A silent no-op here
 * would let the preview quietly diverge from the app — which is the one
 * thing this whole arrangement exists to prevent.
 */
function refuse(name: string): never {
  throw new Error(
    `[preview] ${name} is a native module and cannot run in the admin preview. ` +
      `The preview is for LOOKING at a screen, not driving it. If the challenge ` +
      `screen now needs this at render time, that is a real change — give it a ` +
      `web implementation rather than widening this stub.`,
  );
}

const handler: ProxyHandler<Record<string, unknown>> = {
  get(_t, prop) {
    if (prop === "__esModule") return true;
    if (prop === "default") return new Proxy({}, handler);
    // Lifecycle hooks the app calls at import time must not throw, or the
    // module graph dies before anything renders.
    if (prop === "then") return undefined;
    return () => refuse(String(prop));
  },
};

const stub = new Proxy({}, handler);
export default stub;
