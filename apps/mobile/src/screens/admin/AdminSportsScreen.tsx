import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, spacing } from "../../theme";
import {
  adminSportsApi,
  type AdminCourtConfig,
} from "../../lib/admin-sports";
import { sportLabel } from "../../lib/format";

export function AdminSportsScreen() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "sports"],
    queryFn: () => adminSportsApi.list(),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, AdminCourtConfig[]>();
    for (const c of list.data?.configs ?? []) {
      const arr = map.get(c.sport) ?? [];
      arr.push(c);
      map.set(c.sport, arr);
    }
    return Array.from(map.entries());
  }, [list.data]);

  const toggleConfig = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) =>
      adminSportsApi.toggleConfig(v.id, v.isActive),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "sports"] }),
  });
  const toggleSport = useMutation({
    mutationFn: (v: { sport: string; isActive: boolean }) =>
      adminSportsApi.toggleSport(v.sport, v.isActive),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "sports"] }),
  });

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isLoading}
            onRefresh={() => void list.refetch()}
            tintColor={colors.zinc400}
          />
        }
      >
        <Text variant="small" color={colors.zinc500}>
          Turn a whole sport or an individual court on/off. Off courts disappear
          from the customer booking grid.
        </Text>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1].map((i) => (
              <Skeleton key={i} width="100%" height={120} />
            ))}
          </View>
        ) : (
          <View style={styles.list}>
            {grouped.map(([sport, configs]) => {
              const allOn = configs.every((c) => c.isActive);
              return (
                <Card key={sport} style={styles.sportCard}>
                  <View style={styles.sportHead}>
                    <Text variant="bodyStrong" color={colors.foreground}>
                      {sportLabel(sport)}
                    </Text>
                    <Switch
                      value={allOn}
                      onValueChange={(v) =>
                        toggleSport.mutate({ sport, isActive: v })
                      }
                      trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                      thumbColor={allOn ? colors.emerald400 : colors.zinc400}
                    />
                  </View>
                  <View style={styles.divider} />
                  {configs.map((c) => (
                    <View key={c.id} style={styles.configRow}>
                      <View style={{ flex: 1 }}>
                        <Text variant="small" weight="500" color={colors.foreground}>
                          {c.label}
                        </Text>
                        <Text variant="tiny" color={colors.zinc500}>
                          {c.size}
                          {c.category ? ` · ${c.category}` : ""}
                        </Text>
                      </View>
                      <Switch
                        value={c.isActive}
                        onValueChange={(v) =>
                          toggleConfig.mutate({ id: c.id, isActive: v })
                        }
                        trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                        thumbColor={c.isActive ? colors.emerald400 : colors.zinc400}
                      />
                    </View>
                  ))}
                </Card>
              );
            })}
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
    gap: spacing["4"],
  },
  list: { gap: spacing["3"] },
  sportCard: { padding: spacing["4"] },
  sportHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.zinc800,
    marginVertical: spacing["3"],
  },
  configRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
});
