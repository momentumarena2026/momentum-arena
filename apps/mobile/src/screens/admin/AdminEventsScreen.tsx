import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  ANALYTICS_CATEGORIES,
  OUTCOME_OPTIONS,
  adminEventsApi,
  extractPaymentMethodFromMetadata,
  extractSportFromMetadata,
  formatPaymentMethodLabel,
  getServerActionLabel,
  type EventRow,
  type EventsListResult,
  type ServerLogRow,
  type ServerLogsListResult,
} from "../../lib/admin-events";

/**
 * Events & logs — mirrors web /admin/analytics/events. Two tabs:
 *   - Client events  → AnalyticsEvent rows (events-client.tsx)
 *   - Server logs    → ServerActionLog rows (server-logs-client.tsx)
 *
 * Each is a cursor-paginated list (newest first) with the web's full
 * filter set:
 *   Client → event name, category, user ID, session ID
 *   Server → action, category, outcome, user ID
 * Name/action options come from the distinct-name endpoint (the whole
 * universe of names, not just the loaded pages, matching the web
 * dropdowns). Rows expand to show the properties / metadata JSON,
 * page URL or path/method, errors, and tap-to-filter shortcuts.
 */
type Tab = "client" | "server";

const PAGE = 50;

type ClientFilters = {
  name?: string;
  category?: string;
  userId?: string;
  sessionId?: string;
};

type ServerFilters = {
  action?: string;
  category?: string;
  outcome?: string;
  userId?: string;
};

