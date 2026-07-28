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

/**
 * Navigate to a root-stack screen from anywhere.
 *
 * Returns false when it couldn't (container not mounted, or the navigate
 * threw) so the caller can say something instead of leaving the user
 * staring at a button that appears to do nothing — the exact failure mode
 * this helper exists to eliminate.
 */
export function navigateRoot<Name extends keyof RootStackParamList>(
  screen: Name,
  params?: RootStackParamList[Name]
): boolean {
  if (!navigationRef.isReady()) {
    console.warn("[nav] navigateRoot before the container was ready:", screen);
    return false;
  }
  try {
    // @ts-expect-error — params is correctly typed per screen at the call
    // sites; the generic doesn't narrow through the optional parameter.
    navigationRef.navigate(screen, params);
    return true;
  } catch (err) {
    console.warn("[nav] navigateRoot failed:", screen, err);
    return false;
  }
}
