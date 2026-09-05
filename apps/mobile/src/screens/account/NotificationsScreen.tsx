import { useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BellRing,
  CalendarCheck,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  notificationsApi,
  type UserNotification,
} from "../../lib/user-notifications";

// Type → icon + accent. Unknown types fall back to the bell so new
// server-side types render without an app update.
const TYPE_ICON: Record<
  string,
  { Icon: typeof BellRing; color: string; bg: string }
> = {
  PASS_MEMBER_ADDED: { Icon: Users, color: "#a78bfa", bg: "rgba(139,92,246,0.15)" },
  PASS_BOOKING: { Icon: Ticket, color: colors.emerald400, bg: "rgba(16,185,129,0.15)" },
  PASS_PURCHASED: { Icon: Ticket, color: colors.emerald400, bg: "rgba(16,185,129,0.15)" },
  BOOKING_CONFIRMED: { Icon: CalendarCheck, color: "#60a5fa", bg: "rgba(59,130,246,0.15)" },
  REWARDS: { Icon: Sparkles, color: colors.yellow400, bg: "rgba(250,204,21,0.15)" },
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/**
 * "My Notifications" — every user-specific event (added to a pass,
 * pass-paid bookings, confirmations, …). Opening the screen marks
 * everything read (badge clears); the unread rows keep their highlight
 * for this one viewing.
 */
export function NotificationsScreen() {
  const qc = useQueryClient();
  /**
   * Paged, and virtualised below.
   *
   * The screen used to render every row inside a ScrollView from a single
   * request the server silently capped at 50 — so a heavy user's older
   * notifications simply vanished with nothing saying so, and every row
   * mounted at once. Production's busiest customer is at 26 today, which
   * is the right time to fix it rather than after someone loses history.
   */
  const list = useInfiniteQuery({
    // DISTINCT from the old ["notifications"] key on purpose. This screen
    // used to be a plain useQuery under that key, and the query cache is
    // persisted — so an infinite query reading the old cached shape found
    // no `pages` and React Query threw "Cannot read property 'length' of
    // undefined" inside getNextPageParam. Anyone upgrading would have hit
    // a red screen on a cache written by the previous version.
    queryKey: ["notifications", "list"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => notificationsApi.list(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const markRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () =>
      // Refresh the badge count wherever it's shown; keep THIS screen's
      // rows as-is so fresh items stay highlighted for this viewing.
      void qc.invalidateQueries({ queryKey: ["notifications", "unread"] }),
  });

  useEffect(() => {
    const unread = list.data?.pages[0]?.unread ?? 0;
    if (unread > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data?.pages[0]?.unread]);

  const items: UserNotification[] = (list.data?.pages ?? []).flatMap(
    (p) => p.notifications,
  );

  const renderRow = ({ item: n }: { item: UserNotification }) => {
    const t = TYPE_ICON[n.type] ?? {
      Icon: BellRing,
      color: colors.zinc400,
      bg: colors.zinc800,
    };
    const unread = !n.readAt;
    return (
      <View style={[styles.row, unread ? styles.rowUnread : styles.rowRead]}>
        <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
          <t.Icon size={18} color={t.color} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="small" weight="600" color={colors.foreground}>
            {n.title}
          </Text>
          <Text variant="tiny" color={colors.zinc400}>
            {n.body}
          </Text>
          <Text variant="tiny" color={colors.zinc600}>
            {timeAgo(n.createdAt)}
          </Text>
        </View>
        {unread ? <View style={styles.unreadDot} /> : null}
      </View>
    );
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={renderRow}
        contentContainerStyle={styles.scroll}
        ItemSeparatorComponent={() => <View style={{ height: spacing["2"] }} />}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
            tintColor={colors.zinc400}
          />
        }
        // Pull the next page a little before the end so the spinner is
        // rarely what the customer is looking at.
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) {
            void list.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          list.isLoading ? (
            <View style={{ gap: spacing["3"] }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <Skeleton width={36} height={36} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width={160} height={14} />
                    <Skeleton width="90%" height={12} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <BellRing size={34} color={colors.zinc600} />
              <Text
                variant="small"
                color={colors.zinc500}
                align="center"
                style={{ marginTop: spacing["3"] }}
              >
                Nothing yet — booking updates and pass activity will land here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={{ paddingVertical: spacing["5"] }}>
              <ActivityIndicator size="small" color={colors.zinc500} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["5"],
    paddingBottom: spacing["10"],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["4"],
  },
  rowUnread: {
    borderColor: "rgba(16,185,129,0.25)",
    backgroundColor: "rgba(16,185,129,0.05)",
  },
  rowRead: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing["2"],
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.emerald400,
    marginTop: 6,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: spacing["3"],
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
  },
  empty: {
    alignItems: "center",
    paddingVertical: spacing["12"],
    paddingHorizontal: spacing["6"],
  },
});
