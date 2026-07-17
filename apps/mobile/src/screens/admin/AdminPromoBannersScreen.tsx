import { useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Ticket, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, spacing } from "../../theme";
import {
  adminPromoBannersApi,
  PROMO_SCREEN_OPTIONS,
  type AdminPromoBanner,
  type PromoBannerInput,
} from "../../lib/admin-promo-banners";
import { AdminApiError } from "../../lib/admin-api";

/**
 * Web & App Config → Promotion Banners (mobile mirror of the web
 * manager). Full CRUD; image FILE uploads happen on the web admin
 * (auto-optimised there) — here the image URL field accepts a paste.
 * Schedule inputs take "YYYY-MM-DD HH:mm" (device-local time).
 */

const SCREEN_LABEL = new Map(PROMO_SCREEN_OPTIONS.map((s) => [s.value, s.label]));

function toLocalText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalText(v: string): string | null | undefined {
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function AdminPromoBannersScreen() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "promo-banners"],
    queryFn: () => adminPromoBannersApi.data(),
  });

  const [form, setForm] = useState<{
    editing: AdminPromoBanner | null;
    title: string;
    imageUrl: string;
    linkUrl: string;
    screens: string[];
    couponId: string;
    startsAt: string;
    endsAt: string;
    sortOrder: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["admin", "promo-banners"] });

  function openCreate() {
    setForm({
      editing: null,
      title: "",
      imageUrl: "",
      linkUrl: "",
      screens: [],
      couponId: "",
      startsAt: "",
      endsAt: "",
      sortOrder: "0",
    });
    setErr(null);
  }

  function openEdit(b: AdminPromoBanner) {
    setForm({
      editing: b,
      title: b.title,
      imageUrl: b.imageUrl,
      linkUrl: b.linkUrl ?? "",
      screens: [...b.screens],
      couponId: b.couponId ?? "",
      startsAt: toLocalText(b.startsAt),
      endsAt: toLocalText(b.endsAt),
      sortOrder: String(b.sortOrder),
    });
    setErr(null);
  }

  async function save() {
    if (!form) return;
    const startsAt = parseLocalText(form.startsAt);
    const endsAt = parseLocalText(form.endsAt);
    if (startsAt === undefined || endsAt === undefined) {
      setErr("Dates must be YYYY-MM-DD HH:mm (or blank).");
      return;
    }
    const input: PromoBannerInput = {
      title: form.title,
      imageUrl: form.imageUrl.trim(),
      // A pasted URL has no separate app variant; the customer API
      // falls back to imageUrl automatically.
      appImageUrl: form.editing?.appImageUrl ?? null,
      aspectRatio: form.editing?.aspectRatio ?? 3,
      linkUrl: form.linkUrl.trim() || null,
      screens: form.screens,
      couponId: form.couponId || null,
      startsAt,
      endsAt,
      isActive: form.editing?.isActive ?? true,
      sortOrder: parseInt(form.sortOrder, 10) || 0,
    };
    setBusy(true);
    setErr(null);
    try {
      const res = form.editing
        ? await adminPromoBannersApi.update(form.editing.id, input)
        : await adminPromoBannersApi.create(input);
      if (!res.ok) {
        setErr(res.error ?? "Couldn't save.");
      } else {
        setForm(null);
        refresh();
      }
    } catch (e) {
      setErr(e instanceof AdminApiError || e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const banners = data?.banners ?? [];
  const coupons = data?.coupons ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.emerald400}
          />
        }
      >
        <Text variant="tiny" color={colors.zinc500} style={styles.lede}>
          Image banners on chosen customer screens — web and app. A banner
          linked to a coupon retires with it automatically. Upload new
          images from the web admin (auto-optimised there).
        </Text>

        <Button
          label="New banner"
          leadingIcon={<Plus size={16} color="#022c22" />}
          onPress={openCreate}
        />

        {isLoading ? (
          <View style={{ gap: spacing["3"] }}>
            <Skeleton height={140} />
            <Skeleton height={140} />
          </View>
        ) : banners.length === 0 ? (
          <Text variant="small" color={colors.zinc500}>
            No banners yet.
          </Text>
        ) : (
          banners.map((b) => (
            <View key={b.id} style={styles.card}>
              <Image
                source={{ uri: b.imageUrl }}
                style={[styles.preview, { aspectRatio: b.aspectRatio }]}
                resizeMode="cover"
              />
              <View style={styles.cardBody}>
                <View style={styles.cardHead}>
                  <Text variant="bodyStrong" color={colors.foreground} style={{ flex: 1 }}>
                    {b.title}
                  </Text>
                  <Switch
                    value={b.isActive}
                    onValueChange={async (v) => {
                      await adminPromoBannersApi.toggle(b.id, v).catch(() => {});
                      refresh();
                    }}
                    trackColor={{ true: colors.emerald500, false: colors.zinc700 }}
                  />
                </View>
                <View style={styles.tagsRow}>
                  {b.screens.map((s) => (
                    <View key={s} style={styles.tag}>
                      <Text style={styles.tagText}>{SCREEN_LABEL.get(s) ?? s}</Text>
                    </View>
                  ))}
                </View>
                {b.couponCode ? (
                  <View style={styles.metaRow}>
                    <Ticket size={12} color={colors.zinc500} />
                    <Text variant="tiny" color={b.couponLive ? colors.zinc400 : "#fbbf24"}>
                      {b.couponCode}
                      {b.couponLive ? "" : " (expired — banner hidden)"}
                    </Text>
                  </View>
                ) : null}
                {b.startsAt || b.endsAt ? (
                  <View style={styles.metaRow}>
                    <CalendarClock size={12} color={colors.zinc500} />
                    <Text variant="tiny" color={colors.zinc400}>
                      {b.startsAt ? toLocalText(b.startsAt) : "now"} →{" "}
                      {b.endsAt ? toLocalText(b.endsAt) : "open-ended"}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.actions}>
                  <Button
                    label="Edit"
                    variant="secondary"
                    size="sm"
                    onPress={() => openEdit(b)}
                  />
                  <Button
                    label="Delete"
                    variant="destructive"
                    size="sm"
                    leadingIcon={<Trash2 size={13} color="#fff" />}
                    onPress={() =>
                      Alert.alert("Delete banner?", b.title, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: async () => {
                            await adminPromoBannersApi.remove(b.id).catch(() => {});
                            refresh();
                          },
                        },
                      ])
                    }
                  />
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* ── Create / edit sheet ── */}
      {form && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setForm(null)}>
          <View style={styles.overlay}>
            <Pressable style={styles.backdrop} onPress={() => setForm(null)} />
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text variant="bodyStrong" color={colors.foreground}>
                  {form.editing ? "Edit banner" : "New banner"}
                </Text>
                <Pressable onPress={() => setForm(null)} hitSlop={8}>
                  <X size={20} color={colors.zinc400} />
                </Pressable>
              </View>
              <ScrollView
                contentContainerStyle={styles.sheetBody}
                keyboardShouldPersistTaps="handled"
              >
                <Input
                  label="Title (also the alt text)"
                  value={form.title}
                  onChangeText={(t) => setForm({ ...form, title: t })}
                />
                <Input
                  label="Image URL (upload new files from the web admin)"
                  autoCapitalize="none"
                  value={form.imageUrl}
                  onChangeText={(t) => setForm({ ...form, imageUrl: t })}
                />
                <Input
                  label="Navigation URL (e.g. /book/football)"
                  autoCapitalize="none"
                  value={form.linkUrl}
                  onChangeText={(t) => setForm({ ...form, linkUrl: t })}
                />

                <Text variant="tiny" weight="600" color={colors.zinc400}>
                  Show on screens
                </Text>
                <View style={styles.chipsWrap}>
                  {PROMO_SCREEN_OPTIONS.map((s) => {
                    const on = form.screens.includes(s.value);
                    return (
                      <Pressable
                        key={s.value}
                        onPress={() =>
                          setForm({
                            ...form,
                            screens: on
                              ? form.screens.filter((v) => v !== s.value)
                              : [...form.screens, s.value],
                          })
                        }
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {s.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text variant="tiny" weight="600" color={colors.zinc400}>
                  Linked coupon (banner lives while the coupon is valid)
                </Text>
                <View style={styles.chipsWrap}>
                  <Pressable
                    onPress={() => setForm({ ...form, couponId: "" })}
                    style={[styles.chip, !form.couponId && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, !form.couponId && styles.chipTextOn]}>
                      None
                    </Text>
                  </Pressable>
                  {coupons.map((c) => {
                    const on = form.couponId === c.id;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setForm({ ...form, couponId: c.id })}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {c.code}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Input
                  label="Live from (YYYY-MM-DD HH:mm, blank = now)"
                  autoCapitalize="none"
                  value={form.startsAt}
                  onChangeText={(t) => setForm({ ...form, startsAt: t })}
                />
                <Input
                  label="Live until (blank = coupon expiry / open-ended)"
                  autoCapitalize="none"
                  value={form.endsAt}
                  onChangeText={(t) => setForm({ ...form, endsAt: t })}
                />
                <Input
                  label="Sort order"
                  keyboardType="number-pad"
                  value={form.sortOrder}
                  onChangeText={(t) => setForm({ ...form, sortOrder: t })}
                />

                {err ? (
                  <Text variant="tiny" color="#fbbf24">
                    {err}
                  </Text>
                ) : null}
                <Button
                  label={form.editing ? "Save changes" : "Create banner"}
                  loading={busy}
                  onPress={() => void save()}
                  fullWidth
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  lede: {
    lineHeight: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  preview: {
    width: "100%",
    height: undefined,
  },
  cardBody: {
    padding: spacing["3"],
    gap: spacing["2"],
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    borderRadius: 999,
    backgroundColor: colors.zinc800,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    fontSize: 10,
    color: colors.zinc300,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actions: {
    flexDirection: "row",
    gap: spacing["2"],
    marginTop: spacing["1"],
  },

  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colors.zinc900,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing["4"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  sheetBody: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
    paddingHorizontal: spacing["3"],
    paddingVertical: 7,
  },
  chipOn: {
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.12)",
  },
  chipText: {
    fontSize: 12,
    color: colors.zinc400,
  },
  chipTextOn: {
    color: "#6ee7b7",
    fontWeight: "600",
  },
});
