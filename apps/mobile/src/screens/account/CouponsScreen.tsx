import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ticket } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { bookingApi, type PublicCoupon } from "../../lib/booking";
import { formatRupees } from "../../lib/format";

/**
 * Coupons & Offers — a standalone browse of the currently-valid public
 * coupons (bookings + cafe). Mirrors the web's available-coupons surface and
 * reuses the same /api/mobile/coupons/available endpoint + formatting that
 * powers the checkout discount drawer (DiscountInput). Read-only: codes are
 * applied at checkout (some auto-apply).
 */
function discountLabel(c: PublicCoupon): string {
  if (c.type === "PERCENTAGE") {
    const pct = c.value / 100;
    const maxStr = c.maxDiscount ? ` up to ${formatRupees(c.maxDiscount)}` : "";
    return `${pct}% OFF${maxStr}`;
  }
  return `${formatRupees(c.value)} OFF`;
}

function scopeLabel(scope: PublicCoupon["scope"]): string {
  switch (scope) {
    case "SPORTS":
      return "Bookings";
    case "CAFE":
      return "Cafe";
    default:
      return "Bookings & Cafe";
  }
}

function formatValidUntil(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CouponsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["coupons", "available", "BOTH"],
    queryFn: () => bookingApi.availableCoupons("BOTH"),
  });

  const coupons = data?.coupons ?? [];
  const onRefresh = useCallback(() => void refetch(), [refetch]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={onRefresh}
            tintColor={colors.zinc400}
            colors={[colors.primary]}
          />
        }
      >
        <Text variant="small" color={colors.zinc500} style={styles.intro}>
          Apply any of these codes at checkout. Some apply automatically.
        </Text>

        {isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <Skeleton width={120} height={20} />
                <Skeleton width="80%" height={12} />
                <Skeleton width="50%" height={11} />
              </View>
            ))}
          </View>
        ) : isError ? (
          <Card style={styles.stateCard}>
            <Text variant="small" color={colors.destructive} align="center">
              Couldn&apos;t load coupons. Pull to refresh.
            </Text>
          </Card>
        ) : coupons.length === 0 ? (
          <View style={styles.empty}>
            <Ticket size={36} color={colors.zinc600} />
            <Text
              variant="body"
              weight="600"
              color={colors.foreground}
              style={{ marginTop: spacing["3"] }}
            >
              No coupons right now
            </Text>
            <Text
              variant="small"
              color={colors.zinc500}
              align="center"
              style={{ marginTop: spacing["1"] }}
            >
              Check back soon — we run offers regularly.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {coupons.map((c) => (
              <Card key={c.id} style={styles.couponCard}>
                <View style={styles.couponHead}>
                  <View style={styles.codePill}>
                    <Ticket size={14} color={colors.emerald400} />
                    <Text variant="small" weight="700" color={colors.emerald400}>
                      {c.code}
                    </Text>
                  </View>
                  <View style={styles.scopePill}>
                    <Text variant="tiny" color={colors.zinc400}>
                      {scopeLabel(c.scope)}
                    </Text>
                  </View>
                </View>
                <Text
                  variant="bodyStrong"
                  color={colors.foreground}
                  style={{ marginTop: spacing["2"] }}
                >
                  {discountLabel(c)}
                </Text>
                {c.description ? (
                  <Text
                    variant="small"
                    color={colors.zinc400}
                    style={{ marginTop: 2 }}
                  >
                    {c.description}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {c.minAmount ? (
                    <Text variant="tiny" color={colors.zinc500}>
                      Min order {formatRupees(c.minAmount)}
                    </Text>
                  ) : null}
                  <Text variant="tiny" color={colors.zinc500}>
                    Valid till {formatValidUntil(c.validUntil)}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  intro: { marginBottom: spacing["1"] },
  list: { gap: spacing["3"] },
  couponCard: { padding: spacing["4"] },
  couponHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.30)",
    backgroundColor: colors.emerald500_10,
  },
  scopePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  metaRow: {
    marginTop: spacing["3"],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
  },
  skeletonCard: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
  stateCard: {
    padding: spacing["6"],
    alignItems: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: spacing["12"],
  },
});
