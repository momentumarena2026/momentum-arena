import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Modal, Pressable, View, Vibration } from "react-native";
import Svg, { G, Path, Circle, Text as SvgText, Polygon } from "react-native-svg";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius } from "../../theme";

export type WheelSegment = { pct: number; weight: number };

/**
 * The prize wheel.
 *
 * ── The one rule this screen must not break ────────────────────────
 *
 * The result is decided by the SERVER before this component is told
 * anything, and the animation's only job is to land on it. Nothing here
 * chooses an outcome, nudges one, or re-rolls: `landOn` arrives as a fact
 * and the wheel rotates to show it. That is also why the segments are the
 * venue's real ones, fetched from the same config that drew the number —
 * a decorative wheel that stops on a value computed elsewhere is the kind
 * of thing a player eventually notices, and once they do, every prize the
 * arena has ever given away looks rigged.
 *
 * ── The slices are EQUAL ───────────────────────────────────────────
 *
 * Every segment takes the same wedge of the circle, whatever its odds. That
 * is a deliberate product decision: a wheel whose slices are sized by their
 * weights draws the jackpot as a 3° splinter, which reads as a wheel that
 * cannot be won rather than as a wheel with a rare prize.
 *
 * The ODDS are untouched — they still come from the venue's weights, and the
 * server has already drawn the number before this screen renders. So the
 * geometry is presentation and the weighting is the rule, and the two are
 * deliberately not the same thing. The consequence is that nothing here may
 * claim the picture shows the odds: the caption states the real chance in
 * words ("about 1 in 12") instead, which is true and legible in a way a
 * splinter of gold never was.
 *
 * ── The physics ───────────────────────────────────────────────────
 *
 * Five full turns plus the angle to the winning slice, decelerating on a
 * cubic ease-out over four seconds, with a short haptic tick as it settles.
 * Long enough to build something, short enough that nobody taps away.
 */

// Clamped to the narrowest phone rather than fixed: 280 plus the modal's
// 2×24 padding overflows anything under 328pt wide.
const SIZE = Math.min(280, Math.round(Dimensions.get("window").width - 72));
const R = SIZE / 2;
const CENTRE = R;

/** Colour a slice by how good it is, so the wheel reads at a glance. */
function sliceFill(pct: number, max: number): string {
  if (pct >= max) return "#f59e0b"; // the jackpot — gold, and the only one
  const share = max > 0 ? pct / max : 0;
  if (share >= 0.5) return colors.emerald500;
  if (share >= 0.3) return "#0f766e";
  return "#134e4a";
}

