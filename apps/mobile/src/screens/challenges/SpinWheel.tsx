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
 * ── Why the slices are proportional ────────────────────────────────
 *
 * Each slice is sized by its WEIGHT, not split evenly. So the 50% slice is
 * visibly a sliver and the 10% slice is visibly fat. That is honest — the
 * odds are on the wheel, in front of you — and it is better theatre than
 * equal slices, because the needle sweeping past that thin band of gold is
 * the whole feeling the promo is selling. Equal slices would make a 1-in-10
 * jackpot look like a 1-in-6 one, which is a small lie told repeatedly.
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

  // Slice geometry, derived once from the venue's real weights.
  const slices = useMemo(() => {
    const live = segments.filter((s) => s.weight > 0);
    const total = live.reduce((t, s) => t + s.weight, 0) || 1;
    let cursor = 0;
    return live.map((s) => {
      const sweep = (s.weight / total) * 360;
      const slice = { ...s, start: cursor, end: cursor + sweep, mid: cursor + sweep / 2 };
      cursor += sweep;
      return slice;
    });
  }, [segments]);

  const maxPct = useMemo(() => Math.max(...slices.map((s) => s.pct), 0), [slices]);
  // The odds, in words. The server computes these for the admin and the
  // player was never shown a number.
  const jackpotOdds = useMemo(() => {
    const total = slices.reduce((t, x) => t + x.weight, 0) || 1;
    const top = slices.find((x) => x.pct === maxPct);
    const chance = top ? top.weight / total : 0;
    return chance > 0 ? `1 in ${Math.round(1 / chance)}` : "never";
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
                ? "One spin for winning your match. Up to 50% off the next hour."
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
                  // A label only where the slice is wide enough to hold one;
                  // a 3° sliver with "50%" printed across it reads as noise.
                  const sweep = s.end - s.start;
                  const rad = ((s.mid - 90) * Math.PI) / 180;
                  const lx = CENTRE + R * 0.68 * Math.cos(rad);
                  const ly = CENTRE + R * 0.68 * Math.sin(rad);
                  return (
                    <G key={`${s.pct}-${i}`}>
                      <Path
                        d={wedge(s.start, s.end)}
                        fill={sliceFill(s.pct, maxPct)}
                        stroke="#020617"
                        strokeWidth={2}
                      />
                      {sweep >= 16 && (
                        <SvgText
                          x={lx}
                          y={ly}
                          fill="#ffffff"
                          fontSize={sweep >= 40 ? 17 : 13}
                          fontWeight="700"
                          textAnchor="middle"
                          // Flip on the lower half. A label rotated to its
                          // slice's own angle reads upside down for every
                          // slice past the 3 o'clock mark, which is half the
                          // wheel.
                          transform={`rotate(${s.mid > 90 && s.mid < 270 ? s.mid + 180 : s.mid} ${lx} ${ly})`}
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

        {/* The thin gold sliver is the point of the whole promo, so say what
            it is rather than leaving people to squint at it. */}
        {maxPct > 0 && (
          <Text variant="tiny" color={colors.zinc500}>
            {settled
              ? `The gold sliver is ${maxPct}% — about ${jackpotOdds} of spins.`
              : `The gold sliver is ${maxPct}%. It is exactly as narrow as it looks.`}
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
