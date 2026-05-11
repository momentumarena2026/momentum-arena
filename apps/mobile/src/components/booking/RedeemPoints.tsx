import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import { bookingApi } from "../../lib/booking";
import { rewardsApi } from "../../lib/rewards";
import {
  trackRewardsRedeemStarted,
  trackRewardsRedeemCompleted,
} from "../../lib/analytics";

interface Props {
  holdId: string;
  /** Bill the cap is computed against, in RUPEES (post-coupon). */
  billRupees: number;
  /** Re-run the preview when this bumps — typically when a coupon
   *  changes. */
  nonce?: number;
  /** Whatever the user picks, the parent uses paiseSaved to compute
   *  the final payable and pass it to the gateway initiators. */
  onChange: (state: { points: number; paiseSaved: number }) => void;
}

const PRESET_PCTS = [25, 50, 75, 100] as const;

/**
 * Mobile redemption picker. Uses preset chips (25/50/75/Max) instead
 * of a slider — more thumb-friendly than dragging a range input on
 * a phone, and dodges the need to pull in
 * @react-native-community/slider as a new dependency.
 *
 * Same contract as the web RedeemSlider: persists the pick on the
 * SlotHold and the booking-creation transaction writes the
 * REDEEMED_BOOKING ledger row inside the same transaction.
 */
export function RedeemPoints({ holdId, billRupees, nonce, onChange }: Props) {
  const qc = useQueryClient();
  const startedFiredRef = useRef(false);

  const previewQ = useQuery({
    queryKey: ["rewards", "preview", billRupees, nonce ?? 0],
    queryFn: () => rewardsApi.redemptionPreview(billRupees * 100),
    enabled: billRupees > 0,
  });

  const applyM = useMutation({
    mutationFn: (points: number) =>
      bookingApi.applyPoints({ holdId, points }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hold", holdId] });
    },
  });
  const clearM = useMutation({
    mutationFn: () => bookingApi.clearPoints(holdId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hold", holdId] });
    },
  });

  const [points, setPoints] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reset on bill change.
  useEffect(() => {
    setPoints(0);
    setError(null);
    onChange({ points: 0, paiseSaved: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billRupees, nonce]);

  const preview = previewQ.data?.preview ?? null;

  // Listen for an external "redeem completed" hint so we fire the
  // funnel event at the same moment as web. Mobile dispatches via a
  // CustomEvent isn't a thing — instead the parent calls
  // RedeemPoints.fireCompleted(...) below.
  if (preview === null || !preview?.enabled) return null;
  if (preview.pointsAvailable < preview.minPoints) return null;
  if (preview.maxPoints < preview.minPoints) {
    return (
      <View style={styles.card}>
        <Header balance={preview.pointsAvailable} />
        <Text style={styles.subdued}>
          Need at least {preview.minPoints} points (this bill caps you below).
        </Text>
      </View>
    );
  }

  function pickPercent(pct: number) {
    if (!preview) return;
    let next = Math.floor((preview.maxPoints * pct) / 100);
    // Snap up to the minimum if the percent rounds down below it.
    if (next < preview.minPoints) next = preview.minPoints;
    if (next > preview.maxPoints) next = preview.maxPoints;
    setError(null);
    setPoints(next);
    const paiseSaved = next * preview.pointValuePaise;
    onChange({ points: next, paiseSaved });
    if (!startedFiredRef.current) {
      startedFiredRef.current = true;
      trackRewardsRedeemStarted(billRupees * 100, preview.maxPoints);
    }
    applyM.mutate(next, {
      onError: (err: unknown) => {
        setError(err instanceof Error ? err.message : "Couldn't apply points");
        setPoints(0);
        onChange({ points: 0, paiseSaved: 0 });
      },
    });
  }

  function handleClear() {
    setPoints(0);
    setError(null);
    onChange({ points: 0, paiseSaved: 0 });
    clearM.mutate();
  }

  const paiseSaved = points * preview.pointValuePaise;
  const rupeesSaved = Math.floor(paiseSaved / 100);
  const busy = applyM.isPending || clearM.isPending;

  return (
    <View style={styles.card}>
      <Header balance={preview.pointsAvailable} />

      <View style={styles.chipsRow}>
        {PRESET_PCTS.map((pct) => {
          const ptsForPct = Math.floor((preview.maxPoints * pct) / 100);
          const active = points === ptsForPct && points > 0;
          // Hide chips that round below the min.
          if (ptsForPct < preview.minPoints) return null;
          return (
            <Pressable
              key={pct}
              onPress={() => pickPercent(pct)}
              disabled={busy}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {pct === 100 ? "Max" : `${pct}%`}
              </Text>
              <Text style={styles.chipSubText}>
                {ptsForPct.toLocaleString("en-IN")} pts
              </Text>
            </Pressable>
          );
        })}
      </View>

      {points > 0 && (
        <View style={styles.savedRow}>
          {busy ? (
            <ActivityIndicator color={colors.emerald400} size="small" />
          ) : null}
          <Text style={styles.savedText}>
            Using <Text style={styles.savedStrong}>{points.toLocaleString("en-IN")}</Text> pts —
            saving <Text style={styles.savedStrong}>₹{rupeesSaved.toLocaleString("en-IN")}</Text>
          </Text>
          <Pressable
            onPress={handleClear}
            disabled={busy}
            style={({ pressed }) => [
              styles.clearBtn,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
          >
            <X size={14} color={colors.zinc400} />
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>
      )}

      {points === 0 && (
        <Text style={styles.subdued}>
          Tap a preset to apply up to{" "}
          {preview.maxPoints.toLocaleString("en-IN")} pts off this bill.
        </Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

/** Imperative helper — call this from the parent right after a
 *  successful booking commit so the funnel "redeem completed" event
 *  fires alongside the analogous web CustomEvent. */
export function fireRedeemCompleted(points: number, paiseSaved: number) {
  if (points > 0) {
    trackRewardsRedeemCompleted(points, paiseSaved);
  }
}

function Header({ balance }: { balance: number }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <Sparkles size={14} color={colors.emerald400} />
        <Text style={styles.headerTitle}>Use Momentum Points</Text>
      </View>
      <Text style={styles.headerBalance}>
        Balance: {balance.toLocaleString("en-IN")} pts
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  headerBalance: {
    fontSize: 11,
    color: "#6ee7b7",
  },
  chipsRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  chip: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    paddingVertical: spacing["2.5"],
    paddingHorizontal: spacing["2"],
    alignItems: "center",
    gap: 2,
  },
  chipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_20,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.zinc300,
  },
  chipTextActive: {
    color: colors.foreground,
  },
  chipSubText: {
    fontSize: 10,
    color: colors.zinc500,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderRadius: radius.md,
    backgroundColor: colors.emerald500_10,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  savedText: {
    flex: 1,
    fontSize: 13,
    color: "#6ee7b7",
  },
  savedStrong: {
    color: colors.foreground,
    fontWeight: "700",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  clearText: {
    fontSize: 11,
    color: colors.zinc400,
  },
  subdued: {
    fontSize: 12,
    color: colors.zinc500,
  },
  errorText: {
    fontSize: 12,
    color: colors.destructive,
  },
});
