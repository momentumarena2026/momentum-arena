import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StatusBar,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import Svg, {
  Circle,
  Defs,
  RadialGradient as SvgRadialGradient,
  Stop,
} from "react-native-svg";
import { Text } from "../../components/ui/Text";
import { colors, spacing } from "../../theme";

const LOGO: ImageSourcePropType = require("../../assets/momentum-icon.png");

interface Props {
  /**
   * Called once the splash sequence has fully played out and faded.
   * The host (App.tsx) swaps from <SplashScreen/> to <RootNavigator/>
   * the moment this fires. Total runtime ≈ 2.6s.
   */
  onComplete: () => void;
}

/**
 * Sports the venue offers — these are the same three sports the rest
 * of the app gates on (Sport = "CRICKET" | "FOOTBALL" | "PICKLEBALL").
 * Emojis here so we don't have to wrangle SVG sport icons that lucide
 * doesn't ship for cricket / pickleball. Each emoji gets its own
 * resting position around the logo plus a subtle float loop.
 */
type SportToken = {
  emoji: string;
  /** Resting offset relative to the logo centre, in pixels. */
  x: number;
  y: number;
  /** Stagger so the icons don't all land at the same instant. */
  delay: number;
};

const SPORTS: SportToken[] = [
  { emoji: "\u{1F3CF}", x: -110, y: -40, delay: 250 }, // cricket bat & ball
  { emoji: "⚽️", x: 110, y: -40, delay: 400 }, // football
  { emoji: "\u{1F3D3}", x: 0, y: 130, delay: 550 }, // ping-pong paddle (stand-in for pickleball)
];

const LOGO_SIZE = 132;
const SPORT_SIZE = 44;
// Larger than the logo so the radial gradient has room to fade
// fully to transparent before the SVG canvas edge clips it. Without
// this padding the gradient's outermost ring would still be partly
// opaque when it hits the canvas boundary, putting the hard edge
// back in.
const GLOW_SIZE = 320;

