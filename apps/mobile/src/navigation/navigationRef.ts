import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

/**
 * Module-level ref to the root navigator, used by RootNavigator itself
 * (push-tap routing) and available to non-component code.
 *
 * A caution learned from the scorer console: a screen nested several
 * navigators deep — More stack → admin tabs → the AdminShell modal —
 * CANNOT reliably reach a root-stack route with navigation.navigate().
 * The action is supposed to bubble to a parent that owns the route, and
 * when it doesn't the tap simply does nothing: no error, no warning.
 *
 * Prefer registering the destination in the caller's own stack (see
 * AdminScorerConsole in AdminNavigator) over trying to hop navigators.
 * Where a hop is genuinely needed, an explicit getParent() from a known
 * depth — as AccountScreen does — is the dependable form.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
