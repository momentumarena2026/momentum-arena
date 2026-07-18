import { Easing } from "react-native";

/**
 * Shared motion vocabulary.
 *
 * The app's personality budget is spent here rather than on surface
 * decoration — flat, high-contrast surfaces stay readable outdoors and
 * on cheap panels, so movement is what makes it feel considered. That
 * only works if movement is consistent: three screens easing three
 * different ways reads as sloppiness, not character.
 *
 * Durations are deliberately short. Anything past ~350ms on a phone
 * feels like waiting rather than responding.
 */
export const duration = {
  /** Press feedback, colour and opacity swaps. */
  fast: 140,
  /** The default for anything that moves or resizes. */
  base: 220,
  /** Entrances that need to be read as they arrive (sheets, the nav arc). */
  slow: 340,
} as const;

export const easing = {
  /** Leaving the screen, collapsing, dismissing. Starts quick, settles. */
  in: Easing.in(Easing.cubic),
  /** Arriving without fanfare. The safe default. */
  out: Easing.out(Easing.cubic),
  /**
   * Arriving with a little overshoot. For things the user summoned and
   * should feel responsive — never for things that appear on their own,
   * where bounce reads as noise.
   */
  spring: Easing.out(Easing.back(1.3)),
} as const;

/**
 * Stagger step for lists and fans. Small on purpose: the point is that
 * items arrive in a legible order, not that the sequence is admired.
 */
export const STAGGER_MS = 45;

export type DurationToken = keyof typeof duration;
export type EasingToken = keyof typeof easing;
