import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react-native";
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

/**
 * Mobile redemption checkbox. All-or-nothing — checked redeems the
 * full `preview.maxPoints` (the cap from server: balance × bill-cap%),
 * unchecked clears the redemption. Replaces an earlier preset-chip UI
 * (25/50/75/Max) because UX testing showed users almost never picked
 * a sub-max amount.
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

  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default is "redemption ON" — we auto-apply as soon as the preview
  // lands so the customer doesn't have to hunt for the checkbox to
  // use the points they've already earned. If they uncheck, this
  // ref flips and the next preview load (after a coupon
  // apply/clear) respects that. Re-checking flips it back.
  const userOptedOutRef = useRef(false);

  // Reset on bill change — the previous maxPoints is stale until
  // the new preview lands. If auto-apply is still in effect it'll
  // repopulate via the second effect below.
  useEffect(() => {
    setRedeeming(false);
    setError(null);
    onChange({ points: 0, paiseSaved: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billRupees, nonce]);

  const preview = previewQ.data?.preview ?? null;

  // Auto-apply when the preview lands and the user hasn't explicitly
  // opted out. Mirror of the gates used in the render below — keep
  // them in sync.
  useEffect(() => {
    if (!preview) return;
    if (userOptedOutRef.current) return;
    if (redeeming) return;
    if (!preview.enabled) return;
    if (preview.pointsAvailable < preview.minPoints) return;
    if (preview.maxPoints < preview.minPoints) return;

    setRedeeming(true);
    const paiseSaved = preview.maxPoints * preview.pointValuePaise;
    onChange({ points: preview.maxPoints, paiseSaved });
    if (!startedFiredRef.current) {
      startedFiredRef.current = true;
      trackRewardsRedeemStarted(billRupees * 100, preview.maxPoints);
    }
    applyM.mutate(preview.maxPoints, {
      onError: (err: unknown) => {
        setError(err instanceof Error ? err.message : "Couldn't apply points");
        setRedeeming(false);
        onChange({ points: 0, paiseSaved: 0 });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

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

  const busy = applyM.isPending || clearM.isPending;
  const paiseSaved = preview.maxPoints * preview.pointValuePaise;
  const rupeesSaved = Math.floor(paiseSaved / 100);

  function handleToggle() {
    if (!preview) return;
    if (busy) return;
    const nextOn = !redeeming;
    setRedeeming(nextOn);
    setError(null);
    // Remember the user's explicit choice so coupon apply/clear
    // (which re-runs the preview query) doesn't override them — if
    // they turned it OFF, keep it off even after the bill changes;
    // if they turn it back ON, resume default auto-apply behavior.
    userOptedOutRef.current = !nextOn;
    const nextPoints = nextOn ? preview.maxPoints : 0;
    const nextPaise = nextPoints * preview.pointValuePaise;
    onChange({ points: nextPoints, paiseSaved: nextPaise });
    if (nextOn && !startedFiredRef.current) {
      startedFiredRef.current = true;
      trackRewardsRedeemStarted(billRupees * 100, preview.maxPoints);
    }
    if (nextOn) {
      applyM.mutate(preview.maxPoints, {
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Couldn't apply points");
          setRedeeming(false);
          onChange({ points: 0, paiseSaved: 0 });
        },
      });
    } else {
      clearM.mutate(undefined, {
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Couldn't clear points");
        },
      });
    }
  }

  return (
    <View style={styles.card}>
      <Header balance={preview.pointsAvailable} />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: redeeming, disabled: busy }}
        onPress={handleToggle}
        disabled={busy}
        style={({ pressed }) => [
          styles.toggleRow,
          redeeming && styles.toggleRowOn,
          pressed && { opacity: 0.85 },
          busy && { opacity: 0.6 },
        ]}
      >
        <View style={[styles.box, redeeming && styles.boxOn]}>
          {redeeming ? <Check size={14} color="#ffffff" strokeWidth={3} /> : null}
        </View>
        <Text style={styles.toggleText}>
          Redeem{" "}
          <Text style={styles.toggleStrong}>
            {preview.maxPoints.toLocaleString("en-IN")}
          </Text>{" "}
          pts
          <Text style={styles.toggleSave}>
            {"  "}— save ₹{rupeesSaved.toLocaleString("en-IN")}
          </Text>
        </Text>
        {busy ? (
          <ActivityIndicator size="small" color={colors.emerald400} />
        ) : null}
      </Pressable>

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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
  },
  toggleRowOn: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
    backgroundColor: "#0a0a0b",
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500,
  },
  toggleText: {
    flex: 1,
    fontSize: 13,
    color: colors.zinc300,
  },
  toggleStrong: {
    color: colors.foreground,
    fontWeight: "700",
  },
  toggleSave: {
    color: "#6ee7b7",
    fontWeight: "600",
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
