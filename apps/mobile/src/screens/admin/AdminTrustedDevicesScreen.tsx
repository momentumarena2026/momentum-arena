import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshControl } from "react-native";
import { Smartphone, Trash2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import {
  adminTrustedDevicesApi,
  type AdminTrustedDevice,
} from "../../lib/admin-trusted-devices";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Trusted-device allowlist manager — mobile twin of the web
 * /admin/trusted-devices page. Devices on this list can open the
 * hidden admin entry (5 taps on the customer app's version footer);
 * everyone else gets nothing. A device's ID is revealed by tapping the
 * version number 12 times on that device.
 *
 * Rename lives on the web page; mobile keeps the frequent operations —
 * see what's registered, add a pasted ID, remove a lost phone.
 */
export function AdminTrustedDevicesScreen() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "trusted-devices"],
    queryFn: () => adminTrustedDevicesApi.list(),
  });

  const [deviceId, setDeviceId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const devices = data?.devices ?? [];

  async function handleAdd() {
    if (!deviceId.trim() || !label.trim() || saving) return;
    setSaving(true);
    try {
      await adminTrustedDevicesApi.add({
        deviceId: deviceId.trim(),
        label: label.trim(),
      });
      setDeviceId("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["admin", "trusted-devices"] });
    } catch (err) {
      Alert.alert(
        "Couldn't add device",
        err instanceof AdminApiError ? err.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleRemove(d: AdminTrustedDevice) {
    Alert.alert(
      "Remove device?",
      `“${d.label}” will lose the 5-tap admin entry.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await adminTrustedDevicesApi.remove(d.id);
              } catch {
                Alert.alert("Couldn't remove device", "Please try again.");
              } finally {
                void qc.invalidateQueries({
                  queryKey: ["admin", "trusted-devices"],
                });
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <Screen padded={false} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <Text variant="small" color={colors.zinc400}>
          Devices on this list can open the hidden admin entry — 5 taps on
          the app&apos;s version number. On any other device the taps do
          nothing; 12 taps there reveal its device ID for registration.
        </Text>

        {/* Add form */}
        <View style={styles.card}>
          <Text variant="bodyStrong" color={colors.foreground}>
            Add a device
          </Text>
          <TextInput
            value={deviceId}
            onChangeText={setDeviceId}
            placeholder="Device ID (from 12 taps on the version)"
            placeholderTextColor={colors.zinc600}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Label — e.g. Nakul's iPhone"
            placeholderTextColor={colors.zinc600}
            style={styles.input}
          />
          <Button
            label="Add device"
            onPress={() => void handleAdd()}
            loading={saving}
            disabled={!deviceId.trim() || !label.trim()}
            fullWidth
          />
        </View>

        {/* List */}
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError ? (
          <View style={styles.card}>
            <Text variant="small" color={colors.destructive_300}>
              Couldn&apos;t load devices. Pull to retry.
            </Text>
          </View>
        ) : devices.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text variant="small" color="#fde68a">
              No devices registered — the 5-tap admin entry is disabled on
              every device until you add one.
            </Text>
          </View>
        ) : (
          devices.map((d) => (
            <View key={d.id} style={styles.deviceRow}>
              <View style={styles.deviceIcon}>
                <Smartphone size={18} color={colors.zinc400} />
              </View>
              <View style={styles.deviceBody}>
                <View style={styles.deviceTitleRow}>
                  <Text
                    variant="bodyStrong"
                    color={colors.foreground}
                    numberOfLines={1}
                    style={styles.deviceLabel}
                  >
                    {d.label}
                  </Text>
                  <View
                    style={[
                      styles.sourcePill,
                      d.source === "LOGIN"
                        ? styles.sourcePillLogin
                        : styles.sourcePillManual,
                    ]}
                  >
                    <Text
                      variant="tiny"
                      color={
                        d.source === "LOGIN"
                          ? colors.emerald400
                          : colors.zinc300
                      }
                    >
                      {d.source === "LOGIN" ? "Admin login" : "Manual"}
                    </Text>
                  </View>
                </View>
                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  numberOfLines={1}
                  style={styles.deviceId}
                >
                  {d.deviceId}
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  Last seen{" "}
                  {new Date(d.lastSeenAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <Pressable
                onPress={() => handleRemove(d)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.removeBtn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Trash2 size={16} color={colors.destructive_300} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    gap: spacing["4"],
    paddingBottom: spacing["10"],
  },
  center: {
    paddingVertical: spacing["8"],
    alignItems: "center",
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    padding: spacing["4"],
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    fontSize: 14,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["3"],
  },
  deviceIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceBody: { flex: 1, gap: 2, minWidth: 0 },
  deviceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  deviceLabel: { flexShrink: 1 },
  sourcePill: {
    borderRadius: 999,
    paddingHorizontal: spacing["2"],
    paddingVertical: 1,
  },
  sourcePillLogin: { backgroundColor: colors.emerald500_10 },
  sourcePillManual: { backgroundColor: colors.zinc800 },
  deviceId: { fontVariant: ["tabular-nums"] },
  removeBtn: {
    padding: spacing["2"],
  },
});
