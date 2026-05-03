import { useCallback } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  Calendar,
  ChevronRight,
  Clock,
  Trash2,
  Trophy,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { waitlistApi, type WaitlistEntry } from "../../lib/waitlist";
import {
  trackWaitlistCancelled,
  trackWaitlistRowBookNow,
} from "../../lib/analytics";
import {
  formatDate,
  formatHourRangeCompact,
  sportEmoji,
  sportLabel,
} from "../../lib/format";
import type {
  AccountStackParamList,
  BookStackParamList,
  MainTabsParamList,
} from "../../navigation/types";
import type { Sport } from "../../lib/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "Waitlist">;
type BookNav = NativeStackNavigationProp<BookStackParamList>;

export function WaitlistScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["waitlist", "mine"],
    queryFn: () => waitlistApi.mine(),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => waitlistApi.cancel(id),
    onSuccess: (_data, id) => {
      trackWaitlistCancelled(id);
      void queryClient.invalidateQueries({ queryKey: ["waitlist", "mine"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Couldn't remove entry.";
      Alert.alert("Couldn't remove", msg);
    },
  });

  const handleCancel = useCallback(
    (entry: WaitlistEntry) => {
      Alert.alert(
        "Remove from waitlist?",
        `${sportLabel(entry.courtConfig.sport)} · ${entry.courtConfig.label}`,
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => cancelMutation.mutate(entry.id),
          },
        ],
      );
    },
    [cancelMutation],
  );

  const handleBookNow = useCallback(
    (entry: WaitlistEntry) => {
      trackWaitlistRowBookNow(entry.id);
      // Jump into the regular booking flow on the same court so the
      // user can lock + checkout. The slot grid will refetch
      // availability and reveal the now-open hour.
      const tabsNav = navigation.getParent<
        BottomTabNavigationProp<MainTabsParamList>
      >();
      tabsNav?.navigate("Sports", {
        screen: "BookSlots",
        params: {
          courtConfigId: entry.courtConfig.id,
          courtLabel: entry.courtConfig.label,
          sport: entry.courtConfig.sport as Sport,
        },
      });
    },
    [navigation],
  );

  const entries = data?.entries ?? [];

  return (
    <Screen padded={false}>
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
        <View style={styles.header}>
          <Bell size={20} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text variant="title">My waitlist</Text>
            <Text variant="small" color={colors.zinc400}>
              We'll alert you on push and SMS the moment any of these slots
              opens up.
            </Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.list}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                width="100%"
                height={96}
                rounded="lg"
                style={styles.skeletonRow}
              />
            ))}
          </View>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => (
              <WaitlistRow
                key={entry.id}
                entry={entry}
                onBookNow={() => handleBookNow(entry)}
                onCancel={() => handleCancel(entry)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Bell size={24} color={colors.zinc500} />
      </View>
      <Text variant="heading" weight="600" style={styles.emptyTitle}>
        You're not waiting for any slots yet
      </Text>
      <Text
        variant="small"
        color={colors.zinc400}
        style={styles.emptyBody}
      >
        Tap any unavailable slot in the booking flow and we'll add it here.
        As soon as someone cancels, you'll get a push and SMS so you can
        grab it first.
      </Text>
    </View>
  );
}

function WaitlistRow({
  entry,
  onBookNow,
  onCancel,
}: {
  entry: WaitlistEntry;
  onBookNow: () => void;
  onCancel: () => void;
}) {
  const isNotified = entry.status === "NOTIFIED";
  const dateLabel = formatDate(entry.date);
  const timeLabel =
    entry.endHour - entry.startHour === 1
      ? formatHourRangeCompact(entry.startHour)
      : `${formatHourRangeCompact(entry.startHour)} → ${formatHourRangeCompact(entry.endHour - 1)}`;

  return (
    <View style={[styles.row, isNotified && styles.rowNotified]}>
      <View style={styles.rowHeader}>
        <Trophy size={16} color={colors.warning} />
        <Text variant="body" weight="600" style={styles.rowTitle}>
          {sportEmoji(entry.courtConfig.sport)} {sportLabel(entry.courtConfig.sport)}
        </Text>
        <Text variant="small" color={colors.zinc500}>
          ·
        </Text>
        <Text variant="small" color={colors.zinc300}>
          {entry.courtConfig.label}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <View style={styles.metaItem}>
          <Calendar size={12} color={colors.zinc400} />
          <Text variant="small" color={colors.zinc400}>
            {dateLabel}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Clock size={12} color={colors.zinc400} />
          <Text variant="small" color={colors.zinc400}>
            {timeLabel}
          </Text>
        </View>
      </View>

      {isNotified && (
        <View style={styles.notifiedBanner}>
          <BellRing size={14} color={colors.emerald400} />
          <Text variant="tiny" color={colors.emerald400} weight="600">
            Slot opened — book before someone else
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        {isNotified && (
          <Button
            label="Book now"
            onPress={onBookNow}
            size="sm"
            style={{ flex: 1 }}
          />
        )}
        <Pressable onPress={onCancel} style={styles.removeBtn} hitSlop={6}>
          <Trash2 size={14} color={colors.destructive} />
          <Text variant="small" color={colors.destructive}>
            Remove
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    marginBottom: spacing["4"],
  },
  list: {
    gap: spacing["3"],
  },
  skeletonRow: {
    marginBottom: 0,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing["4"],
    gap: spacing["2"],
  },
  rowNotified: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    flexWrap: "wrap",
  },
  rowTitle: {
    flexShrink: 1,
  },
  rowMeta: {
    flexDirection: "row",
    gap: spacing["4"],
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  notifiedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.emerald500_10,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    borderRadius: radius.md,
    paddingVertical: spacing["1.5"],
    paddingHorizontal: spacing["2.5"],
    alignSelf: "flex-start",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: spacing["2"],
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing["6"],
    alignItems: "center",
    gap: spacing["3"],
  },
  emptyIcon: {
    backgroundColor: colors.zinc900,
    borderRadius: 999,
    padding: spacing["3"],
  },
  emptyTitle: {
    textAlign: "center",
  },
  emptyBody: {
    textAlign: "center",
    lineHeight: 20,
  },
});