export function AdminEventsScreen() {
  const [tab, setTab] = useState<Tab>("client");
  const [clientFilters, setClientFilters] = useState<ClientFilters>({});
  const [serverFilters, setServerFilters] = useState<ServerFilters>({});

  return (
    <Screen padded={false}>
      <View style={styles.tabBar}>
        <TabButton
          label="Client events"
          active={tab === "client"}
          onPress={() => setTab("client")}
        />
        <TabButton
          label="Server logs"
          active={tab === "server"}
          onPress={() => setTab("server")}
        />
      </View>
      {tab === "client" ? (
        <ClientEventsList
          filters={clientFilters}
          setFilters={setClientFilters}
        />
      ) : (
        <ServerLogsList
          filters={serverFilters}
          setFilters={setServerFilters}
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

// ───────────────────────── Client events ─────────────────────────

function ClientEventsList({
  filters,
  setFilters,
}: {
  filters: ClientFilters;
  setFilters: (f: ClientFilters) => void;
}) {
  const query = useInfiniteQuery<EventsListResult>({
    queryKey: ["admin-events", "client", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminEventsApi.clientEvents({
        ...filters,
        before: pageParam as string | undefined,
        limit: PAGE,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const names = useQuery({
    queryKey: ["admin-events", "event-names"],
    queryFn: () => adminEventsApi.eventNames(),
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo<EventRow[]>(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  const hasFilters = Boolean(
    filters.name || filters.category || filters.userId || filters.sessionId,
  );

  return (
    <ListShell
      query={query}
      empty="No client events match these filters."
      filterBar={
        <FilterBar hasFilters={hasFilters} onClear={() => setFilters({})}>
          <FilterDropdown
            label="Event name"
            value={filters.name}
            options={names.data ?? []}
            onChange={(name) => setFilters({ ...filters, name })}
          />
          <FilterDropdown
            label="Category"
            value={filters.category}
            options={[...ANALYTICS_CATEGORIES]}
            onChange={(category) => setFilters({ ...filters, category })}
          />
          <FilterTextField
            label="User ID"
            value={filters.userId}
            placeholder="cuid…"
            onCommit={(userId) => setFilters({ ...filters, userId })}
          />
          <FilterTextField
            label="Session ID"
            value={filters.sessionId}
            placeholder="cuid…"
            onCommit={(sessionId) => setFilters({ ...filters, sessionId })}
          />
        </FilterBar>
      }
    >
      {rows.map((r) => (
        <EventListItem key={r.id} row={r} setFilters={setFilters} />
      ))}
    </ListShell>
  );
}

function EventListItem({
  row,
  setFilters,
}: {
  row: EventRow;
  setFilters: (f: ClientFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.rowHeader}
      >
        <Chevron open={open} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.rowHead}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {row.name}
            </Text>
            <Badge label={row.category} />
            <Badge label={row.platform} />
          </View>
          <View style={styles.rowMeta}>
            <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
              {row.userName ?? row.userPhone ?? "anon"}
            </Text>
            <Text variant="tiny" color={colors.zinc600}>
              {fmtTime(row.occurredAt)}
            </Text>
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.detail}>
          <View style={styles.detailFilters}>
            {row.userId ? (
              <FilterChipButton
                label={`User: ${row.userId.slice(0, 10)}…`}
                onPress={() => setFilters({ userId: row.userId ?? undefined })}
              />
            ) : null}
            <FilterChipButton
              label={`Session: ${row.sessionId.slice(0, 10)}…`}
              onPress={() => setFilters({ sessionId: row.sessionId })}
            />
          </View>
          <JsonBlock value={row.properties} />
          {row.pageUrl ? (
            <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
              {row.pageUrl}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── Server logs ─────────────────────────

function ServerLogsList({
  filters,
  setFilters,
}: {
  filters: ServerFilters;
  setFilters: (f: ServerFilters) => void;
}) {
  const query = useInfiniteQuery<ServerLogsListResult>({
    queryKey: ["admin-events", "server", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminEventsApi.serverLogs({
        ...filters,
        before: pageParam as string | undefined,
        limit: PAGE,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const names = useQuery({
    queryKey: ["admin-events", "action-names"],
    queryFn: () => adminEventsApi.actionNames(),
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo<ServerLogRow[]>(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  const hasFilters = Boolean(
    filters.action || filters.category || filters.outcome || filters.userId,
  );

  return (
    <ListShell
      query={query}
      empty="No server logs match these filters."
      filterBar={
        <FilterBar hasFilters={hasFilters} onClear={() => setFilters({})}>
          <FilterDropdown
            label="Action"
            value={filters.action}
            options={names.data ?? []}
            renderOption={(o) => {
              const label = getServerActionLabel(o);
              return label === o ? o : label;
            }}
            onChange={(action) => setFilters({ ...filters, action })}
          />
          <FilterDropdown
            label="Category"
            value={filters.category}
            options={[...ANALYTICS_CATEGORIES]}
            onChange={(category) => setFilters({ ...filters, category })}
          />
          <FilterDropdown
            label="Outcome"
            value={filters.outcome}
            options={[...OUTCOME_OPTIONS]}
            onChange={(outcome) => setFilters({ ...filters, outcome })}
          />
          <FilterTextField
            label="User ID"
            value={filters.userId}
            placeholder="cuid…"
            onCommit={(userId) => setFilters({ ...filters, userId })}
          />
        </FilterBar>
      }
    >
      {rows.map((r) => (
        <ServerLogListItem key={r.id} row={r} setFilters={setFilters} />
      ))}
    </ListShell>
  );
}

function ServerLogListItem({
  row,
  setFilters,
}: {
  row: ServerLogRow;
  setFilters: (f: ServerFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = getServerActionLabel(row.action);
  const sport = row.sport ?? extractSportFromMetadata(row.metadata);
  const paymentMethod = extractPaymentMethodFromMetadata(row.metadata);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.rowHeader}
      >
        <Chevron open={open} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.rowHead}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {label}
            </Text>
            <Badge
              label={row.outcome === "success" ? "Success" : "Failed"}
              tone={outcomeTone(row.outcome)}
            />
          </View>
          <View style={styles.badgeRow}>
            {sport ? <Badge label={sport} tone="info" /> : null}
            {paymentMethod ? (
              <Badge label={formatPaymentMethodLabel(paymentMethod)} tone="info" />
            ) : null}
            <Badge label={row.category} />
            <Badge label={row.platform} />
          </View>
          <View style={styles.rowMeta}>
            <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
              {row.userName ?? row.userPhone ?? "system"}
            </Text>
            <Text variant="tiny" color={colors.zinc600}>
              {fmtTime(row.occurredAt)}
            </Text>
          </View>
          {row.error ? (
            <Text variant="tiny" color={colors.destructive_300} numberOfLines={2}>
              {row.error}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <View style={styles.detail}>
          <View style={styles.detailFilters}>
            {row.userId ? (
              <FilterChipButton
                label={
                  row.userName || row.userPhone
                    ? `User: ${row.userName ?? "Unknown"}${
                        row.userPhone ? ` · ${row.userPhone}` : ""
                      }`
                    : `User: ${row.userId.slice(0, 10)}…`
                }
                onPress={() => setFilters({ userId: row.userId ?? undefined })}
              />
            ) : null}
            <FilterChipButton
              label="Filter by action"
              onPress={() => setFilters({ action: row.action })}
            />
          </View>
          {row.path || row.method ? (
            <Text variant="tiny" color={colors.zinc500} numberOfLines={1}>
              {row.method ? `${row.method} ` : ""}
              {row.path ?? ""}
            </Text>
          ) : null}
          {row.error ? (
            <Text variant="tiny" color={colors.destructive_300}>
              {row.error}
            </Text>
          ) : null}
          <JsonBlock value={row.metadata} />
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── Shared chrome ─────────────────────────

/** List body: filter bar, loading/error/empty, rows, pull-to-refresh,
 *  Load-more footer. */
function ListShell({
  query,
  empty,
  filterBar,
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
  empty: string;
  filterBar: React.ReactNode;
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
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          tintColor={colors.yellow400}
        />
      }
    >
      {filterBar}

      {query.isLoading ? (
        <View style={{ gap: spacing["2"] }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={64} rounded="md" />
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

function FilterBar({
  hasFilters,
  onClear,
  children,
}: {
  hasFilters: boolean;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterBar}>
      {children}
      {hasFilters ? (
        <Pressable onPress={onClear} style={styles.clearBtn}>
          <X size={13} color={colors.zinc300} />
          <Text variant="tiny" color={colors.zinc300} weight="600">
            Clear
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A dropdown filter: a tappable field that opens an inline searchable
 *  option list. Mirrors the web <select> / searchable list filters. */
function FilterDropdown({
  label,
  value,
  options,
  onChange,
  renderOption = (o) => o,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (value: string | undefined) => void;
  renderOption?: (option: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.toLowerCase().includes(q) ||
        renderOption(o).toLowerCase().includes(q),
    );
  }, [options, query, renderOption]);

  return (
    <View style={styles.field}>
      <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
        {label.toUpperCase()}
      </Text>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.fieldControl}
      >
        <Text
          variant="small"
          color={value ? colors.foreground : colors.zinc500}
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {value ? renderOption(value) : "— any —"}
        </Text>
        {value ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            <X size={13} color={colors.zinc500} />
          </Pressable>
        ) : (
          <ChevronDown size={14} color={colors.zinc500} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.dropdown}>
          {options.length > 8 ? (
            <View style={styles.dropdownSearch}>
              <Search size={13} color={colors.zinc500} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={colors.zinc600}
                style={styles.dropdownSearchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}
          <ScrollView
            style={{ maxHeight: 220 }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <Pressable
              style={styles.dropdownItem}
              onPress={() => {
                onChange(undefined);
                setOpen(false);
                setQuery("");
              }}
            >
              <Text variant="small" color={colors.zinc400}>
                — any —
              </Text>
            </Pressable>
            {filtered.length === 0 ? (
              <View style={styles.dropdownItem}>
                <Text variant="small" color={colors.zinc500}>
                  No matches
                </Text>
              </View>
            ) : (
              filtered.map((o) => (
                <Pressable
                  key={o}
                  style={styles.dropdownItem}
                  onPress={() => {
                    onChange(o);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Text
                    variant="small"
                    color={value === o ? colors.emerald400 : colors.foreground}
                    numberOfLines={1}
                  >
                    {renderOption(o)}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** A free-text filter committed on submit/blur — for user / session IDs. */
function FilterTextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onCommit: (value: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? "");

  // Keep local text in sync when the filter is cleared/changed externally.
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value ?? "");
  }

  function commit() {
    const trimmed = text.trim();
    onCommit(trimmed ? trimmed : undefined);
  }

  return (
    <View style={styles.field}>
      <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
        {label.toUpperCase()}
      </Text>
      <View style={styles.fieldControl}>
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder={placeholder}
          placeholderTextColor={colors.zinc600}
          style={styles.textFieldInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {text ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              setText("");
              onCommit(undefined);
            }}
          >
            <X size={13} color={colors.zinc500} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function FilterChipButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.detailFilterChip}>
      <Text variant="tiny" color={colors.zinc300} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const json = useMemo(() => {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.jsonBlock}
    >
      <Text variant="tiny" color={colors.zinc300} style={styles.jsonText}>
        {json}
      </Text>
    </ScrollView>
  );
}

function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown size={14} color={colors.zinc500} style={{ marginTop: 2 }} />
  ) : (
    <ChevronRight size={14} color={colors.zinc500} style={{ marginTop: 2 }} />
  );
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "danger" | "info";
}) {
  const bg =
    tone === "success"
      ? "rgba(16, 185, 129, 0.12)"
      : tone === "danger"
        ? "rgba(239, 68, 68, 0.12)"
        : tone === "info"
          ? "rgba(59, 130, 246, 0.12)"
          : colors.zinc800;
  const fg =
    tone === "success"
      ? colors.emerald400
      : tone === "danger"
        ? colors.destructive_300
        : tone === "info"
          ? "#93c5fd"
          : colors.zinc400;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="tiny" color={fg} weight="600">
        {label}
      </Text>
    </View>
  );
}

function outcomeTone(outcome: string): "success" | "danger" | "neutral" {
  const o = outcome.toLowerCase();
  if (o === "success" || o === "ok") return "success";
  if (o === "error" || o === "failure" || o === "denied") return "danger";
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
  filterBar: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc800_50,
    padding: spacing["3"],
    gap: spacing["3"],
  },
  field: {
    gap: spacing["1"],
  },
  fieldLabel: {
    letterSpacing: 0.6,
  },
  fieldControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    minHeight: 40,
  },
  textFieldInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 13,
    padding: 0,
  },
  dropdown: {
    marginTop: spacing["1"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  dropdownSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800,
  },
  dropdownSearchInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 13,
    padding: 0,
  },
  dropdownItem: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing["1"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  row: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  rowHeader: {
    flexDirection: "row",
    gap: spacing["2"],
    padding: spacing["3"],
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing["1.5"],
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  detail: {
    borderTopWidth: 1,
    borderTopColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["3"],
    gap: spacing["2"],
  },
  detailFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  detailFilterChip: {
    borderRadius: 6,
    backgroundColor: colors.zinc800,
    paddingHorizontal: spacing["2"],
    paddingVertical: spacing["1.5"],
    maxWidth: "100%",
  },
  jsonBlock: {
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  jsonText: {
    fontFamily: "monospace",
    lineHeight: 16,
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
