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
import { Pencil, Plus, Tag, Trash2, Users, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminUserGroupsApi,
  type AdminUserGroup,
} from "../../lib/admin-user-groups";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Mirrors the web /admin/users/groups list: named cohorts used for
 * coupon/push targeting. Group CRUD only (create / rename / delete +
 * member & coupon counts) — per-member editing stays on the web,
 * matching the brief.
 */
export function AdminUserGroupsScreen() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "user-groups"],
    queryFn: () => adminUserGroupsApi.list(),
    refetchOnWindowFocus: false,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserGroup | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setErr(null);
    setFormOpen(true);
  }

  function openEdit(g: AdminUserGroup) {
    setEditing(g);
    setName(g.name);
    setDescription(g.description ?? "");
    setErr(null);
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (trimmed.length === 0) throw new Error("Group name is required");
      const desc = description.trim();
      if (editing) {
        await adminUserGroupsApi.update(editing.id, {
          name: trimmed,
          description: desc || null,
        });
      } else {
        await adminUserGroupsApi.create({
          name: trimmed,
          description: desc || undefined,
        });
      }
    },
    onSuccess: () => {
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "user-groups"] });
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminUserGroupsApi.remove(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin", "user-groups"] }),
    onError: (e) =>
      Alert.alert(
        "Couldn't delete",
        e instanceof AdminApiError ? e.message : "Try again.",
      ),
  });

  const groups = list.data?.groups ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isLoading}
            onRefresh={() => void list.refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">User groups</Text>
            <Text variant="small" color={colors.zinc500}>
              Cohorts for coupon &amp; push targeting
            </Text>
          </View>
          <Button
            label="New group"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeleton}>
                <Skeleton width={140} height={18} />
                <Skeleton width="60%" height={12} />
              </View>
            ))}
          </View>
        ) : list.isError ? (
          <Pressable onPress={() => void list.refetch()} style={styles.errorBlock}>
            <Text variant="body" color={colors.destructive}>
              Couldn't load groups. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {list.error instanceof Error ? list.error.message : "Unknown error"}
            </Text>
          </Pressable>
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Users size={32} color={colors.zinc600} />
            <Text variant="bodyStrong" color={colors.zinc300}>
              No groups yet
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Tap "New group" to create your first cohort.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {groups.map((g) => (
              <Card key={g.id} style={styles.groupCard}>
                <Pressable onPress={() => openEdit(g)} style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Users size={14} color={colors.emerald400} />
                    <Text variant="bodyStrong" color={colors.foreground} numberOfLines={1} style={{ flexShrink: 1 }}>
                      {g.name}
                    </Text>
                  </View>
                  {g.description ? (
                    <Text variant="tiny" color={colors.zinc500} numberOfLines={2} style={{ marginTop: 2 }}>
                      {g.description}
                    </Text>
                  ) : null}
                  <View style={styles.metaRow}>
                    <Text variant="tiny" color={colors.zinc400}>
                      {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                    </Text>
                    {g.couponCount > 0 ? (
                      <>
                        <Text variant="tiny" color={colors.zinc700}>·</Text>
                        <View style={styles.couponPill}>
                          <Tag size={10} color={colors.zinc400} />
                          <Text variant="tiny" color={colors.zinc400}>
                            {g.couponCount} coupon{g.couponCount === 1 ? "" : "s"}
                          </Text>
                        </View>
                      </>
                    ) : null}
                  </View>
                </Pressable>
                <View style={styles.cardActions}>
                  <Pressable hitSlop={8} onPress={() => openEdit(g)}>
                    <Pencil size={16} color={colors.zinc400} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert(
                        "Delete group?",
                        `"${g.name}" will be removed. Coupons that target it keep working with zero matching members.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => remove.mutate(g.id),
                          },
                        ],
                      )
                    }
                  >
                    <Trash2 size={16} color={colors.destructive} />
                  </Pressable>
                </View>
              </Card>
            ))}
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
                {editing ? "Edit group" : "New group"}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Input
                label="Name"
                placeholder="e.g. VIP players"
                value={name}
                onChangeText={setName}
                autoFocus={!editing}
              />
              <Input
                label="Description (optional)"
                placeholder="What is this cohort for?"
                value={description}
                onChangeText={setDescription}
                multiline
              />
              {err ? (
                <Text variant="small" color={colors.destructive} style={{ marginTop: spacing["2"] }}>
                  {err}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={editing ? "Save changes" : "Create group"}
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
    gap: spacing["3"],
  },
  list: { gap: spacing["3"] },
  groupCard: {
    padding: spacing["4"],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    marginTop: spacing["2"],
    flexWrap: "wrap",
  },
  couponPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1"],
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  cardActions: { alignItems: "center", gap: spacing["3"], paddingTop: 2 },
  skeleton: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: spacing["2"],
  },
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
});
