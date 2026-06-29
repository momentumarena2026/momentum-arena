import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Mail,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  User as UserIcon,
  Users,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminUsersApi,
  type AdminUser,
  type EditableUserRole,
} from "../../lib/admin-users";
import { formatDateLong } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Full-parity mirror of the web /admin/users directory: debounced search
 * across name/email/phone, a role filter, infinite-scroll, and CRUD —
 * create / edit / soft-delete / restore — matching actions/admin-users.ts.
 *
 * createUser mirrors web exactly: it creates a bare User row (name +
 * email/phone + role) with NO password and NO invite email. "Email or phone
 * required" is enforced both client-side here and server-side by the action.
 */

const ROLE_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Customers", value: "CUSTOMER" },
  { label: "Admins", value: "ADMIN" },
];

const EDITABLE_ROLES: { label: string; value: EditableUserRole }[] = [
  { label: "Customer", value: "CUSTOMER" },
  { label: "Admin", value: "ADMIN" },
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
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useInfiniteQuery({
    queryKey: ["admin", "users", search, role, showDeleted],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      adminUsersApi.list({
        search: search || undefined,
        role: role || undefined,
        page: pageParam,
        showDeleted,
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

  // ---- Form state (create / edit) ----
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [formRole, setFormRole] = useState<EditableUserRole>("CUSTOMER");
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setEmail("");
    setPhone("");
    setFormRole("CUSTOMER");
    setErr(null);
    setOpen(true);
  }
  function openEdit(u: AdminUser) {
    setEditing(u);
    setName(u.name ?? "");
    setEmail(u.email ?? "");
    setPhone(u.phone ?? "");
    setFormRole(u.role === "ADMIN" ? "ADMIN" : "CUSTOMER");
    setErr(null);
    setOpen(true);
  }

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["admin", "users"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const trimmedPhone = phone.trim();
      if (!trimmedName) throw new Error("Name is required");
      // Mirror web validation: at least one contact method.
      if (!trimmedEmail && !trimmedPhone) {
        throw new Error("Email or phone is required");
      }
      if (editing) {
        await adminUsersApi.update(editing.id, {
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          role: formRole,
        });
      } else {
        await adminUsersApi.create({
          name: trimmedName,
          email: trimmedEmail || undefined,
          phone: trimmedPhone || undefined,
          role: formRole,
        });
      }
    },
    onSuccess: () => {
      setOpen(false);
      invalidate();
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminUsersApi.remove(id),
    onSuccess: invalidate,
    onError: (e) =>
      Alert.alert(
        "Couldn't delete",
        e instanceof AdminApiError || e instanceof Error
          ? e.message
          : "Failed to delete user",
      ),
  });

  const restore = useMutation({
    mutationFn: (id: string) => adminUsersApi.restore(id),
    onSuccess: invalidate,
    onError: (e) =>
      Alert.alert(
        "Couldn't restore",
        e instanceof AdminApiError || e instanceof Error
          ? e.message
          : "Failed to restore user",
      ),
  });

  function confirmDelete(u: AdminUser) {
    Alert.alert(
      "Delete user?",
      `This soft-deletes ${u.name?.trim() || "this user"}. They can be restored later.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => remove.mutate(u.id),
        },
      ],
    );
  }

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
          if (nearBottom && query.hasNextPage && !query.isFetchingNextPage) {
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
          <Button
            label="Add"
            size="sm"
            onPress={openCreate}
            leadingIcon={<Plus size={15} color={colors.primaryForeground} />}
          />
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

        {/* Role filter chips + show-deleted toggle */}
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
          <Pressable
            onPress={() => setShowDeleted((v) => !v)}
            style={[styles.chip, showDeleted && styles.chipActive]}
          >
            <Text
              variant="small"
              weight="600"
              color={showDeleted ? colors.emerald400 : colors.zinc400}
            >
              Deleted
            </Text>
          </Pressable>
        </View>

        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load users. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
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
              <UserRow
                key={u.id}
                user={u}
                busy={
                  (remove.isPending && remove.variables === u.id) ||
                  (restore.isPending && restore.variables === u.id)
                }
                onEdit={() => openEdit(u)}
                onDelete={() => confirmDelete(u)}
                onRestore={() => restore.mutate(u.id)}
              />
            ))}
            {query.isFetchingNextPage ? (
              <View style={styles.footerLoading}>
                <Skeleton width="60%" height={12} />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Create / Edit modal */}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? "Edit user" : "New user"}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <Input
                label="Name"
                placeholder="Full name"
                value={name}
                onChangeText={setName}
              />
              <Input
                label="Email"
                placeholder="name@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <Input
                label="Phone"
                placeholder="+91XXXXXXXXXX"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
              <Text variant="tiny" color={colors.zinc600}>
                Provide an email or a phone number (at least one).
              </Text>

              <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                ROLE
              </Text>
              <View style={styles.chipRow}>
                {EDITABLE_ROLES.map((r) => {
                  const on = formRole === r.value;
                  return (
                    <Pressable
                      key={r.value}
                      onPress={() => setFormRole(r.value)}
                      style={[styles.roleChip, on && styles.chipActive]}
                    >
                      <Text
                        variant="small"
                        weight="600"
                        color={on ? colors.emerald400 : colors.zinc400}
                      >
                        {r.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {err ? (
                <Text
                  variant="small"
                  color={colors.destructive}
                  style={{ marginTop: spacing["2"] }}
                >
                  {err}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={editing ? "Save changes" : "Create user"}
                onPress={() => save.mutate()}
                loading={save.isPending}
                fullWidth
                size="lg"
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function UserRow({
  user,
  busy,
  onEdit,
  onDelete,
  onRestore,
}: {
  user: AdminUser;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  const isDeleted = !!user.deletedAt;
  return (
    <View style={[styles.row, isDeleted && styles.rowDeleted]}>
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
          {isDeleted ? (
            <View style={styles.deletedPill}>
              <Text variant="tiny" weight="700" color={colors.destructive}>
                Deleted
              </Text>
            </View>
          ) : null}
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
      <View style={styles.rowActions}>
        {isDeleted ? (
          <Pressable
            hitSlop={8}
            disabled={busy}
            onPress={onRestore}
            style={styles.actionBtn}
          >
            <RotateCcw size={16} color={colors.emerald400} />
          </Pressable>
        ) : (
          <>
            <Pressable
              hitSlop={8}
              onPress={onEdit}
              style={styles.actionBtn}
            >
              <Pencil size={15} color={colors.zinc400} />
            </Pressable>
            <Pressable
              hitSlop={8}
              disabled={busy}
              onPress={onDelete}
              style={styles.actionBtn}
            >
              <Trash2 size={15} color={colors.destructive} />
            </Pressable>
          </>
        )}
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
    alignItems: "center",
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  roleChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
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
  rowDeleted: { opacity: 0.65 },
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
  deletedPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.destructive_10,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing["1.5"] },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing["1"] },
  actionBtn: {
    padding: spacing["2"],
    borderRadius: radius.md,
  },
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
  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "92%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["5"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalBody: { padding: spacing["5"], gap: spacing["3"] },
  modalFooter: {
    padding: spacing["5"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  fieldLabel: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
});
