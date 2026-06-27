import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminInsightsApi,
  type EventRow,
  type EventsListResult,
  type ServerLogRow,
  type ServerLogsListResult,
} from "../../lib/admin-insights";

/**
 * Events & logs — mirrors web /admin/analytics/events. Two tabs:
 *   - Client events  → AnalyticsEvent rows
 *   - Server logs    → ServerActionLog rows
 *
 * Each is a simple cursor-paginated list (newest first) with a name
 * filter chip row built from the names present in the loaded pages.
 * Tapping "Load more" pulls the next page off `nextCursor`.
 */
type Tab = "client" | "server";

const PAGE = 50;

export function AdminEventsScreen() {
  const [tab, setTab] = useState<Tab>("client");
  const [nameFilter, setNameFilter] = useState<string | null>(null);

  return (
    <Screen padded={false}>
      <View style={styles.tabBar}>
        <TabButton
          label="Client events"
          active={tab === "client"}
          onPress={() => {
            setTab("client");
            setNameFilter(null);
          }}
        />
        <TabButton
          label="Server logs"
          active={tab === "server"}
          onPress={() => {
            setTab("server");
            setNameFilter(null);
          }}
        />
      </View>
      {tab === "client" ? (
        <ClientEventsList
          nameFilter={nameFilter}
          setNameFilter={setNameFilter}
        />
      ) : (
        <ServerLogsList
          nameFilter={nameFilter}
          setNameFilter={setNameFilter}
        />
      )}
    </Screen>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text
        variant="small"
        color={active ? colors.yellow400 : colors.zinc500}
        weight="600"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ClientEventsList({
  nameFilter,
  setNameFilter,
}: {
  nameFilter: string | null;
  setNameFilter: (n: string | null) => void;
}) {
  const query = useInfiniteQuery<EventsListResult>({
    queryKey: ["admin-events", "client", nameFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminInsightsApi.clientEvents({
        name: nameFilter ?? undefined,
        before: pageParam as string | undefined,
        limit: PAGE,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = useMemo<EventRow[]>(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.name);
    return [...set].sort();
  }, [rows]);

  return (
    <ListShell
      query={query}
      names={names}
      nameFilter={nameFilter}
      setNameFilter={setNameFilter}
      empty="No client events match."
    >
      {rows.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={styles.rowHead}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {r.name}
            </Text>
            <Badge label={r.category} />
          </View>
          <View style={styles.rowMeta}>
            <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
              {r.userName ?? r.userPhone ?? "anon"} · {r.platform}
            </Text>
            <Text variant="tiny" color={colors.zinc600}>
              {fmtTime(r.occurredAt)}
            </Text>
          </View>
        </View>
      ))}
    </ListShell>
  );
}

function ServerLogsList({
  nameFilter,
  setNameFilter,
}: {
  nameFilter: string | null;
  setNameFilter: (n: string | null) => void;
}) {
  const query = useInfiniteQuery<ServerLogsListResult>({
    queryKey: ["admin-events", "server", nameFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminInsightsApi.serverLogs({
        name: nameFilter ?? undefined,
        before: pageParam as string | undefined,
        limit: PAGE,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = useMemo<ServerLogRow[]>(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.action);
    return [...set].sort();
  }, [rows]);

  return (
    <ListShell
      query={query}
      names={names}
      nameFilter={nameFilter}
      setNameFilter={setNameFilter}
      empty="No server logs match."
    >
      {rows.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={styles.rowHead}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {r.action}
            </Text>
            <Badge label={r.outcome} tone={outcomeTone(r.outcome)} />
          </View>
          <View style={styles.rowMeta}>
            <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
              {r.category}
              {r.sport ? ` · ${r.sport}` : ""} ·{" "}
              {r.userName ?? r.userPhone ?? "system"}
            </Text>
            <Text variant="tiny" color={colors.zinc600}>
              {fmtTime(r.occurredAt)}
            </Text>
          </View>
          {r.error ? (
            <Text variant="tiny" color={colors.destructive_300} numberOfLines={2}>
              {r.error}
            </Text>
          ) : null}
        </View>
      ))}
    </ListShell>
  );
}

/** Shared chrome: name-filter chips, loading/error/empty, list body,
 *  pull-to-refresh, and a Load-more footer. */
function ListShell({
  query,
  names,
  nameFilter,
  setNameFilter,
  empty,
  children,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    isRefetching: boolean;
    refetch: () => unknown;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };
  names: string[];
  nameFilter: string | null;
  setNameFilter: (n: string | null) => void;
  empty: string;
  children: React.ReactNode;
}) {
  const refreshing =
    (query.isFetching && !query.isLoading) || query.isRefetching;
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          tintColor={colors.yellow400}
        />
      }
    >
      {/* Name filter — only meaningful once we have some rows loaded. */}
      {names.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Pressable
            onPress={() => setNameFilter(null)}
            style={[styles.chip, nameFilter == null && styles.chipActive]}
          >
            <Text
              variant="tiny"
              color={nameFilter == null ? colors.yellow400 : colors.zinc300}
              weight="600"
            >
              All
            </Text>
          </Pressable>
          {names.map((n) => (
            <Pressable
              key={n}
              onPress={() => setNameFilter(n)}
              style={[styles.chip, nameFilter === n && styles.chipActive]}
            >
              <Text
                variant="tiny"
                color={nameFilter === n ? colors.yellow400 : colors.zinc300}
                weight="600"
              >
                {n}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {query.isLoading ? (
        <View style={{ gap: spacing["2"] }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={56} rounded="md" />
          ))}
        </View>
      ) : query.isError ? (
        <Pressable
          onPress={() => void query.refetch()}
          style={styles.errorBlock}
        >
          <Text variant="body" color={colors.destructive}>
            Couldn't load. Tap to retry.
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {query.error instanceof Error
              ? query.error.message
              : "Unknown error"}
          </Text>
        </Pressable>
      ) : !hasChildren ? (
        <View style={styles.row}>
          <Text variant="tiny" color={colors.zinc600}>
            {empty}
          </Text>
        </View>
      ) : (
        <View style={{ gap: spacing["2"] }}>{children}</View>
      )}

      {query.hasNextPage ? (
        <Pressable
          onPress={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          style={styles.loadMore}
        >
          <Text variant="small" color={colors.zinc300} weight="600">
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const bg =
    tone === "success"
      ? "rgba(16, 185, 129, 0.12)"
      : tone === "danger"
        ? "rgba(239, 68, 68, 0.12)"
        : colors.zinc800;
  const fg =
    tone === "success"
      ? colors.emerald400
      : tone === "danger"
        ? colors.destructive_300
        : colors.zinc400;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="tiny" color={fg} weight="600">
        {label}
      </Text>
    </View>
  );
}

function outcomeTone(outcome: string): "neutral" | "success" | "danger" {
  const o = outcome.toUpperCase();
  if (o === "SUCCESS" || o === "OK") return "success";
  if (o === "FAILURE" || o === "ERROR" || o === "DENIED") return "danger";
  return "neutral";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["2.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  tabActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
  },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
  },
  row: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
    gap: 6,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  badge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 6,
  },
  loadMore: {
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
