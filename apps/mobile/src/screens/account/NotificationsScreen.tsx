import { useEffect } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, Pressable } from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BellOff,
  BellRing,
  CalendarCheck,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AccountStackParamList } from "../../navigation/types";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  notificationPrefsApi,
  notificationsApi,
  type NotificationPrefs,
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
 * The one thing the customer can switch off.
 *
 * Optimistic, and deliberately so: a toggle that waits for a round trip
 * before moving reads as broken on a slow connection, and someone
 * turning this off is already mildly annoyed. It snaps back if the save
 * fails, which is the honest behaviour — better a switch that visibly
 * refuses than one that says "off" while the pushes keep arriving.
 */
function OffersToggle() {
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => notificationPrefsApi.get(),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (offers: boolean) => notificationPrefsApi.set(offers),
    onMutate: async (offers) => {
      await qc.cancelQueries({ queryKey: ["notification-prefs"] });
      const prev = qc.getQueryData<NotificationPrefs>(["notification-prefs"]);
      qc.setQueryData(["notification-prefs"], { offers });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notification-prefs"], ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });

  // Nothing at all until we know the answer. A switch that renders "on"
  // and then flips to "off" a moment later tells the customer their
  // choice was not saved.
  if (prefs.isLoading || !prefs.data) return null;
  const on = prefs.data.offers;

  return (
    <Pressable
      onPress={() => save.mutate(!on)}
      style={styles.prefRow}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
    >
      <View style={styles.prefIcon}>
        {on ? (
          <BellRing size={18} color={colors.emerald400} />
        ) : (
          <BellOff size={18} color={colors.zinc400} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text weight="semibold" style={{ fontSize: 14 }}>
          Tips & offers
        </Text>
        <Text style={styles.prefHint}>
          {on
            ? "Free slots, expiring passes and the occasional nudge."
            : "Off. You'll still get booking confirmations and reminders."}
        </Text>
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

/**
 * "My Notifications" — every user-specific event (added to a pass,
 * pass-paid bookings, confirmations, …). Opening the screen marks
 * everything read (badge clears); the unread rows keep their highlight
 * for this one viewing.
 */
export function NotificationsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AccountStackParamList>>();
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
    // ALWAYS re-ask on mount. The global `staleTime` is 30 seconds and the
    // cache is persisted to disk, so opening the bell within that window —
    // which is exactly when something has just happened — showed a list that
    // predated the event. A captain who had just paid and won a prize opened
    // their notifications and saw neither.
    refetchOnMount: "always",
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
    // A notification that cannot be tapped is a dead end, and for anything
    // on a clock — a prize offer expires in thirty minutes — it is the
    // difference between a working feature and one nobody can reach in
    // time. `link` was written by the server, carried in the payload, typed
    // on the client, and read by nothing.
    const go = () => {
      const link = n.link;
      if (!link) return;
      const challenge = link.match(/^\/challenges\/([\w-]+)$/);
      if (challenge) {
        nav.navigate("ChallengeDetail", { id: challenge[1] });
        return;
      }
      const booking = link.match(/^\/bookings\/([\w-]+)$/);
      if (booking) {
        nav.navigate("BookingDetail", { bookingId: booking[1] });
        return;
      }
    };
    const Row = n.link ? Pressable : View;
    return (
      <Row
        onPress={go}
        style={[styles.row, unread ? styles.rowUnread : styles.rowRead]}
      >
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
      </Row>
    );
  };

  return (
    <Screen padded={false}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={renderRow}
        contentContainerStyle={styles.scroll}
        // The preference sits at the top of the list the customer opens
        // when they are thinking about notifications, rather than behind
        // its own row on the account menu. Somebody who has decided they
        // get too many of these is on THIS screen; making them find a
        // settings page first is how people reach for the OS switch
        // instead, which silences their booking confirmations too.
        ListHeaderComponent={<OffersToggle />}
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
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
    marginBottom: spacing["4"],
  },
  prefIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16,185,129,0.10)",
  },
  prefHint: {
    fontSize: 11,
    color: colors.zinc400,
    marginTop: 2,
  },
  track: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.zinc700,
    justifyContent: "center",
  },
  trackOn: { backgroundColor: colors.emerald500 },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#fff",
    marginLeft: 2,
  },
  knobOn: { marginLeft: 20 },
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
