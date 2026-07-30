import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Plus, RotateCcw, ShieldCheck, Trash2, UserCog, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminAdminUsersApi,
  type AdminAccount,
} from "../../lib/admin-admin-users";
import {
  ALL_ADMIN_PERMISSIONS,
  PERMISSION_LABELS,
  SUPERADMIN_ONLY_PERMISSIONS,
  type AdminPermission,
} from "../../lib/admin-permissions";
import { AdminApiError } from "../../lib/admin-api";

type Role = "ADMIN" | "STAFF";

// Permissions an ADMIN may be granted (superadmin-only bits are filtered out
// since the server drops them too).
const ASSIGNABLE_PERMISSIONS = ALL_ADMIN_PERMISSIONS.filter(
  (p) => !SUPERADMIN_ONLY_PERMISSIONS.includes(p),
);

export function AdminAdminUsersScreen() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "admin-users"],
    queryFn: () => adminAdminUsersApi.list(),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("ADMIN");
  const [perms, setPerms] = useState<Set<AdminPermission>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setUsername("");
    setEmail("");
    setPassword("");
    setRole("ADMIN");
    setPerms(new Set());
    setErr(null);
    setFormOpen(true);
  }

  function openEdit(a: AdminAccount) {
    setEditing(a);
    setUsername(a.username);
    setEmail(a.email);
    setPassword("");
    setRole(a.role === "STAFF" ? "STAFF" : "ADMIN");
    setPerms(new Set(a.permissions as AdminPermission[]));
    setErr(null);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const permList = role === "STAFF" ? [] : Array.from(perms);
      if (editing) {
        await adminAdminUsersApi.update(editing.id, {
          email: email.trim(),
          role,
          permissions: permList,
          password: password.trim() ? password : undefined,
        });
      } else {
        await adminAdminUsersApi.create({
          username: username.trim(),
          email: email.trim(),
          password,
          role,
          permissions: permList,
        });
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "admin-users"] });
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminAdminUsersApi.remove(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "admin-users"] }),
    onError: (e) =>
      Alert.alert(
        "Couldn't delete",
        e instanceof AdminApiError || e instanceof Error
          ? e.message
          : "Please try again.",
      ),
  });

  const toggleActive = useMutation({
    mutationFn: (a: AdminAccount) =>
      adminAdminUsersApi.update(a.id, { isActive: !a.isActive }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "admin-users"] }),
    onError: (e) =>
      Alert.alert(
        "Couldn't update",
        e instanceof AdminApiError || e instanceof Error
          ? e.message
          : "Please try again.",
      ),
  });

  function confirmToggleActive(a: AdminAccount) {
    Alert.alert(
      a.isActive ? "Deactivate admin?" : "Reactivate admin?",
      a.isActive
        ? `${a.username} will be signed out and unable to log in until reactivated.`
        : `${a.username} will be able to log in again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: a.isActive ? "Deactivate" : "Reactivate",
          style: a.isActive ? "destructive" : "default",
          onPress: () => toggleActive.mutate(a),
        },
      ],
    );
  }

  const admins = list.data?.admins ?? [];

  function togglePerm(p: AdminPermission) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

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
        <View style={styles.topRow}>
          <Text variant="tiny" color={colors.zinc500}>
            {admins.length} admin {admins.length === 1 ? "account" : "accounts"}
          </Text>
          <Button
            label="New admin"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeleton}>
                <Skeleton width={120} height={18} />
                <Skeleton width="70%" height={12} />
              </View>
            ))}
          </View>
        ) : admins.length === 0 ? (
          <View style={styles.empty}>
            <UserCog size={34} color={colors.zinc600} />
            <Text variant="small" color={colors.zinc500} style={{ marginTop: spacing["2"] }}>
              No admin accounts yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {admins.map((a) => {
              const isSuper = a.role === "SUPERADMIN";
              const editable = !isSuper;
              return (
                <Card key={a.id} style={styles.adminCard}>
                  <Pressable
                    disabled={!editable}
                    onPress={() => openEdit(a)}
                    style={{ flex: 1 }}
                  >
                    <View style={styles.nameRow}>
                      {isSuper ? (
                        <ShieldCheck size={14} color={colors.emerald400} />
                      ) : (
                        <UserCog size={14} color={colors.zinc400} />
                      )}
                      <Text variant="bodyStrong" color={colors.foreground}>
                        {a.username}
                      </Text>
                      <View style={styles.rolePill}>
                        <Text variant="tiny" weight="700" color={colors.emerald400}>
                          {a.role}
                        </Text>
                      </View>
                      {!a.passwordSet ? (
                        <View style={styles.pendingPill}>
                          <Text variant="tiny" weight="700" color={colors.yellow400}>
                            PENDING
                          </Text>
                        </View>
                      ) : null}
                      {!a.isActive ? (
                        <View style={styles.inactivePill}>
                          <Text variant="tiny" weight="700" color={colors.zinc400}>
                            INACTIVE
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text variant="tiny" color={colors.zinc500} style={{ marginTop: 2 }}>
                      {a.email}
                    </Text>
                    {!isSuper ? (
                      <Text variant="tiny" color={colors.zinc600} style={{ marginTop: 1 }}>
                        {a.permissions.length} permission
                        {a.permissions.length === 1 ? "" : "s"}
                      </Text>
                    ) : (
                      <Text variant="tiny" color={colors.zinc600} style={{ marginTop: 1 }}>
                        All permissions
                      </Text>
                    )}
                  </Pressable>
                  {editable ? (
                    <Pressable hitSlop={8} onPress={() => confirmToggleActive(a)}>
                      {a.isActive ? (
                        <Ban size={16} color={colors.yellow400} />
                      ) : (
                        <RotateCcw size={16} color={colors.emerald400} />
                      )}
                    </Pressable>
                  ) : null}
                  {editable && a.isDeletable ? (
                    <Pressable
                      hitSlop={8}
                      onPress={() =>
                        Alert.alert(
                          "Delete admin?",
                          `Permanently remove ${a.username}? This cannot be undone.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => remove.mutate(a.id),
                            },
                          ],
                        )
                      }
                    >
                      <Trash2 size={16} color={colors.destructive} />
                    </Pressable>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Create / edit modal */}
      <Modal
        visible={formOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFormOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text variant="title" weight="700">
                {editing ? `Edit ${editing.username}` : "New admin account"}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              {!editing ? (
                <Input
                  label="Username"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="venue_manager"
                  value={username}
                  onChangeText={setUsername}
                />
              ) : null}

              <Input
                label="Email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="admin@example.com"
                value={email}
                onChangeText={setEmail}
              />

              <Input
                label={editing ? "New password (leave blank to keep)" : "Password"}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="10+ chars, letter, number, symbol"
                value={password}
                onChangeText={setPassword}
              />

              <Text variant="tiny" color={colors.zinc500} style={styles.label}>
                ROLE
              </Text>
              <View style={styles.roleRow}>
                {(["ADMIN", "STAFF"] as Role[]).map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setRole(r)}
                    style={[styles.roleChip, role === r && styles.roleChipActive]}
                  >
                    <Text
                      variant="small"
                      weight="600"
                      color={role === r ? colors.emerald400 : colors.zinc400}
                    >
                      {r === "ADMIN" ? "Admin" : "Staff (no permissions)"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {role === "ADMIN" ? (
                <>
                  <Text variant="tiny" color={colors.zinc500} style={styles.label}>
                    PERMISSIONS
                  </Text>
                  <View style={styles.permList}>
                    {ASSIGNABLE_PERMISSIONS.map((p) => {
                      const on = perms.has(p);
                      return (
                        <Pressable
                          key={p}
                          onPress={() => togglePerm(p)}
                          style={styles.permRow}
                        >
                          <View
                            style={[styles.checkbox, on && styles.checkboxOn]}
                          >
                            {on ? (
                              <Check size={13} color={colors.primaryForeground} />
                            ) : null}
                          </View>
                          <Text
                            variant="small"
                            color={on ? colors.foreground : colors.zinc400}
                          >
                            {PERMISSION_LABELS[p]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text variant="tiny" color={colors.zinc600}>
                  Staff accounts hold no permissions.
                </Text>
              )}

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
                label={editing ? "Save changes" : "Create admin"}
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

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  list: { gap: spacing["3"] },
  adminCard: {
    padding: spacing["4"],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    flexWrap: "wrap",
  },
  rolePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.emerald500_10,
  },
  pendingPill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.yellow500_10,
  },
  inactivePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "90%",
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
  label: { letterSpacing: 1.2, fontWeight: "700", marginTop: spacing["1"] },
  roleRow: { flexDirection: "row", gap: spacing["2"] },
  roleChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  roleChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  permList: { gap: spacing["2"] },
  permRow: { flexDirection: "row", alignItems: "center", gap: spacing["3"] },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald400,
  },
});
