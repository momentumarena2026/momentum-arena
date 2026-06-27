import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Mail, Phone, Search, Shield, User as UserIcon, Users } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import { adminUsersApi, type AdminUser } from "../../lib/admin-users";
import { formatDateLong } from "../../lib/format";

/**
 * Read-only mirror of the web /admin/users directory: debounced search
 * across name/email/phone, a role filter, and an infinite-scroll list.
 * Mutations (create/edit/delete) intentionally omitted — the web page
 * is mostly a directory and the mobile workflow is "look someone up".
 */

const ROLE_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Customers", value: "CUSTOMER" },
  { label: "Admins", value: "ADMIN" },
];

function roleLabel(role: string): string {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "SUPERADMIN":
      return "Superadmin";
    default:
      return "Customer";
  }
}

export function AdminUsersScreen() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useInfiniteQuery({
    queryKey: ["admin", "users", search, role],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      adminUsersApi.list({
        search: search || undefined,
        role: role || undefined,
        page: pageParam,
      }),
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    refetchOnWindowFocus: false,
  });

  const users = useMemo(
    () => query.data?.pages.flatMap((p) => p.users) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  const refreshing = query.isRefetching && !query.isLoading;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void query.refetch()}
            tintColor={colors.emerald400}
          />
        }
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const nearBottom =
            layoutMeasurement.height + contentOffset.y >=
            contentSize.height - 400;
          if (
            nearBottom &&
            query.hasNextPage &&
            !query.isFetchingNextPage
          ) {
            void query.fetchNextPage();
          }
        }}
        scrollEventThrottle={200}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Users size={20} color={colors.emerald400} />
          </View>
          <View style={styles.heroBody}>
            <Text variant="bodyStrong">Users</Text>
            <Text variant="small" color={colors.zinc500}>
              {query.isLoading ? "…" : `${total} total`}
            </Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={14} color={colors.zinc500} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search name, email, phone"
            placeholderTextColor={colors.zinc600}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>

        {/* Role filter chips */}
        <View style={styles.chipRow}>
          {ROLE_FILTERS.map((f) => {
            const on = role === f.value;
            return (
              <Pressable
                key={f.value || "all"}
                onPress={() => setRole(f.value)}
                style={[styles.chip, on && styles.chipActive]}
              >
                <Text
                  variant="small"
                  weight="600"
                  color={on ? colors.emerald400 : colors.zinc400}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <Pressable onPress={() => void query.refetch()} style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn't load users. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error ? query.error.message : "Unknown error"}
            </Text>
          </Pressable>
        ) : users.length === 0 ? (
          <View style={styles.empty}>
            <UserIcon size={28} color={colors.zinc500} />
            <Text variant="bodyStrong" color={colors.zinc300}>
              No users found
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Try a different search or filter.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing["2"] }}>
            {users.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
            {query.isFetchingNextPage ? (
              <View style={styles.footerLoading}>
                <Skeleton width="60%" height={12} />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, isAdmin && styles.avatarAdmin]}>
        {isAdmin ? (
          <Shield size={16} color={colors.emerald400} />
        ) : (
          <UserIcon size={16} color={colors.zinc400} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.nameRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {user.name?.trim() || "Unnamed"}
          </Text>
          <View style={[styles.rolePill, isAdmin && styles.rolePillAdmin]}>
            <Text
              variant="tiny"
              weight="700"
              color={isAdmin ? colors.emerald400 : colors.zinc400}
            >
              {roleLabel(user.role)}
            </Text>
          </View>
        </View>
        {user.phone ? (
          <View style={styles.metaRow}>
            <Phone size={11} color={colors.zinc600} />
            <Text variant="tiny" color={colors.zinc400} numberOfLines={1}>
              {user.phone}
            </Text>
          </View>
        ) : null}
        {user.email ? (
          <View style={styles.metaRow}>
            <Mail size={11} color={colors.zinc600} />
            <Text variant="tiny" color={colors.zinc400} numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        ) : null}
        <Text variant="tiny" color={colors.zinc600}>
          Joined {formatDateLong(user.createdAt)} · {user.bookingCount} booking
          {user.bookingCount === 1 ? "" : "s"}
        </Text>
      </View>
    </View>
  );
}

function ListSkeleton() {
  return (
    <View style={{ gap: spacing["2"] }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={36} height={36} rounded="lg" />
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="45%" height={11} />
            <Skeleton width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  hero: {
    flexDirection: "row",
    gap: spacing["3"],
    padding: spacing["4"],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald400_50,
    backgroundColor: colors.emerald500_10,
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.emerald400_50,
    backgroundColor: colors.emerald500_10,
  },
  heroBody: { flex: 1, gap: spacing["1"] },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    backgroundColor: colors.zinc900,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    fontSize: 14,
  },
  chipRow: { flexDirection: "row", gap: spacing["2"] },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  chipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc800_50,
  },
  avatarAdmin: {
    borderColor: colors.emerald400_50,
    backgroundColor: colors.emerald500_10,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  rolePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  rolePillAdmin: { backgroundColor: colors.emerald500_10 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing["1.5"] },
  footerLoading: { paddingVertical: spacing["3"], alignItems: "center" },
  empty: {
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["8"],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
    gap: spacing["1"],
  },
});
