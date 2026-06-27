import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminPaymentSettingsApi,
  type PaymentGateway,
  type PaymentMethodFlag,
  type PaymentSettings,
} from "../../lib/admin-payment-settings";
import { AdminApiError } from "../../lib/admin-api";

const GATEWAYS: { value: PaymentGateway; label: string; sub: string }[] = [
  { value: "PHONEPE", label: "PhonePe", sub: "UPI, Cards, Netbanking via PhonePe" },
  { value: "RAZORPAY", label: "Razorpay", sub: "UPI, Cards, Netbanking via Razorpay" },
];

function showError(e: unknown) {
  Alert.alert(
    "Couldn't update",
    e instanceof AdminApiError || e instanceof Error ? e.message : "Please try again.",
  );
}

export function AdminPaymentSettingsScreen() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "payment-settings"],
    queryFn: () => adminPaymentSettingsApi.get(),
  });

  const setConfig = (config: PaymentSettings) =>
    qc.setQueryData(["admin", "payment-settings"], { config });

  const method = useMutation({
    mutationFn: ({ m, enabled }: { m: PaymentMethodFlag; enabled: boolean }) =>
      adminPaymentSettingsApi.setMethod(m, enabled),
    onSuccess: (data) => setConfig(data.config),
    onError: showError,
  });

  const dqr = useMutation({
    mutationFn: (enabled: boolean) => adminPaymentSettingsApi.setDqr(enabled),
    onSuccess: (data) => setConfig(data.config),
    onError: showError,
  });

  const gateway = useMutation({
    mutationFn: (g: PaymentGateway) => adminPaymentSettingsApi.setGateway(g),
    onSuccess: (data) => setConfig(data.config),
    onError: showError,
  });

  const cfg = query.data?.config;
  const busy = method.isPending || dqr.isPending || gateway.isPending;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isLoading}
            onRefresh={() => void query.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        {query.isLoading || !cfg ? (
          <Card style={styles.card}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="90%" height={12} />
            <Skeleton width="90%" height={12} />
          </Card>
        ) : (
          <>
            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              PAYMENT METHODS
            </Text>
            <Card style={styles.card}>
              <ToggleRow
                label="Online payment"
                sub="Cards, UPI, Netbanking via the active gateway"
                value={cfg.onlineEnabled}
                disabled={busy}
                onChange={(v) => method.mutate({ m: "online", enabled: v })}
              />
              <ToggleRow
                label="UPI QR code"
                sub="Customer scans a QR and enters the UTR manually"
                value={cfg.upiQrEnabled}
                disabled={busy}
                onChange={(v) => method.mutate({ m: "upi_qr", enabled: v })}
              />
              <ToggleRow
                label="Pay 50% now, 50% at venue"
                sub="Half online now, the rest collected at the counter"
                value={cfg.advanceEnabled}
                disabled={busy}
                onChange={(v) => method.mutate({ m: "advance", enabled: v })}
              />
            </Card>
            <Text variant="tiny" color={colors.zinc600} style={styles.hint}>
              At least one method must stay enabled.
            </Text>

            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              DYNAMIC QR (AUTO-CONFIRM)
            </Text>
            <Card style={styles.card}>
              <ToggleRow
                label="Dynamic QR"
                sub="Per-order PhonePe QR with auto-confirm. Off = static QR + manual UTR."
                value={cfg.dqrEnabled}
                disabled={busy || !cfg.dqrConfigured}
                onChange={(v) => dqr.mutate(v)}
              />
              {!cfg.dqrConfigured ? (
                <Text variant="tiny" color={colors.yellow400}>
                  PHONEPE_DQR_* credentials are not configured — dynamic QR stays
                  off at checkout until they're set.
                </Text>
              ) : null}
            </Card>

            <Text variant="tiny" color={colors.zinc500} style={styles.section}>
              ACTIVE GATEWAY
            </Text>
            <Card style={styles.card}>
              {GATEWAYS.map((g) => {
                const active = cfg.activeGateway === g.value;
                return (
                  <Pressable
                    key={g.value}
                    disabled={busy || active}
                    onPress={() => gateway.mutate(g.value)}
                    style={[styles.gatewayRow, active && styles.gatewayRowActive]}
                  >
                    <View style={styles.radioOuter}>
                      {active ? <View style={styles.radioInner} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="small" weight="600" color={colors.foreground}>
                        {g.label}
                      </Text>
                      <Text variant="tiny" color={colors.zinc500}>
                        {g.sub}
                      </Text>
                    </View>
                    <CreditCard
                      size={16}
                      color={active ? colors.emerald400 : colors.zinc600}
                    />
                  </Pressable>
                );
              })}
              <Text variant="tiny" color={colors.zinc600}>
                Used for full and 50% advance online payments. UPI QR and cash are
                always available regardless of gateway.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  disabled,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text variant="small" weight="500" color={colors.foreground}>
          {label}
        </Text>
        {sub ? (
          <Text variant="tiny" color={colors.zinc500}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
        thumbColor={value ? colors.emerald400 : colors.zinc400}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["2"],
  },
  card: { padding: spacing["4"], gap: spacing["3"] },
  section: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["3"] },
  hint: { marginTop: spacing["1"], marginLeft: spacing["1"] },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
  gatewayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  gatewayRowActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.zinc600,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.emerald400,
  },
});