export function SplashScreen({ onComplete }: Props) {
  // ---- Logo ------------------------------------------------------
  // Scale 0.4 → 1.0 with a soft overshoot, opacity 0 → 1. Using
  // RN's built-in Animated API for parity with HomeScreen's existing
  // animations (no reanimated worklets required for a one-shot
  // intro like this).
  const logoScale = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoFloat = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  // ---- Sport icons ----------------------------------------------
  // Each icon gets translateY (drops in from 30px above its resting
  // position with a bounce), opacity (fade in), and a float loop
  // (idle bobbing once landed). translateY starts at `token.y - 30`
  // and animates to `token.y` so we can compose it directly with
  // the float loop via Animated.add — no extra static-offset Value
  // baked in at render time.
  const sportTransforms = useRef(
    SPORTS.map((token) => ({
      translateY: new Animated.Value(token.y - 30),
      opacity: new Animated.Value(0),
      float: new Animated.Value(0),
    })),
  ).current;

  // ---- Wordmark --------------------------------------------------
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkTranslate = useRef(new Animated.Value(12)).current;

  // ---- Whole-screen fade-out ------------------------------------
  // After the intro plays we ramp this from 1 → 0 to crossfade into
  // the real navigator. Avoids a hard cut.
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Logo entrance — bouncy spring + simultaneous opacity ramp.
    const logoIn = Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    // Sport icons — each drops in with its own delay so the eye can
    // track them landing one after the other.
    const sportsIn = Animated.stagger(
      0,
      sportTransforms.map((t, i) =>
        Animated.parallel([
          Animated.timing(t.translateY, {
            toValue: SPORTS[i].y, // resting position around logo
            duration: 600,
            delay: SPORTS[i].delay,
            easing: Easing.out(Easing.back(1.6)),
            useNativeDriver: true,
          }),
          Animated.timing(t.opacity, {
            toValue: 1,
            duration: 400,
            delay: SPORTS[i].delay,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    // Wordmark — slides up + fades in once the icons have settled.
    const wordmarkIn = Animated.parallel([
      Animated.timing(wordmarkOpacity, {
        toValue: 1,
        duration: 500,
        delay: 850,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(wordmarkTranslate, {
        toValue: 0,
        duration: 500,
        delay: 850,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    // Soft emerald glow behind the logo — pulses once after entry to
    // give the still frame some life before the fade-out.
    const glowPulse = Animated.sequence([
      Animated.delay(700),
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0.55,
        duration: 600,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    // Idle float loops — kicked off after the entrance, run until
    // the screen fades. Each sport icon bobs at its own rate; the
    // logo also drifts a touch on the y-axis.
    const startIdleLoops = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(logoFloat, {
            toValue: -6,
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(logoFloat, {
            toValue: 0,
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ).start();

      sportTransforms.forEach((t, i) => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(t.float, {
              toValue: -8,
              duration: 1100 + i * 90,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(t.float, {
              toValue: 0,
              duration: 1100 + i * 90,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ).start();
      });
    };

    Animated.parallel([logoIn, sportsIn, wordmarkIn, glowPulse]).start(
      ({ finished }) => {
        if (!finished) return;
        startIdleLoops();
      },
    );

    // Hold the assembled scene briefly, then crossfade out and tell
    // the host to swap to the real navigator.
    const handoff = setTimeout(() => {
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 350,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        onComplete();
      });
    }, 2300);

    return () => clearTimeout(handoff);
  }, [
    logoScale,
    logoOpacity,
    logoFloat,
    glowOpacity,
    wordmarkOpacity,
    wordmarkTranslate,
    sportTransforms,
    screenOpacity,
    onComplete,
  ]);

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Subtle radial-ish gradient using a vertical linear-gradient.
          Keeps the screen pure-black at the top/bottom and adds a
          faint emerald wash through the middle so the centred logo
          feels lit rather than floating in a void. */}
      <LinearGradient
        colors={[
          "#000000",
          "rgba(16, 185, 129, 0.10)",
          "#000000",
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.stage}>
        {/* Pulsing emerald glow behind the logo. Rendered as an SVG
            circle filled with a radial gradient that fades to fully
            transparent at the edge — RN's `View` + `borderRadius` +
            `shadow` can't produce a true soft falloff, so the
            previous implementation had a visible hard edge where the
            translucent fill met the black background. The gradient
            stops here mirror HomeScreen's emerald orb. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              opacity: glowOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
            <Defs>
              <SvgRadialGradient id="splashGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#10b981" stopOpacity="0.45" />
                <Stop offset="0.45" stopColor="#10b981" stopOpacity="0.18" />
                <Stop offset="1" stopColor="#10b981" stopOpacity="0" />
              </SvgRadialGradient>
            </Defs>
            <Circle cx="50%" cy="50%" r="50%" fill="url(#splashGlow)" />
          </Svg>
        </Animated.View>

        {/* Sport icons sit at fixed offsets around the logo. translateY
            already encodes the resting position (it animates from
            `token.y - 30` to `token.y` on entry); the float loop is
            added on top for idle bobbing. */}
        {SPORTS.map((token, i) => {
          const t = sportTransforms[i];
          return (
            <Animated.View
              key={token.emoji}
              style={[
                styles.sportToken,
                {
                  transform: [
                    { translateX: token.x },
                    { translateY: Animated.add(t.translateY, t.float) },
                  ],
                  opacity: t.opacity,
                },
              ]}
            >
              <Text style={styles.sportEmoji}>{token.emoji}</Text>
            </Animated.View>
          );
        })}

        {/* The logo itself. */}
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }, { translateY: logoFloat }],
          }}
        >
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </Animated.View>
      </View>

      {/* Wordmark below the logo. */}
      <Animated.View
        style={[
          styles.wordmark,
          {
            opacity: wordmarkOpacity,
            transform: [{ translateY: wordmarkTranslate }],
          },
        ]}
      >
        <Text variant="heading" weight="800" style={styles.wordmarkText}>
          Momentum Arena
        </Text>
        <Text variant="small" color={colors.emerald400} style={styles.tagline}>
          Play. Compete. Belong.
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  // Stage holds the logo + the orbiting sport tokens, all centred.
  // Tokens are absolutely positioned relative to this so their
  // x/y offsets in SPORTS are relative to the logo centre.
  stage: {
    width: 280,
    height: 280,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  // Wrapper for the SVG glow; sizing matches the SVG canvas so the
  // animated scale + opacity transforms apply uniformly. The actual
  // soft-edge halo lives inside the SVG (radial gradient → 0 alpha
  // at the edge), so no fill / shadow / borderRadius needed here.
  glow: {
    position: "absolute",
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  sportToken: {
    position: "absolute",
    width: SPORT_SIZE,
    height: SPORT_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: SPORT_SIZE / 2,
    backgroundColor: "rgba(16, 185, 129, 0.10)",
    borderWidth: 1,
    borderColor: colors.emerald500_30,
  },
  sportEmoji: {
    fontSize: 24,
    lineHeight: 28,
  },
  wordmark: {
    position: "absolute",
    bottom: spacing["20"],
    alignItems: "center",
    gap: spacing["1"],
  },
  wordmarkText: {
    fontSize: 26,
    letterSpacing: 0.5,
    color: colors.foreground,
  },
  tagline: {
    letterSpacing: 2,
    textTransform: "uppercase",
    fontSize: 11,
  },
});