/** An SVG wedge from `start` to `end` degrees, measured clockwise from 12. */
function wedge(start: number, end: number): string {
  const toXY = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CENTRE + R * Math.cos(rad), CENTRE + R * Math.sin(rad)];
  };
  const [x1, y1] = toXY(start);
  const [x2, y2] = toXY(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${CENTRE} ${CENTRE} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function SpinWheel({
  visible,
  segments,
  landOn,
  spinning,
  onSpin,
  onClose,
  subtitle,
}: {
  visible: boolean;
  segments: WheelSegment[];
  /** The percentage the server already decided, or null while unspun. */
  landOn: number | null;
  spinning: boolean;
  onSpin: () => void;
  onClose: () => void;
  /** What they've won, in words, once it has landed. */
  subtitle?: string | null;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const [settled, setSettled] = useState(false);

  // Reopening after a spin used to draw the "unspun" screen in the previous
  // spin's resting position, with its odds caption gone.
  useEffect(() => {
    if (!visible && landOn === null) {
      rotation.setValue(0);
      setSettled(false);
    }
  }, [visible, landOn, rotation]);

  // Slice geometry: one equal wedge per winnable segment. A zero-weight
  // segment is not drawn at all — it cannot be landed on, so putting it on
  // the wheel would promise a prize that never comes up.
  const slices = useMemo(() => {
    const live = segments.filter((s) => s.weight > 0);
    const sweep = 360 / (live.length || 1);
    return live.map((s, i) => ({
      ...s,
      start: i * sweep,
      end: (i + 1) * sweep,
      mid: i * sweep + sweep / 2,
    }));
  }, [segments]);

  const maxPct = useMemo(() => Math.max(...slices.map((s) => s.pct), 0), [slices]);
  // The odds, in words. The server computes these for the admin and the
  // player was never shown a number.
  const jackpotOdds = useMemo(() => {
    const total = slices.reduce((t, x) => t + x.weight, 0) || 1;
    const top = slices.find((x) => x.pct === maxPct);
    const chance = top ? top.weight / total : 0;
    // Phrased as a whole sentence, because "about never spins" is what
    // stitching a fragment into the caption produced when a wheel had the
    // top prize weighted to zero.
    return chance > 0
      ? `about 1 spin in ${Math.round(1 / chance)}`
      : "not on this wheel right now";
  }, [slices, maxPct]);

  useEffect(() => {
    if (landOn === null) return;
    const target = slices.find((s) => s.pct === landOn);
    if (!target) {
      // The venue edited the wheel between this screen loading and the spin.
      // Landing on slices[0] would point the needle at one number while the
      // title announced another — for a feature whose whole premise is that
      // a player eventually notices, that is the worst possible failure.
      // Show the result without pretending to have spun to it.
      setSettled(true);
      return;
    }

    // The needle sits at 12 o'clock, so the wheel has to turn BACKWARDS by
    // the winning slice's mid-angle to bring it under the needle.
    const TURNS = 5;
    const final = TURNS * 360 + (360 - target.mid);

    setSettled(false);
    rotation.setValue(0);
    Animated.timing(rotation, {
      toValue: final,
      duration: 4000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setSettled(true);
      // A single short tick as it stops — the moment the number becomes real.
      Vibration.vibrate(40);
    });
  }, [landOn, slices, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.97)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 20,
        }}
      >
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text variant="title" color={colors.foreground}>
            {settled && landOn !== null ? `${landOn}% off` : "Spin for your next hour"}
          </Text>
          <Text
            variant="small"
            color={colors.zinc400}
            style={{ textAlign: "center", paddingHorizontal: 12 }}
          >
            {settled && subtitle
              ? subtitle
              : landOn === null
                ? "One spin for getting your match confirmed. Up to 50% off the next hour."
                : " "}
          </Text>
        </View>

        <View style={{ width: SIZE, height: SIZE + 22, alignItems: "center" }}>
          {/* The needle. Drawn OVER the wheel and never moves — the wheel
              turns under it, which is what makes the stop feel decided. */}
          <Svg
            width={30}
            height={22}
            style={{ position: "absolute", top: 0, zIndex: 2 }}
            viewBox="0 0 30 22"
          >
            <Polygon points="15,22 3,0 27,0" fill={colors.foreground} />
          </Svg>

          <Animated.View
            style={{
              position: "absolute",
              top: 18,
              width: SIZE,
              height: SIZE,
              transform: [{ rotate: spin }],
            }}
          >
            <Svg width={SIZE} height={SIZE}>
              <G>
                {slices.map((s, i) => {
                  // Every wedge is the same width now, so this is one
                  // decision for the whole wheel rather than per slice: a
                  // twelve-segment wheel gives 30° each, which holds a label
                  // comfortably; past about twenty it stops doing so.
                  const sweep = s.end - s.start;
                  const rad = ((s.mid - 90) * Math.PI) / 180;
                  const lx = CENTRE + R * 0.68 * Math.cos(rad);
                  const ly = CENTRE + R * 0.68 * Math.sin(rad);
                  return (
                    <G key={`${s.pct}-${i}`}>
                      {/* A lone segment is 360°, and an arc from a point back
                          to itself draws nothing — the wheel collapsed to a
                          line. A venue can legitimately run a one-prize wheel,
                          so draw the circle. */}
                      {slices.length === 1 ? (
                        <Circle
                          cx={CENTRE}
                          cy={CENTRE}
                          r={R}
                          fill={sliceFill(s.pct, maxPct)}
                          stroke="#020617"
                          strokeWidth={2}
                        />
                      ) : (
                        <Path
                          d={wedge(s.start, s.end)}
                          fill={sliceFill(s.pct, maxPct)}
                          stroke="#020617"
                          strokeWidth={2}
                        />
                      )}
                      {sweep >= 16 && (
                        <SvgText
                          x={lx}
                          y={ly}
                          fill="#ffffff"
                          fontSize={sweep >= 40 ? 17 : 13}
                          fontWeight="700"
                          textAnchor="middle"
                          // RADIAL: the label runs out along its own slice,
                          // like a fairground wheel. The previous rule flipped
                          // lower-half labels so they read upright AT REST —
                          // but the wheel stops at an arbitrary angle, and
                          // "lower half" is defined in the wheel's own frame,
                          // so after a spin the labels sat at arbitrary angles
                          // and looked accidental. Radial looks deliberate
                          // wherever it stops, which is the only orientation
                          // that can be true at every angle.
                          transform={`rotate(${s.mid - 90} ${lx} ${ly})`}
                        >
                          {s.pct}%
                        </SvgText>
                      )}
                    </G>
                  );
                })}
                <Circle cx={CENTRE} cy={CENTRE} r={26} fill="#020617" stroke={colors.zinc800} strokeWidth={2} />
              </G>
            </Svg>
          </Animated.View>
        </View>

        {/* The slices are equal, so the chance has to be said in words. The
            previous copy ("exactly as narrow as it looks") described a
            proportional wheel and would now be simply false. */}
        {maxPct > 0 && (
          <Text variant="tiny" color={colors.zinc500} style={{ textAlign: "center" }}>
            {`Gold is ${maxPct}% off — ${jackpotOdds}.`}
          </Text>
        )}

        <View style={{ width: "100%", gap: 10 }}>
          {landOn === null ? (
            <Button label="Spin the wheel" variant="primary" loading={spinning} onPress={onSpin} />
          ) : settled ? (
            <Button label="See what I can book" variant="primary" onPress={onClose} />
          ) : null}
          {/* ALWAYS present. Hiding it during the spin left an iOS user with
              no control at all if the animation's completion callback never
              fired — a full-screen modal over a stopped wheel. */}
          <Pressable onPress={onClose} style={{ alignSelf: "center", padding: 8 }}>
            <Text variant="small" color={colors.zinc500}>
              {landOn === null ? "Not now" : settled ? "Close" : "Skip the animation"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
