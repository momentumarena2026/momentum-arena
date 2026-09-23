/**
 * React Navigation, for the admin preview only.
 *
 * The app's challenge screen calls `useRoute()` for its challenge id and
 * `useNavigation()` to leave. Both throw outside a navigator, and standing
 * up a real one on the web would drag in `react-native-screens` — native,
 * and a large amount of machinery to render a screen that is never
 * navigated.
 *
 * So the preview supplies the two hooks directly. The route params come
 * from a context the preview sets per viewpoint; navigation is inert,
 * because the preview is for LOOKING at a screen. Anything that would move
 * the user is a no-op rather than an error: a venue tapping "back" inside a
 * preview should do nothing, not throw a red screen.
 *
 * This shim is the ONLY hand-written stand-in for app behaviour in the
 * preview. Everything else — the screen, its components, its payload, its
 * copy — is the app's own code, which is the point.
 */
"use client";

import { createContext, useContext, type ReactNode } from "react";

export const PreviewRouteContext = createContext<{ params: Record<string, unknown> }>({
  params: {},
});

export function PreviewRoute({
  params,
  children,
}: {
  params: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <PreviewRouteContext.Provider value={{ params }}>{children}</PreviewRouteContext.Provider>
  );
}

export function useRoute() {
  return useContext(PreviewRouteContext);
}

const inertNavigation = {
  navigate: () => undefined,
  goBack: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  setOptions: () => undefined,
  setParams: () => undefined,
  canGoBack: () => false,
  addListener: () => () => undefined,
  removeListener: () => undefined,
  dispatch: () => undefined,
  isFocused: () => true,
  reset: () => undefined,
};

export function useNavigation() {
  return inertNavigation;
}

/** Always focused: a preview is on screen or it is not rendered at all. */
export function useIsFocused() {
  return true;
}

export function useFocusEffect() {
  return undefined;
}

export function NavigationContainer({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const useNavigationState = () => undefined;
export const CommonActions = { navigate: () => undefined, reset: () => undefined };
