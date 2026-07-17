import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Ticket, Trash2, X } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCouponsApi,
  type AdminCoupon,
  type BookingCategory,
  type CafeItemCategory,
  type CouponCondition,
  type CouponConditionType,
  type CouponPlatform,
  type CouponScope,
  type CouponType,
  type EligibleUserSummary,
  type Sport,
  type UserGroupType,
} from "../../lib/admin-coupons";
import { formatRupees } from "../../lib/format";
import { AdminApiError } from "../../lib/admin-api";

const SCOPES: CouponScope[] = ["BOTH", "SPORTS", "CAFE"];
const SPORTS: Sport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];
const CAFE_CATEGORIES: CafeItemCategory[] = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
];
// Sub-categories live under specific sports. Today only CRICKET branches
// into BOX_CRICKET / BOWLING_MACHINE. Storing as an *exclude* list keeps
// the default (empty) meaning "applies to every sub-flow".
const SPORT_SUBCATEGORIES: Partial<
  Record<Sport, { value: BookingCategory; label: string }[]>
> = {
  CRICKET: [
    { value: "BOX_CRICKET", label: "Box Cricket" },
    { value: "BOWLING_MACHINE", label: "Bowling Machine" },
  ],
};
const AUTO_GROUPS: { value: UserGroupType; label: string }[] = [
  { value: "FIRST_TIME", label: "First Time" },
  { value: "PREMIUM_PLAYER", label: "Premium (10+ bookings)" },
  { value: "FREQUENT_VISITOR", label: "Frequent (5+ orders)" },
  { value: "BIRTHDAY_MONTH", label: "Birthday Month" },
];
const CONDITION_TYPES: { value: CouponConditionType; label: string }[] = [
  { value: "MIN_AMOUNT", label: "Minimum Amount" },
  { value: "FIRST_PURCHASE", label: "First Purchase" },
  { value: "TIME_WINDOW", label: "Time Window" },
  { value: "FIRST_APP_BOOKING", label: "First app booking only" },
  { value: "BOOKING_DATE", label: "Booking date window" },
];

