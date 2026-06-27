import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { colors, spacing } from "../../theme";
import {
  adminRewardsApi,
  type AdminRewardConfig,
} from "../../lib/admin-rewards";
import { AdminApiError } from "../../lib/admin-api";

export function AdminRewardsConfigScreen() {
  const query = useQuery({
    queryKey: ["admin", "rewards-config"],
    queryFn: () => adminRewardsApi.config(),
  });

  const [cfg, setCfg] = useState<AdminRewardConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (query.data?.config) setCfg(query.data.config);
  }, [query.data]);

  function num<K extends keyof AdminRewardConfig>(key: K) {
    return {
      value: cfg ? String(cfg[key] as number) : "",
      onChangeText: (t: string) =>
        setCfg((c) =>
          c ? { ...c, [key]: Number(t.replace(/[^0-9.]/g, "")) || 0 } : c,
        ),
    };
  }

  if (query.isLoading || !cfg) {
    return (
      <Screen>
        <Text variant="small" color={colors.zinc500}>
          Loading…
        </Text>
      </Screen>
    );
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setErr(null);
    try {
      await adminRewardsApi.saveConfig(cfg);
      Alert.alert("Saved", "Reward settings updated.");
    } catch (e) {
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card}>
          <ToggleRow
            label="Rewards enabled"
            sub="Master switch for the whole program"
            value={cfg.enabled}
            onChange={(v) => setCfg({ ...cfg, enabled: v })}
          />
          <ToggleRow
            label="Cafe earning"
            sub="Earn points on cafe orders"
            value={cfg.cafeEarnEnabled}
            onChange={(v) => setCfg({ ...cfg, cafeEarnEnabled: v })}
          />
        </Card>

        <Text variant="tiny" color={colors.zinc500} style={styles.section}>
          EARN RATES
        </Text>
        <Card style={styles.card}>
          <Input label="Booking earn (bps · 100 = 1%)" keyboardType="numeric" {...num("earnRateBookingBps")} />
          <Input label="Cafe earn (bps · 100 = 1%)" keyboardType="numeric" {...num("earnRateCafeBps")} />
          <Input label="Point value (paise per point)" keyboardType="numeric" {...num("pointValuePaise")} />
        </Card>

        <Text variant="tiny" color={colors.zinc500} style={styles.section}>
          REDEMPTION
        </Text>
        <Card style={styles.card}>
          <Input label="Min points to redeem" keyboardType="numeric" {...num("minPointsToRedeem")} />
          <Input label="Max redemption (% of bill)" keyboardType="numeric" {...num("maxRedemptionPctOfBill")} />
          <Input label="Point expiry (months · 0 = never)" keyboardType="numeric" {...num("pointExpiryMonths")} />
        </Card>

        <Text variant="tiny" color={colors.zinc500} style={styles.section}>
          BONUSES
        </Text>
        <Card style={styles.card}>
          <Input label="Signup bonus (points)" keyboardType="numeric" {...num("signupBonusPoints")} />
          <Input label="Referral — referrer (points)" keyboardType="numeric" {...num("referralEarnerPoints")} />
          <Input label="Referral — new user (points)" keyboardType="numeric" {...num("referralReferredPoints")} />
        </Card>

        {err ? (
          <Text variant="small" color={colors.destructive}>
            {err}
          </Text>
        ) : null}

        <Button label="Save settings" onPress={save} loading={busy} fullWidth size="lg" />
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
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
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
});
