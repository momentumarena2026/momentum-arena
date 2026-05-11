import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Search, Sparkles, Users } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import {
  adminRewardsApi,
  type AdminUserSearchRow,
} from "../../lib/admin-rewards";

/**
 * Mobile admin bulk-grant points. Same flow as the web
 * /admin/rewards/distribute page — type a query, tap to multi-select,
 * enter points + reason, hit Grant. Each grant raises an
 * ADJUSTMENT_AUDIT alert on the customer's profile.
 */
export function AdminRewardsDistributeScreen() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState("100");
  const [reason, setReason] = useState("");

  const usersQ = useQuery({
    queryKey: ["admin", "rewards", "users", query],
    queryFn: () => adminRewardsApi.searchUsers(query, 50),
  });

  const grantM = useMutation({
    mutationFn: () =>
      adminRewardsApi.grant({
        userIds: Array.from(selected),
        points: parseInt(points || "0", 10),
        reason: reason.trim(),
      }),
    onSuccess: (data) => {
      Alert.alert(
        "Points granted",
        `Awarded ${data.totalPointsAwarded.toLocaleString("en-IN")} pts across ${data.granted} users (${data.skipped} skipped).`,
      );
      setSelected(new Set());
    },
    onError: (err: unknown) => {
      Alert.alert(
        "Couldn't grant",
        err instanceof Error ? err.message : "Try again.",
      );
    },
  });

  const users = usersQ.data?.users ?? [];
  const allChecked =
    users.length > 0 && users.every((u) => selected.has(u.userId));

  const toggleAll = useCallback(() => {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map((u) => u.userId)));
    }
  }, [allChecked, users]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const totalPreview = useMemo(
    () => selected.size * (parseInt(points || "0", 10) || 0),
    [selected.size, points],
  );

  const handleGrant = () => {
    if (selected.size === 0) {
      Alert.alert("Pick at least one user");
      return;
    }
    const p = parseInt(points || "0", 10);
    if (!p || p <= 0) {
      Alert.alert("Points must be > 0");
      return;
    }
    if (reason.trim().length < 3) {
      Alert.alert("Reason required (≥ 3 characters)");
      return;
    }
    grantM.mutate();
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Distribute points</Text>
        <Text style={styles.subhead}>
          Pick users, set points + reason, tap Grant. Each grant is audited.
        </Text>

        <View style={styles.formCard}>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>Points per user</Text>
              <TextInput
                value={points}
                onChangeText={setPoints}
                keyboardType="number-pad"
                style={styles.input}
                placeholderTextColor={colors.zinc600}
              />
            </View>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.label}>Reason</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Diwali bonus"
                placeholderTextColor={colors.zinc600}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              <Text style={styles.summaryStrong}>{selected.size}</Text>{" "}
              selected ·{" "}
              <Text style={[styles.summaryStrong, { color: colors.emerald400 }]}>
                {totalPreview.toLocaleString("en-IN")}
              </Text>{" "}
              pts total
            </Text>
            <Pressable
              onPress={handleGrant}
              disabled={grantM.isPending || selected.size === 0}
              style={({ pressed }) => [
                styles.grantBtn,
                (grantM.isPending || selected.size === 0) && {
                  opacity: 0.5,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              {grantM.isPending ? (
                <ActivityIndicator color={colors.foreground} size="small" />
              ) : (
                <>
                  <Sparkles size={14} color={colors.foreground} />
                  <Text style={styles.grantBtnText}>Grant</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Search size={16} color={colors.zinc500} style={{ position: "absolute", left: 10, top: 12 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, email, phone"
              placeholderTextColor={colors.zinc600}
              style={styles.searchInput}
              returnKeyType="search"
              autoCapitalize="none"
            />
          </View>
          {users.length > 0 && (
            <Pressable
              onPress={toggleAll}
              style={({ pressed }) => [
                styles.selectAllBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.selectAllText}>
                {allChecked ? "Clear" : "Select all"}
              </Text>
            </Pressable>
          )}
        </View>

        {usersQ.isLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : users.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={20} color={colors.zinc500} />
            <Text style={styles.emptyTitle}>No users match</Text>
            <Text style={styles.emptySub}>
              Try a different search or leave the box empty to see all.
            </Text>
          </View>
        ) : (
          <View style={styles.userList}>
            {users.map((u) => (
              <UserRow
                key={u.userId}
                user={u}
                selected={selected.has(u.userId)}
                onToggle={() => toggleOne(u.userId)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function UserRow({
  user,
  selected,
  onToggle,
}: {
  user: AdminUserSearchRow;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.userRow,
        selected && styles.userRowSelected,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          selected && styles.checkboxOn,
        ]}
      >
        {selected && <Check size={12} color={colors.foreground} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.userName} numberOfLines={1}>
          {user.name ?? "—"}
        </Text>
        <Text style={styles.userMeta} numberOfLines={1}>
          {user.phone ?? user.email ?? user.userId}
        </Text>
      </View>
      <View style={styles.balanceCol}>
        <Text style={styles.balanceText}>
          {user.pointsAvailable.toLocaleString("en-IN")}
        </Text>
        <Text style={styles.balanceUnit}>pts</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.foreground,
  },
  subhead: {
    fontSize: 13,
    color: colors.zinc400,
    marginBottom: spacing["2"],
  },
  formCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    gap: spacing["3"],
  },
  row: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  field: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.zinc400,
    marginBottom: 4,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
    paddingHorizontal: spacing["3"],
    paddingVertical: 10,
    color: colors.foreground,
    fontSize: 14,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
    flexWrap: "wrap",
  },
  summaryText: {
    fontSize: 12,
    color: colors.zinc400,
    flexShrink: 1,
  },
  summaryStrong: {
    fontWeight: "700",
    color: colors.foreground,
  },
  grantBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primaryHover,
    paddingHorizontal: spacing["4"],
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  grantBtnText: {
    color: colors.foreground,
    fontWeight: "600",
    fontSize: 13,
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing["2"],
    marginTop: spacing["2"],
  },
  searchInputWrap: {
    flex: 1,
    position: "relative",
  },
  searchInput: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
    paddingLeft: 36,
    paddingRight: spacing["3"],
    paddingVertical: 10,
    color: colors.foreground,
    fontSize: 14,
  },
  selectAllBtn: {
    paddingHorizontal: spacing["3"],
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
  },
  selectAllText: {
    fontSize: 12,
    color: colors.zinc300,
  },
  loadingBlock: {
    paddingVertical: spacing["6"],
    alignItems: "center",
  },
  userList: {
    gap: spacing["2"],
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["3"],
  },
  userRowSelected: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  userName: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  userMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.zinc500,
  },
  balanceCol: {
    alignItems: "flex-end",
  },
  balanceText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.emerald400,
  },
  balanceUnit: {
    fontSize: 10,
    color: colors.zinc600,
  },
  emptyCard: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderStyle: "dashed",
    backgroundColor: "rgba(24, 24, 27, 0.30)",
    paddingVertical: spacing["6"],
    paddingHorizontal: spacing["4"],
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.zinc300,
  },
  emptySub: {
    fontSize: 12,
    color: colors.zinc600,
    textAlign: "center",
  },
});
