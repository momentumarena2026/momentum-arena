import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Text } from "../ui/Text";
import { colors, radius } from "../../theme";

/**
 * The draw ceremony, mirroring the web reveal on /tournaments/[slug].
 *
 * The app used to drop the whole grid in at once with a staggered fade,
 * which shows the same information but throws away the moment — the draw
 * is the one part of a tournament people gather round a screen for.
 *
 * Same shape as the web:
 *  - teams revealed pool-by-pool round-robin (A1, B1, C1, A2, B2, C2 …)
 *    so no single pool fills up while the others sit empty
 *  - 650ms between reveals, 500ms into the last one
 *  - each card flips in: spring, stiffness 240 / damping 20, from
 *    y -30, rotateX 90deg, scale 0.8
 *  - confetti when the final card lands
 *  - auto-plays when the reveal arrives while you are watching, and a
 *    Play/Replay button for everyone who came later
 *
 * The confetti is hand-rolled from reanimated rather than a native
 * package on purpose: a new native dependency cannot ship over OTA, and
 * this screen should reach phones with the next JS update.
 */

type PoolLite = { id: string; name: string };
type TeamLike = { id: string; name: string; poolId: string | null };

const REVEAL_GAP_MS = 650;
const LAST_REVEAL_MS = 500;
const START_DELAY_MS = 400;

/** One team row. Hidden until the ceremony reaches it, then flips in. */
function RevealCard({
  visible,
  animated,
  children,
}: {
  visible: boolean;
  /** False when the list is simply being shown (no ceremony running), so
   *  a returning viewer gets the grid immediately instead of an
   *  animation replaying at them. */
  animated: boolean;
  children: ReactNode;
}) {
  const p = useSharedValue(visible && !animated ? 1 : 0);

  useEffect(() => {
    if (!visible) {
      p.value = 0;
      return;
    }
    p.value = animated
      ? withSpring(1, { stiffness: 240, damping: 20 })
      : withTiming(1, { duration: 160 });
  }, [visible, animated, p]);

  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [
      { perspective: 600 },
      { translateY: (1 - p.value) * -30 },
      { rotateX: `${(1 - p.value) * 90}deg` },
      { scale: 0.8 + p.value * 0.2 },
    ],
  }));

  if (!visible) return null;
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Cheap celebratory burst — no native module, so it ships over OTA. */
function Confetti({ fire }: { fire: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 320,
        delay: Math.random() * 160,
        rotate: Math.random() * 720 - 360,
        color: ["#a78bfa", "#34d399", "#fbbf24", "#f87171", "#60a5fa"][i % 5],
        size: 6 + Math.random() * 6,
      })),
    [],
  );
  if (!fire) return null;
  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {pieces.map((c) => (
        <ConfettiPiece key={`${fire}-${c.id}`} {...c} />
      ))}
    </View>
  );
}

function ConfettiPiece({
  x,
  delay,
  rotate,
  color,
  size,
}: {
  x: number;
  delay: number;
  rotate: number;
  color: string;
  size: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 1400 }));
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: withSequence(withTiming(1, { duration: 0 }), withTiming(1 - t.value)),
    transform: [
      { translateX: x * t.value },
      { translateY: 40 + t.value * 260 },
      { rotate: `${rotate * t.value}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        style,
        { position: "absolute", width: size, height: size * 1.6, backgroundColor: color, borderRadius: 1 },
      ]}
    />
  );
}

export function PoolRevealCeremony<T extends TeamLike>({
  pools,
  teams,
  advancePerPool,
  renderBadge,
}: {
  pools: PoolLite[];
  teams: T[];
  advancePerPool: number;
  renderBadge: (team: T) => ReactNode;
}) {
  // Round-robin across pools, exactly like the web: the first team of
  // every pool, then the second of every pool, and so on.
  const drawOrder = useMemo(() => {
    const byPool = new Map(pools.map((p) => [p.id, teams.filter((t) => t.poolId === p.id)]));
    const order: { team: T; poolId: string }[] = [];
    for (let i = 0; ; i++) {
      let added = false;
      for (const p of pools) {
        const list = byPool.get(p.id) ?? [];
        if (i < list.length) {
          order.push({ team: list[i], poolId: p.id });
          added = true;
        }
      }
      if (!added) break;
    }
    return order;
  }, [pools, teams]);

  const [played, setPlayed] = useState(false);
  const [step, setStep] = useState(-1);
  const [fire, setFire] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const play = useCallback(() => {
    clearTimers();
    setPlayed(true);
    setStep(-1);
    let i = 0;
    const tick = () => {
      setStep(i);
      i += 1;
      if (i <= drawOrder.length) {
        timers.current.push(
          setTimeout(tick, i === drawOrder.length ? LAST_REVEAL_MS : REVEAL_GAP_MS),
        );
      }
      if (i === drawOrder.length) {
        timers.current.push(setTimeout(() => setFire((n) => n + 1), 300));
      }
    };
    timers.current.push(setTimeout(tick, START_DELAY_MS));
  }, [drawOrder.length]);

  // Auto-play once, for anyone already watching when the draw lands.
  const autoPlayed = useRef(false);
  useEffect(() => {
    if (!autoPlayed.current && drawOrder.length > 0) {
      autoPlayed.current = true;
      play();
    }
  }, [drawOrder.length, play]);

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>The Pools</Text>
        <Pressable onPress={play} style={styles.playBtn}>
          <Text style={styles.playText}>✨ {played ? "Replay draw" : "Play the draw"}</Text>
        </Pressable>
      </View>

      {pools.map((pool) => (
        <View key={pool.id} style={styles.poolCard}>
          <Text style={styles.poolName}>{pool.name}</Text>
          <View style={{ gap: 8, marginTop: 8 }}>
            {drawOrder
              .filter((d) => d.poolId === pool.id)
              .map(({ team }) => {
                const at = drawOrder.findIndex((d) => d.team.id === team.id);
                return (
                  <RevealCard key={team.id} visible={!played || step >= at} animated={played}>
                    <View style={styles.teamRow}>
                      {renderBadge(team)}
                      <Text style={styles.teamName}>{team.name}</Text>
                    </View>
                  </RevealCard>
                );
              })}
          </View>
        </View>
      ))}

      <Text style={styles.footNote}>
        Top {advancePerPool} from each pool advance to the knockouts.
      </Text>
      <Confetti fire={fire} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  playBtn: {
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.4)",
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  playText: { color: "#c4b5fd", fontSize: 12 },
  poolCard: {
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.2)",
    borderRadius: radius.xl,
    backgroundColor: "rgba(167,139,250,0.04)",
    padding: 14,
  },
  poolName: { color: "#a78bfa", fontSize: 14, fontWeight: "700", textAlign: "center" },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: radius.lg,
    backgroundColor: colors.zinc900,
    padding: 10,
  },
  teamName: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  footNote: { color: colors.zinc500, fontSize: 11, textAlign: "center" },
  confettiLayer: {
    position: "absolute",
    top: 0,
    left: "50%",
    right: 0,
    height: 0,
    alignItems: "center",
  },
});
