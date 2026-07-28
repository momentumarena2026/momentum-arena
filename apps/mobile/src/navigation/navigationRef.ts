import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

/**
 * Module-level ref to the root navigator.
 *
 * Nested screens can normally just call navigation.navigate() and let the
 * action bubble to a parent that owns the route — but that fails silently
 * when it doesn't (a tap that appears to do nothing, with no error). For
 * root-level destinations reached from deep inside another navigator (the
 * admin shell → the scorer console, for instance) this ref is explicit and
 * can't miss.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateRoot<Name extends keyof RootStackParamList>(
  ...args: undefined extends RootStackParamList[Name]
    ? [screen: Name] | [screen: Name, params: RootStackParamList[Name]]
    : [screen: Name, params: RootStackParamList[Name]]
): void {
  if (!navigationRef.isReady()) return;
  // @ts-expect-error — the tuple spread is correct at every call site but
  // the generic doesn't narrow through the variadic signature.
  navigationRef.navigate(...args);
}