// Platform restriction presets. Each maps to the stored validPlatforms
// array (empty = all platforms). "App only" = both mobile platforms.
type PlatformPreset = "ALL" | "APP" | "WEB" | "IOS" | "ANDROID";
const PLATFORM_PRESETS: { value: PlatformPreset; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "APP", label: "App only" },
  { value: "WEB", label: "Web only" },
  { value: "IOS", label: "iOS only" },
  { value: "ANDROID", label: "Android only" },
];
function presetToPlatforms(p: PlatformPreset): CouponPlatform[] {
  switch (p) {
    case "APP":
      return ["android", "ios"];
    case "WEB":
      return ["web"];
    case "IOS":
      return ["ios"];
    case "ANDROID":
      return ["android"];
    default:
      return [];
  }
}
// Derive the selected preset from a stored validPlatforms array.
function platformsToPreset(list: CouponPlatform[]): PlatformPreset {
  if (list.length === 0) return "ALL";
  const set = new Set(list);
  if (set.size === 1 && set.has("web")) return "WEB";
  if (set.size === 1 && set.has("ios")) return "IOS";
  if (set.size === 1 && set.has("android")) return "ANDROID";
  // android + ios (no web) → app-only; anything else falls back to app.
  return "APP";
}
// Short tag label shown on a coupon row for its platform restriction.
function platformTag(list: CouponPlatform[]): string | null {
  switch (platformsToPreset(list)) {
    case "ALL":
      return null;
    case "APP":
      return "App only";
    case "WEB":
      return "Web only";
    case "IOS":
      return "iOS only";
    case "ANDROID":
      return "Android only";
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function discountLabel(c: AdminCoupon): string {
  // PERCENTAGE: value = basis points (÷100 → percent). FLAT: value = whole
  // RUPEES (canonical — matches the web admin + the coupon validator).
  // maxDiscount is also whole rupees.
  return c.type === "PERCENTAGE"
    ? `${c.value / 100}% OFF${c.maxDiscount ? ` ≤ ${formatRupees(c.maxDiscount)}` : ""}`
    : `${formatRupees(c.value)} OFF`;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// Safe JSON parse helper for a condition's `conditionValue`.
function readCond(value: string): Record<string, number> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function AdminCouponsScreen() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery({
    queryKey: ["admin", "coupons", showInactive],
    queryFn: () => adminCouponsApi.list(showInactive),
  });
  // Group options for "Customer Targeting" — sourced from the shared
  // user-groups endpoint (same data the web manager passes in).
  const groups = useQuery({
    queryKey: ["admin", "coupon-groups"],
    queryFn: () => adminCouponsApi.listGroups(),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [scope, setScope] = useState<CouponScope>("BOTH");
  const [type, setType] = useState<CouponType>("PERCENTAGE");
  const [value, setValue] = useState("");
  const [maxDisc, setMaxDisc] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [perUser, setPerUser] = useState("1");
  const [from, setFrom] = useState(isoDate(new Date()));
  const [until, setUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return isoDate(d);
  });
  // New parity state
  const [sportFilter, setSportFilter] = useState<Sport[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CafeItemCategory[]>([]);
  const [categoryExclude, setCategoryExclude] = useState<BookingCategory[]>([]);
  const [userGroupFilter, setUserGroupFilter] = useState<UserGroupType[]>([]);
  const [platformPreset, setPlatformPreset] = useState<PlatformPreset>("ALL");
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUserSummary[]>([]);
  const [eligibleGroupIds, setEligibleGroupIds] = useState<string[]>([]);
  const [conditions, setConditions] = useState<CouponCondition[]>([]);
  const [isStackable, setIsStackable] = useState(false);
  const [stackGroup, setStackGroup] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [isSystemCode, setIsSystemCode] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  // User-picker search
  const [userQuery, setUserQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(userQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [userQuery]);

  const userSearch = useQuery({
    queryKey: ["admin", "coupon-user-search", debouncedQuery],
    queryFn: () => adminCouponsApi.searchUsers(debouncedQuery),
    enabled: open && debouncedQuery.length >= 2,
  });

  const showSports = scope === "SPORTS" || scope === "BOTH";
  const showCategories = scope === "CAFE" || scope === "BOTH";

  function resetForm() {
    setCode("");
    setDesc("");
    setScope("BOTH");
    setType("PERCENTAGE");
    setValue("");
    setMaxDisc("");
    setMinAmt("");
    setMaxUses("");
    setPerUser("1");
    setFrom(isoDate(new Date()));
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setUntil(isoDate(d));
    setSportFilter([]);
    setCategoryFilter([]);
    setCategoryExclude([]);
    setUserGroupFilter([]);
    setPlatformPreset("ALL");
    setEligibleUsers([]);
    setEligibleGroupIds([]);
    setConditions([]);
    setIsStackable(false);
    setStackGroup("");
    setIsPublic(true);
    setIsSystemCode(false);
    setAutoApply(false);
    setUserQuery("");
    setDebouncedQuery("");
    setErr(null);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setOpen(true);
  }
  function openEdit(c: AdminCoupon) {
    setEditing(c);
    setCode(c.code);
    setDesc(c.description ?? "");
    setScope(c.scope);
    setType(c.type);
    setValue(String(c.type === "PERCENTAGE" ? c.value / 100 : c.value));
    setMaxDisc(c.maxDiscount != null ? String(c.maxDiscount) : "");
    setMinAmt(c.minAmount != null ? String(c.minAmount) : "");
    setMaxUses(c.maxUses != null ? String(c.maxUses) : "");
    setPerUser(String(c.maxUsesPerUser));
    setFrom(c.validFrom.slice(0, 10));
    setUntil(c.validUntil.slice(0, 10));
    setSportFilter([...c.sportFilter]);
    setCategoryFilter([...c.categoryFilter]);
    setCategoryExclude([...c.categoryExclude]);
    setUserGroupFilter([...c.userGroupFilter]);
    setPlatformPreset(platformsToPreset(c.validPlatforms ?? []));
    setEligibleUsers(c.eligibleUsers.map((u) => ({ ...u })));
    setEligibleGroupIds(c.eligibleGroups.map((g) => g.id));
    setConditions(c.conditions.map((cond) => ({ ...cond })));
    setIsStackable(c.isStackable);
    setStackGroup(c.stackGroup ?? "");
    setIsPublic(c.isPublic);
    setIsSystemCode(c.isSystemCode);
    setAutoApply(c.autoApply);
    setUserQuery("");
    setDebouncedQuery("");
    setErr(null);
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const num = Number(value);
      if (!num || num <= 0) throw new Error("Enter a valid discount value");
      // PERCENTAGE → basis points (×100). FLAT → whole RUPEES (raw — the
      // canonical unit the web admin + coupon validator use; storing paise
      // here would 100x the discount). maxDiscount (% cap) is whole rupees.
      const storedValue =
        type === "PERCENTAGE" ? Math.round(num * 100) : Math.round(num);
      const maxDiscRupees = maxDisc ? Math.round(Number(maxDisc)) : undefined;
      const common = {
        description: desc.trim() || undefined,
        scope,
        type,
        value: storedValue,
        maxDiscount: type === "PERCENTAGE" ? (maxDiscRupees ?? null) : null,
        maxUses: maxUses ? Number(maxUses) : null,
        maxUsesPerUser: perUser ? Number(perUser) : 1,
        minAmount: minAmt ? Number(minAmt) : null,
        sportFilter: showSports ? sportFilter : [],
        categoryFilter: showCategories ? categoryFilter : [],
        categoryExclude: showSports ? categoryExclude : [],
        userGroupFilter,
        validPlatforms: presetToPlatforms(platformPreset),
        eligibleUserIds: eligibleUsers.map((u) => u.id),
        eligibleGroupIds,
        conditions,
        isStackable,
        stackGroup: isStackable ? stackGroup.trim() || null : null,
        isPublic,
        isSystemCode,
        autoApply,
        validFrom: from,
        validUntil: until,
      };
      if (editing) {
        await adminCouponsApi.update(editing.id, common);
      } else {
        if (code.trim().length < 3) throw new Error("Code must be 3+ characters");
        await adminCouponsApi.create({ code: code.trim(), ...common });
      }
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
    onError: (e) =>
      setErr(
        e instanceof AdminApiError || e instanceof Error ? e.message : "Failed",
      ),
  });

  const toggleActive = useMutation({
    mutationFn: (c: AdminCoupon) =>
      adminCouponsApi.update(c.id, { isActive: !c.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminCouponsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "coupons"] }),
  });

  const coupons = list.data?.coupons ?? [];
  const groupOptions = groups.data?.groups ?? [];

  const targetingSummary = useMemo(() => {
    if (eligibleUsers.length === 0 && eligibleGroupIds.length === 0) return null;
    const parts: string[] = [];
    if (eligibleUsers.length) parts.push(`${eligibleUsers.length} customer(s)`);
    if (eligibleGroupIds.length) parts.push(`${eligibleGroupIds.length} group(s)`);
    return `Restricted to ${parts.join(" + ")}`;
  }, [eligibleUsers, eligibleGroupIds]);

  function addCondition() {
    setConditions((prev) => [
      ...prev,
      { conditionType: "MIN_AMOUNT", conditionValue: "{}" },
    ]);
  }
  function removeCondition(i: number) {
    setConditions((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setConditionType(i: number, t: CouponConditionType) {
    setConditions((prev) =>
      prev.map((c, idx) =>
        idx === i ? { conditionType: t, conditionValue: "{}" } : c,
      ),
    );
  }
  // number for hour/amount editors, string for BOOKING_DATE's YYYY-MM-DD.
  function setConditionJson(i: number, json: Record<string, number | string>) {
    setConditions((prev) =>
      prev.map((c, idx) =>
        idx === i ? { ...c, conditionValue: JSON.stringify(json) } : c,
      ),
    );
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
          <Pressable
            onPress={() => setShowInactive((v) => !v)}
            style={styles.inactiveToggle}
          >
            <Text variant="small" color={colors.zinc400}>
              {showInactive ? "Showing all" : "Active only"}
            </Text>
          </Pressable>
          <Button
            label="New coupon"
            onPress={openCreate}
            leadingIcon={<Plus size={16} color={colors.primaryForeground} />}
          />
        </View>

        {list.isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={70} />
            ))}
          </View>
        ) : coupons.length === 0 ? (
          <View style={styles.empty}>
            <Ticket size={34} color={colors.zinc600} />
            <Text
              variant="small"
              color={colors.zinc500}
              style={{ marginTop: spacing["2"] }}
            >
              No coupons yet.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {coupons.map((c) => {
              const tags: string[] = [];
              const platTag = platformTag(c.validPlatforms ?? []);
              if (platTag) tags.push(platTag);
              if (c.isSystemCode) tags.push("System");
              if (!c.isPublic) tags.push("Hidden");
              if (c.autoApply) tags.push("Auto-apply");
              if (c.isStackable) tags.push("Stackable");
              if (c.eligibleUsers.length || c.eligibleGroups.length)
                tags.push("Targeted");
              if (c.conditions.length) tags.push(`${c.conditions.length} cond`);
              return (
                <Card key={c.id} style={styles.couponCard}>
                  <Pressable onPress={() => openEdit(c)} style={{ flex: 1 }}>
                    <View style={styles.codeRow}>
                      <Ticket size={14} color={colors.emerald400} />
                      <Text variant="bodyStrong" color={colors.foreground}>
                        {c.code}
                      </Text>
                      <View style={styles.scopePill}>
                        <Text variant="tiny" color={colors.zinc400}>
                          {c.scope === "BOTH"
                            ? "All"
                            : c.scope === "SPORTS"
                              ? "Bookings"
                              : "Cafe"}
                        </Text>
                      </View>
                    </View>
                    <Text
                      variant="small"
                      color={colors.emerald400}
                      style={{ marginTop: 2 }}
                    >
                      {discountLabel(c)}
                    </Text>
                    <Text
                      variant="tiny"
                      color={colors.zinc500}
                      style={{ marginTop: 1 }}
                    >
                      {c.minAmount ? `Min ${formatRupees(c.minAmount)} · ` : ""}
                      {c.usedCount} used{c.maxUses ? `/${c.maxUses}` : ""} · till{" "}
                      {c.validUntil.slice(0, 10)}
                    </Text>
                    {(c.sportFilter.length > 0 ||
                      c.categoryFilter.length > 0 ||
                      c.userGroupFilter.length > 0) && (
                      <Text
                        variant="tiny"
                        color={colors.zinc600}
                        style={{ marginTop: 1 }}
                      >
                        {[
                          ...c.sportFilter,
                          ...c.categoryFilter,
                          ...c.userGroupFilter,
                        ].join(", ")}
                      </Text>
                    )}
                    {tags.length > 0 && (
                      <View style={styles.tagRow}>
                        {tags.map((t) => (
                          <View key={t} style={styles.tag}>
                            <Text variant="tiny" color={colors.zinc400}>
                              {t}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </Pressable>
                  <View style={styles.actions}>
                    <Switch
                      value={c.isActive}
                      onValueChange={() => toggleActive.mutate(c)}
                      trackColor={{
                        true: colors.emerald500_10,
                        false: colors.zinc700,
                      }}
                      thumbColor={c.isActive ? colors.emerald400 : colors.zinc400}
                    />
                    <Pressable
                      hitSlop={8}
                      onPress={() =>
                        Alert.alert(
                          "Deactivate coupon?",
                          `Disable ${c.code}?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Deactivate",
                              style: "destructive",
                              onPress: () => remove.mutate(c.id),
                            },
                          ],
                        )
                      }
                    >
                      <Trash2 size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

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
                {editing ? "Edit coupon" : "New coupon"}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X size={22} color={colors.zinc400} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              {!editing ? (
                <Input
                  label="Code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="SAVE20"
                  value={code}
                  onChangeText={setCode}
                />
              ) : null}
              <Input
                label="Description (optional)"
                value={desc}
                onChangeText={setDesc}
              />

              <Text variant="tiny" color={colors.zinc500} style={styles.fieldLabel}>
                APPLIES TO
              </Text>
              <View style={styles.chipRow}>
                {SCOPES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setScope(s)}
                    style={[styles.chip, scope === s && styles.chipActive]}
                  >
                    <Text
                      variant="small"
                      weight="600"
                      color={scope === s ? colors.emerald400 : colors.zinc400}
                    >
                      {s === "BOTH" ? "All" : s === "SPORTS" ? "Bookings" : "Cafe"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {!editing ? (
                <View style={styles.chipRow}>
                  {(["PERCENTAGE", "FLAT"] as CouponType[]).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setType(t)}
                      style={[styles.chip, type === t && styles.chipActive]}
                    >
                      <Text
                        variant="small"
                        weight="600"
                        color={type === t ? colors.emerald400 : colors.zinc400}
                      >
                        {t === "PERCENTAGE" ? "Percentage" : "Flat ₹"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input
                    label={type === "PERCENTAGE" ? "Discount %" : "Discount ₹"}
                    keyboardType="numeric"
                    value={value}
                    onChangeText={setValue}
                  />
                </View>
                {type === "PERCENTAGE" ? (
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Max ₹ (cap)"
                      keyboardType="numeric"
                      value={maxDisc}
                      onChangeText={setMaxDisc}
                    />
                  </View>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
              </View>
              <Input
                label="Min order ₹ (optional)"
                keyboardType="numeric"
                value={minAmt}
                onChangeText={setMinAmt}
              />
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Max uses"
                    keyboardType="numeric"
                    placeholder="∞"
                    value={maxUses}
                    onChangeText={setMaxUses}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Per user"
                    keyboardType="numeric"
                    value={perUser}
                    onChangeText={setPerUser}
                  />
                </View>
              </View>

              {/* Sport filter + sub-category exclusions */}
              {showSports ? (
                <View style={{ gap: spacing["2"] }}>
                  <Text
                    variant="tiny"
                    color={colors.zinc500}
                    style={styles.fieldLabel}
                  >
                    SPORT FILTER (EMPTY = ALL)
                  </Text>
                  <View style={styles.wrapRow}>
                    {SPORTS.map((s) => {
                      const on = sportFilter.includes(s);
                      return (
                        <Pressable
                          key={s}
                          onPress={() =>
                            setSportFilter((p) => toggle(p, s))
                          }
                          style={[styles.tagChip, on && styles.tagChipActive]}
                        >
                          <Text
                            variant="tiny"
                            weight="600"
                            color={on ? colors.emerald400 : colors.zinc400}
                          >
                            {s}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {SPORTS.flatMap((s) => {
                    const subs = SPORT_SUBCATEGORIES[s];
                    if (!subs) return [];
                    const inScope =
                      sportFilter.length === 0 || sportFilter.includes(s);
                    if (!inScope) return [];
                    return [
                      <View key={s} style={styles.subBox}>
                        <Text variant="tiny" color={colors.zinc500}>
                          {s} exclusions (checked = NOT applicable)
                        </Text>
                        <View style={styles.wrapRow}>
                          {subs.map((sub) => {
                            const excluded = categoryExclude.includes(sub.value);
                            return (
                              <Pressable
                                key={sub.value}
                                onPress={() =>
                                  setCategoryExclude((p) =>
                                    toggle(p, sub.value),
                                  )
                                }
                                style={[
                                  styles.tagChip,
                                  excluded && styles.tagChipExcluded,
                                ]}
                              >
                                <Text
                                  variant="tiny"
                                  weight="600"
                                  color={
                                    excluded
                                      ? colors.destructive
                                      : colors.zinc400
                                  }
                                >
                                  {excluded ? "✕ " : ""}
                                  {sub.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>,
                    ];
                  })}
                </View>
              ) : null}

              {/* Cafe category filter */}
              {showCategories ? (
                <View style={{ gap: spacing["2"] }}>
                  <Text
                    variant="tiny"
                    color={colors.zinc500}
                    style={styles.fieldLabel}
                  >
                    CATEGORY FILTER (EMPTY = ALL)
                  </Text>
                  <View style={styles.wrapRow}>
                    {CAFE_CATEGORIES.map((cat) => {
                      const on = categoryFilter.includes(cat);
                      return (
                        <Pressable
                          key={cat}
                          onPress={() =>
                            setCategoryFilter((p) => toggle(p, cat))
                          }
                          style={[styles.tagChip, on && styles.tagChipActive]}
                        >
                          <Text
                            variant="tiny"
                            weight="600"
                            color={on ? colors.emerald400 : colors.zinc400}
                          >
                            {cat}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Customer Targeting — admin-curated. Composes via OR with
                  the auto-eligibility groups below. */}
              <View style={styles.targetBox}>
                <Text
                  variant="tiny"
                  weight="700"
                  color={colors.emerald400}
                  style={styles.fieldLabel}
                >
                  CUSTOMER TARGETING (OPTIONAL)
                </Text>

                <Text variant="tiny" color={colors.zinc500}>
                  Specific customers
                </Text>
                {eligibleUsers.length > 0 ? (
                  <View style={styles.wrapRow}>
                    {eligibleUsers.map((u) => (
                      <Pressable
                        key={u.id}
                        onPress={() =>
                          setEligibleUsers((p) =>
                            p.filter((x) => x.id !== u.id),
                          )
                        }
                        style={styles.pickedChip}
                      >
                        <Text variant="tiny" color={colors.emerald400}>
                          {u.name || u.phone || u.email || u.id}
                        </Text>
                        <X size={11} color={colors.emerald400} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Input
                  label=""
                  placeholder="Search name / email / phone"
                  autoCorrect={false}
                  value={userQuery}
                  onChangeText={setUserQuery}
                />
                {debouncedQuery.length >= 2 ? (
                  userSearch.isLoading ? (
                    <Text variant="tiny" color={colors.zinc500}>
                      Searching…
                    </Text>
                  ) : (userSearch.data?.users ?? []).length === 0 ? (
                    <Text variant="tiny" color={colors.zinc600}>
                      No matches
                    </Text>
                  ) : (
                    <View style={styles.searchResults}>
                      {(userSearch.data?.users ?? [])
                        .filter(
                          (u) => !eligibleUsers.some((x) => x.id === u.id),
                        )
                        .map((u) => (
                          <Pressable
                            key={u.id}
                            onPress={() => {
                              setEligibleUsers((p) =>
                                p.some((x) => x.id === u.id) ? p : [...p, u],
                              );
                              setUserQuery("");
                              setDebouncedQuery("");
                            }}
                            style={styles.searchRow}
                          >
                            <Text variant="small" color={colors.foreground}>
                              {u.name || "(no name)"}
                            </Text>
                            <Text variant="tiny" color={colors.zinc500}>
                              {u.phone || u.email || u.id}
                            </Text>
                          </Pressable>
                        ))}
                    </View>
                  )
                ) : null}

                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  style={{ marginTop: spacing["1"] }}
                >
                  User groups
                </Text>
                {groupOptions.length === 0 ? (
                  <Text variant="tiny" color={colors.zinc600}>
                    No groups yet.
                  </Text>
                ) : (
                  <View style={styles.wrapRow}>
                    {groupOptions.map((g) => {
                      const on = eligibleGroupIds.includes(g.id);
                      return (
                        <Pressable
                          key={g.id}
                          onPress={() =>
                            setEligibleGroupIds((p) => toggle(p, g.id))
                          }
                          style={[styles.tagChip, on && styles.tagChipActive]}
                        >
                          <Text
                            variant="tiny"
                            weight="600"
                            color={on ? colors.emerald400 : colors.zinc400}
                          >
                            {g.name} · {g.memberCount}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {targetingSummary ? (
                  <Text variant="tiny" color={colors.emerald400}>
                    {targetingSummary}
                  </Text>
                ) : null}
              </View>

              {/* Auto-eligibility groups (computed by booking history) */}
              <View style={{ gap: spacing["2"] }}>
                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  style={styles.fieldLabel}
                >
                  AUTO-ELIGIBILITY GROUPS
                </Text>
                <View style={styles.wrapRow}>
                  {AUTO_GROUPS.map((g) => {
                    const on = userGroupFilter.includes(g.value);
                    return (
                      <Pressable
                        key={g.value}
                        onPress={() =>
                          setUserGroupFilter((p) => toggle(p, g.value))
                        }
                        style={[styles.tagChip, on && styles.tagChipActive]}
                      >
                        <Text
                          variant="tiny"
                          weight="600"
                          color={on ? colors.emerald400 : colors.zinc400}
                        >
                          {g.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Platform restriction — single-select preset row. */}
              <View style={{ gap: spacing["2"] }}>
                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  style={styles.fieldLabel}
                >
                  VALID ON
                </Text>
                <View style={styles.wrapRow}>
                  {PLATFORM_PRESETS.map((p) => {
                    const on = platformPreset === p.value;
                    return (
                      <Pressable
                        key={p.value}
                        onPress={() => setPlatformPreset(p.value)}
                        style={[styles.tagChip, on && styles.tagChipActive]}
                      >
                        <Text
                          variant="tiny"
                          weight="600"
                          color={on ? colors.emerald400 : colors.zinc400}
                        >
                          {p.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Conditions builder */}
              <View style={{ gap: spacing["2"] }}>
                <View style={styles.condHead}>
                  <Text
                    variant="tiny"
                    color={colors.zinc500}
                    style={styles.fieldLabel}
                  >
                    CONDITIONS
                  </Text>
                  <Pressable onPress={addCondition} hitSlop={8}>
                    <Text variant="tiny" weight="600" color={colors.emerald400}>
                      + Add
                    </Text>
                  </Pressable>
                </View>
                {conditions.length === 0 ? (
                  <Text variant="tiny" color={colors.zinc600}>
                    No conditions set
                  </Text>
                ) : null}
                {conditions.map((cond, i) => {
                  const json = readCond(cond.conditionValue);
                  return (
                    <View key={i} style={styles.condBox}>
                      <View style={styles.condTopRow}>
                        <View style={styles.wrapRow}>
                          {CONDITION_TYPES.map((ct) => {
                            const on = cond.conditionType === ct.value;
                            return (
                              <Pressable
                                key={ct.value}
                                onPress={() => setConditionType(i, ct.value)}
                                style={[
                                  styles.tagChip,
                                  on && styles.tagChipActive,
                                ]}
                              >
                                <Text
                                  variant="tiny"
                                  weight="600"
                                  color={
                                    on ? colors.emerald400 : colors.zinc400
                                  }
                                >
                                  {ct.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Pressable onPress={() => removeCondition(i)} hitSlop={8}>
                          <X size={16} color={colors.zinc500} />
                        </Pressable>
                      </View>
                      {cond.conditionType === "MIN_AMOUNT" ? (
                        <Input
                          label="Min amount ₹"
                          keyboardType="numeric"
                          value={
                            json.minAmount != null ? String(json.minAmount) : ""
                          }
                          onChangeText={(t) =>
                            setConditionJson(i, {
                              minAmount: parseInt(t, 10) || 0,
                            })
                          }
                        />
                      ) : null}
                      {cond.conditionType === "TIME_WINDOW" ? (
                        <View style={styles.twoCol}>
                          <View style={{ flex: 1 }}>
                            <Input
                              label="Start hour (0-23)"
                              keyboardType="numeric"
                              value={
                                json.startHour != null
                                  ? String(json.startHour)
                                  : ""
                              }
                              onChangeText={(t) =>
                                setConditionJson(i, {
                                  ...json,
                                  startHour: parseInt(t, 10) || 0,
                                })
                              }
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Input
                              label="End hour (0-23)"
                              keyboardType="numeric"
                              value={
                                json.endHour != null
                                  ? String(json.endHour)
                                  : ""
                              }
                              onChangeText={(t) =>
                                setConditionJson(i, {
                                  ...json,
                                  endHour: parseInt(t, 10) || 0,
                                })
                              }
                            />
                          </View>
                        </View>
                      ) : null}
                      {cond.conditionType === "FIRST_PURCHASE" ? (
                        <Text variant="tiny" color={colors.zinc500}>
                          User must have no prior coupon usage
                        </Text>
                      ) : null}
                      {cond.conditionType === "FIRST_APP_BOOKING" ? (
                        <Text variant="tiny" color={colors.zinc500}>
                          User must have no prior booking made in the app
                        </Text>
                      ) : null}
                      {cond.conditionType === "BOOKING_DATE" ? (
                        <View style={styles.twoCol}>
                          <View style={{ flex: 1 }}>
                            <Input
                              label="Play date from"
                              placeholder="YYYY-MM-DD"
                              autoCapitalize="none"
                              value={json.from != null ? String(json.from) : ""}
                              onChangeText={(t) =>
                                setConditionJson(i, { ...json, from: t.trim() })
                              }
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Input
                              label="Play date to"
                              placeholder="YYYY-MM-DD"
                              autoCapitalize="none"
                              value={json.to != null ? String(json.to) : ""}
                              onChangeText={(t) =>
                                setConditionJson(i, { ...json, to: t.trim() })
                              }
                            />
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {/* Validity */}
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Valid from"
                    placeholder="YYYY-MM-DD"
                    value={from}
                    onChangeText={setFrom}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Valid until"
                    placeholder="YYYY-MM-DD"
                    value={until}
                    onChangeText={setUntil}
                  />
                </View>
              </View>

              {/* Toggles */}
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="500" color={colors.foreground}>
                    Stackable
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Can combine with other coupons
                  </Text>
                </View>
                <Switch
                  value={isStackable}
                  onValueChange={setIsStackable}
                  trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                  thumbColor={isStackable ? colors.emerald400 : colors.zinc400}
                />
              </View>
              {isStackable ? (
                <Input
                  label="Stack group (optional)"
                  autoCorrect={false}
                  placeholder="e.g. summer-promo"
                  value={stackGroup}
                  onChangeText={setStackGroup}
                />
              ) : null}

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="500" color={colors.foreground}>
                    Public
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Show on the customer coupons page
                  </Text>
                </View>
                <Switch
                  value={isPublic}
                  onValueChange={setIsPublic}
                  trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                  thumbColor={isPublic ? colors.emerald400 : colors.zinc400}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="500" color={colors.foreground}>
                    Auto-apply at checkout
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Applied automatically when eligible — outranks the
                    new-user welcome code
                  </Text>
                </View>
                <Switch
                  value={autoApply}
                  onValueChange={setAutoApply}
                  trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                  thumbColor={autoApply ? colors.emerald400 : colors.zinc400}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="small" weight="500" color={colors.foreground}>
                    System code
                  </Text>
                  <Text variant="tiny" color={colors.zinc500}>
                    Auto-applied / referral codes
                  </Text>
                </View>
                <Switch
                  value={isSystemCode}
                  onValueChange={setIsSystemCode}
                  trackColor={{ true: colors.emerald500_10, false: colors.zinc700 }}
                  thumbColor={isSystemCode ? colors.emerald400 : colors.zinc400}
                />
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
                label={editing ? "Save changes" : "Create coupon"}
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
  inactiveToggle: {
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc700,
  },
  list: { gap: spacing["3"] },
  couponCard: {
    padding: spacing["4"],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  scopePill: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["1"],
    marginTop: spacing["1.5"],
  },
  tag: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc800,
  },
  actions: { alignItems: "center", gap: spacing["2"] },
  empty: { alignItems: "center", paddingVertical: spacing["12"] },
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
  fieldLabel: {
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: spacing["1"],
  },
  chipRow: { flexDirection: "row", gap: spacing["2"] },
  chip: {
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
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing["2"] },
  tagChip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  tagChipActive: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  tagChipExcluded: {
    borderColor: colors.destructive_30,
    backgroundColor: colors.destructive_10,
  },
  subBox: {
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  targetBox: {
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_20,
    backgroundColor: colors.emerald500_05,
  },
  pickedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1"],
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500_10,
  },
  searchResults: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    overflow: "hidden",
  },
  searchRow: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  condHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  condBox: {
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  condTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  twoCol: { flexDirection: "row", gap: spacing["3"] },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    marginTop: spacing["1"],
  },
});
