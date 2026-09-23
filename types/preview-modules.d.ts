/**
 * The app's own modules, as the WEB project is allowed to see them.
 *
 * The admin challenge preview renders `apps/mobile`'s real screen. It must
 * not type-check it here, for a reason that is not stylistic: loading React
 * Native's types declares its own global `FormData` and `fetch`, which
 * REPLACE the DOM's. The moment they enter this program, `formData.get()`
 * stops existing across every API route in this app — it broke four upload
 * routes the first time — and the mobile project's own error baseline
 * starts showing up in the web typecheck, conflating two codebases.
 *
 * Excluding the files does not work: Next generates route-type validators
 * under `.next/types` that import every page, so the preview gets pulled
 * back in no matter what `exclude` says. The boundary has to be at the
 * IMPORT, not at the file list.
 *
 * So the preview imports these specifiers, which resolve here for types and
 * — via `resolveAlias` in next.config.ts — to the real app files for the
 * bundle. The declarations are deliberately minimal: a component with no
 * props and a context. There is no logic here to drift, because there is no
 * logic here at all. The screen itself is type-checked by `apps/mobile`,
 * against real React Native types, which is where that code lives.
 *
 * These two declarations and the aliases in next.config.ts are a pair.
 * Change one without the other and you get either a preview that
 * type-checks against nothing, or a build that cannot resolve the import.
 */
declare module "@preview/challenge-screen" {
  export function ChallengeDetailScreen(): React.ReactElement;
}

declare module "@preview/auth-context" {
  import type { Context } from "react";
  export const AuthContext: Context<unknown>;
}

/**
 * Also opaque, and for exactly the same reason: this package's own types
 * import `react-native`, so importing it directly would drag the global
 * declarations in through the side door and undo everything above. Anything
 * the preview needs from the React Native ecosystem comes through a
 * `@preview/*` specifier, so there is one place to look for what has been
 * bridged.
 */
declare module "@preview/safe-area" {
  import type { ReactNode } from "react";
  export function SafeAreaProvider(props: {
    children?: ReactNode;
    initialMetrics?: {
      frame: { x: number; y: number; width: number; height: number };
      insets: { top: number; left: number; right: number; bottom: number };
    };
  }): React.ReactElement;
}
