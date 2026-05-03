import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Lock,
  Save,
  Search,
  UserPlus,
  XCircle,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminBookingsApi,
  AdminApiError,
  type AdminCourt,
  type AvailableSlot,
} from "../../lib/admin-bookings";
import {
  formatHourRangeCompact,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import { getTodayIST } from "../../lib/ist-date";
import type { AdminBookingsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<
  AdminBookingsStackParamList,
  "AdminCreateBooking"
>;
type Rt = RouteProp<AdminBookingsStackParamList, "AdminCreateBooking">;

type Sport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";
type Method = "CASH" | "UPI_QR" | "RAZORPAY" | "FREE";
type AdvanceMethod = "CASH" | "UPI_QR" | "RAZORPAY";

const SPORT_EMOJI: Record<Sport, string> = {
  CRICKET: "🏏",
  FOOTBALL: "⚽",
  PICKLEBALL: "🏓",
};

const METHOD_LABEL: Record<Method, string> = {
  CASH: "Cash",
  UPI_QR: "UPI QR",
  RAZORPAY: "Razorpay",
  FREE: "Free",
};
const METHODS: Method[] = ["CASH", "UPI_QR", "RAZORPAY", "FREE"];

const ADVANCE_METHODS: AdvanceMethod[] = ["CASH", "UPI_QR", "RAZORPAY"];

interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Mobile mirror of the web /admin/bookings/create form. Single
 * scrollable screen rather than a multi-step wizard — fewer taps,
 * easier to spot mistakes, matches AdminEditBookingScreen's layout.
 *
 * Flow top to bottom:
 *   1. Customer (search + select existing OR create new from
 *      name+phone — server is idempotent on phone).
 *   2. Sport + Court chips, filtered courts by sport.
 *   3. Date stepper (today / tomorrow / typed).
 *   4. Slot grid for the chosen court+date (uses availableSlots
 *      with no excludeBookingId — true new booking).
 *   5. Total amount (always-visible input, defaults to slot-sum).
 *   6. Payment method + partial-advance toggle. Advance method
 *      includes Razorpay since admins routinely receive Razorpay
 *      partials they need to log retroactively.
 *   7. Razorpay payment ID (when method or advance method is
 *      Razorpay).
 *   8. Optional note. Submit.
 */
export function AdminCreateBookingScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  // ---- Customer state ----
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // New-customer form state — used only when search returns nothing.
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    // 250ms debounce so the search query fires once per pause, not on
    // every keystroke. Same UX as the web form.
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const searchQuery = useQuery({
    queryKey: ["admin-customer-search", debouncedSearch],
    queryFn: () => adminBookingsApi.searchCustomers(debouncedSearch),
    enabled: debouncedSearch.length >= 2 && !customer,
  });

  // ---- Booking state ----
  // Optional prefill from the calendar "+ Add" tile (or any other
  // future entry point that wants to drop the staffer on a specific
  // (date, hour, sport) combo). Falls through to today / null /
  // empty when not provided — same defaults as before.
  const route = useRoute<Rt>();
  const prefill = route.params ?? {};
  const today = getTodayIST();
  const [sport, setSport] = useState<Sport | null>(prefill.prefillSport ?? null);
  const [courtConfigId, setCourtConfigId] = useState<string | null>(null);
  const [date, setDate] = useState(prefill.prefillDate ?? today);
  const [hours, setHours] = useState<number[]>(
    prefill.prefillHour !== undefined ? [prefill.prefillHour] : [],
  );

  // ---- Payment state ----
  const [method, setMethod] = useState<Method>("CASH");
  const [customAmountStr, setCustomAmountStr] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [advanceStr, setAdvanceStr] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<AdvanceMethod>("CASH");
  const [razorpayId, setRazorpayId] = useState("");
  const [note, setNote] = useState("");

  // ---- Data queries ----
  const courtsQuery = useQuery({
    queryKey: ["admin-courts"],
    queryFn: () => adminBookingsApi.courts(),
  });

  const slotsQuery = useQuery({
    queryKey: ["admin-create-slots", courtConfigId, date],
    queryFn: () =>
      adminBookingsApi.availableSlotsForCreate(courtConfigId!, date),
    enabled: !!courtConfigId && !!date,
  });

  const slotPrices = slotsQuery.data?.slots ?? [];
  const slotSum = useMemo(
    () =>
      hours.reduce((sum, h) => {
        const slot = slotPrices.find((s) => s.hour === h);
        return sum + (slot?.price ?? 0);
      }, 0),
    [hours, slotPrices],
  );

  // Effective total: typed value wins when valid, else slot-sum.
  // Locked at 0 for FREE.
  const parsedCustom = parseInt(customAmountStr, 10);
  const customAmountValid =
    customAmountStr.trim().length > 0 &&
    Number.isFinite(parsedCustom) &&
    parsedCustom >= 0 &&
    (method !== "FREE" ? parsedCustom > 0 : parsedCustom === 0);
  const customAmountOverride = customAmountValid && parsedCustom !== slotSum;
  const effectiveTotal =
    method === "FREE" ? 0 : customAmountValid ? parsedCustom : slotSum;

  const parsedAdvance = parseInt(advanceStr, 10);
  const advanceValid =
    !isPartial ||
    (Number.isFinite(parsedAdvance) &&
      parsedAdvance >= 0 &&
      parsedAdvance < effectiveTotal);
  const remaining =
    isPartial && advanceValid ? effectiveTotal - parsedAdvance : 0;

  // ---- Derived UI gating ----
  const filteredCourts: AdminCourt[] = useMemo(
    () => (courtsQuery.data?.courts ?? []).filter((c) => c.sport === sport),
    [courtsQuery.data, sport],
  );

  const courtConfig = useMemo(
    () =>
      (courtsQuery.data?.courts ?? []).find((c) => c.id === courtConfigId) ??
      null,
    [courtsQuery.data, courtConfigId],
  );

  // ---- Mutations ----
  const createCustomer = useMutation({
    mutationFn: (vars: { name: string; phone: string }) =>
      adminBookingsApi.createCustomer(vars),
    onSuccess: (res, vars) => {
      // Server returns isNew=false on phone match — we use whichever
      // user the server resolved to.
      setCustomer({
        id: res.userId,
        name: vars.name,
        phone: vars.phone,
        email: null,
      });
      setNewName("");
      setNewPhone("");
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't add customer",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const createBooking = useMutation({
    mutationFn: () => {
      if (!customer || !courtConfigId) {
        throw new Error("Missing required field");
      }
      return adminBookingsApi.create({
        courtConfigId,
        date,
        hours,
        userId: customer.id,
        paymentMethod: method,
        razorpayPaymentId:
          method === "RAZORPAY" || (isPartial && advanceMethod === "RAZORPAY")
            ? razorpayId.trim() || undefined
            : undefined,
        // Only send when the admin actually changed the figure — null
        // here lets the server default to the slot-sum.
        customTotalAmount: customAmountOverride ? parsedCustom : undefined,
        advanceAmount: isPartial ? parsedAdvance : undefined,
        note: note.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["admin-bookings"] });
      Alert.alert("Booking created", "Customer + admin both notified.");
      // Pop back to the list and let the admin tap into the new
      // booking's detail if they want to verify — same UX as the
      // web form which redirects to /admin/bookings.
      navigation.navigate("AdminBookingDetail", { bookingId: res.bookingId });
    },
    onError: (err) =>
      Alert.alert(
        "Couldn't create",
        err instanceof AdminApiError ? err.message : "Try again.",
      ),
  });

  const canSubmit =
    !!customer &&
    !!courtConfigId &&
    hours.length > 0 &&
    (method === "FREE" || effectiveTotal > 0) &&
    advanceValid &&
    (method !== "RAZORPAY" || razorpayId.trim().length > 0) &&
    !createBooking.isPending;

  // ---- Handlers ----
  function toggleHour(slot: AvailableSlot) {
    if (slot.isBooked || slot.isBlocked) return;
    setHours((curr) =>
      curr.includes(slot.hour)
        ? curr.filter((h) => h !== slot.hour)
        : [...curr, slot.hour].sort((a, b) => a - b),
    );
    // Clear the typed-amount override when slot selection changes so
    // the slot-sum snaps back to the new total. Admin can re-type.
    setCustomAmountStr("");
  }

  function shiftDay(offset: number) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    setDate(d.toISOString().split("T")[0]);
    setHours([]);
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="title">New Booking</Text>
        <Text variant="small" color={colors.zinc500}>
          Same flow as the web admin — pick a customer, court, date,
          slots, and how the customer paid.
        </Text>

        {/* ---------- 1. Customer ---------- */}
        <Section title="CUSTOMER">
          {customer ? (
            <View style={styles.customerCard}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{customer.name || "—"}</Text>
                <Text variant="tiny" color={colors.zinc500}>
                  {customer.phone || "(no phone)"}
                </Text>
              </View>
              <Pressable
                onPress={() => setCustomer(null)}
                hitSlop={8}
                style={styles.changeBtn}
              >
                <Text variant="tiny" color={colors.zinc300} weight="600">
                  Change
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: spacing["2"] }}>
              <View style={styles.searchRow}>
                <Search size={14} color={colors.zinc500} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name, phone, email"
                  placeholderTextColor={colors.zinc600}
                  autoCapitalize="none"
                  style={styles.searchInput}
                />
              </View>
              {debouncedSearch.length >= 2 && searchQuery.isLoading ? (
                <Skeleton width="100%" height={44} rounded="md" />
              ) : null}
              {searchQuery.data?.customers?.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    setCustomer({
                      id: c.id,
                      name: c.name,
                      phone: c.phone,
                      email: c.email,
                    })
                  }
                  style={({ pressed }) => [
                    styles.searchHit,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="small" weight="600">
                      {c.name || "—"}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {c.phone || "no phone"}
                      {c.email ? ` · ${c.email}` : ""}
                    </Text>
                  </View>
                  <Check size={14} color={colors.emerald400} />
                </Pressable>
              ))}
              {/* New customer fallback — visible always so the admin
                  can skip search entirely if they already know the
                  customer is new (common for walk-ins). */}
              <View style={styles.newCustomerCard}>
                <View style={styles.newCustomerHead}>
                  <UserPlus size={14} color={colors.zinc400} />
                  <Text variant="tiny" color={colors.zinc500} weight="600">
                    OR ADD NEW CUSTOMER
                  </Text>
                </View>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Name"
                  placeholderTextColor={colors.zinc600}
                  style={styles.input}
                />
                <TextInput
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="10-digit phone"
                  keyboardType="phone-pad"
                  placeholderTextColor={colors.zinc600}
                  style={styles.input}
                  maxLength={10}
                />
                <Pressable
                  onPress={() => {
                    if (
                      newName.trim().length === 0 ||
                      newPhone.trim().length !== 10
                    ) {
                      Alert.alert(
                        "Missing details",
                        "Enter name + 10-digit phone.",
                      );
                      return;
                    }
                    createCustomer.mutate({
                      name: newName.trim(),
                      phone: newPhone.trim(),
                    });
                  }}
                  disabled={createCustomer.isPending}
                  style={({ pressed }) => [
                    styles.primarySmallBtn,
                    createCustomer.isPending && { opacity: 0.5 },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <UserPlus size={12} color={colors.emerald400} />
                  <Text variant="tiny" color={colors.emerald400} weight="600">
                    {createCustomer.isPending ? "Adding…" : "Add customer"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </Section>

        {/* ---------- 2. Sport ---------- */}
        <Section title="SPORT">
          <View style={styles.chipRow}>
            {(["CRICKET", "FOOTBALL", "PICKLEBALL"] as Sport[]).map((s) => {
              const active = sport === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    setSport(s);
                    setCourtConfigId(null);
                    setHours([]);
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    variant="tiny"
                    color={active ? colors.yellow400 : colors.zinc300}
                    weight="600"
                  >
                    {SPORT_EMOJI[s]} {sportLabel(s)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* ---------- 3. Court ---------- */}
        {sport ? (
          <Section title="COURT">
            {courtsQuery.isLoading ? (
              <Skeleton width="100%" height={44} rounded="md" />
            ) : filteredCourts.length === 0 ? (
              <Text variant="tiny" color={colors.zinc600}>
                No active courts for this sport.
              </Text>
            ) : (
              <View style={styles.chipRow}>
                {filteredCourts.map((c) => {
                  const active = courtConfigId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setCourtConfigId(c.id);
                        setHours([]);
                      }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        variant="tiny"
                        color={active ? colors.yellow400 : colors.zinc300}
                        weight="600"
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Section>
        ) : null}

        {/* ---------- 4. Date ---------- */}
        {courtConfigId ? (
          <Section title="DATE">
            <View style={styles.dateRow}>
              <Pressable
                onPress={() => shiftDay(-1)}
                style={styles.dateBtn}
                hitSlop={8}
              >
                <Text variant="small" color={colors.zinc300}>
                  ◀
                </Text>
              </Pressable>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text variant="bodyStrong">
                  <CalendarDays size={14} color={colors.yellow400} /> {prettyDate(date)}
                </Text>
              </View>
              <Pressable
                onPress={() => shiftDay(1)}
                style={styles.dateBtn}
                hitSlop={8}
              >
                <Text variant="small" color={colors.zinc300}>
                  ▶
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={date}
              onChangeText={(v) => {
                setDate(v);
                setHours([]);
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.zinc600}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { fontFamily: "Courier" }]}
            />
          </Section>
        ) : null}

        {/* ---------- 5. Slots ---------- */}
        {courtConfigId && date ? (
          <Section title={`SLOTS · ${hours.length} selected`}>
            {slotsQuery.isLoading ? (
              <View style={styles.slotGrid}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} width="48%" height={48} rounded="md" />
                ))}
              </View>
            ) : slotsQuery.isError ? (
              <Text variant="small" color={colors.destructive}>
                Couldn't load availability for this court+date.
              </Text>
            ) : (
              <View style={styles.slotGrid}>
                {slotsQuery.data!.slots.map((s) => (
                  <SlotTile
                    key={s.hour}
                    slot={s}
                    selected={hours.includes(s.hour)}
                    onToggle={() => toggleHour(s)}
                  />
                ))}
              </View>
            )}
          </Section>
        ) : null}

        {/* ---------- 6. Total + Payment ---------- */}
        {hours.length > 0 ? (
          <>
            <Section title="TOTAL AMOUNT (₹)">
              <Text variant="tiny" color={colors.zinc500}>
                {method === "FREE"
                  ? "Locked at ₹0 for FREE bookings"
                  : `Slot-sum: ${formatRupees(slotSum)} · type any other amount to override`}
              </Text>
              <View style={styles.totalRow}>
                <Text variant="small" color={colors.zinc400}>
                  ₹
                </Text>
                <TextInput
                  value={method === "FREE" ? "0" : customAmountStr}
                  onChangeText={setCustomAmountStr}
                  editable={method !== "FREE"}
                  placeholder={String(method === "FREE" ? 0 : slotSum)}
                  placeholderTextColor={colors.zinc600}
                  keyboardType="numeric"
                  style={[
                    styles.input,
                    { width: 140 },
                    method === "FREE" && { opacity: 0.5 },
                  ]}
                />
                {method !== "FREE" && customAmountOverride ? (
                  <Text
                    variant="tiny"
                    color={
                      parsedCustom < slotSum ? colors.yellow400 : colors.emerald400
                    }
                    weight="600"
                  >
                    {parsedCustom < slotSum
                      ? `Discount ${formatRupees(slotSum - parsedCustom)}`
                      : `Markup ${formatRupees(parsedCustom - slotSum)}`}
                  </Text>
                ) : null}
              </View>
            </Section>

            <Section title="PAYMENT METHOD">
              <View style={styles.chipRow}>
                {METHODS.map((m) => {
                  const active = method === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => {
                        setMethod(m);
                        if (m === "FREE") {
                          setIsPartial(false);
                          setCustomAmountStr("");
                        }
                      }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        variant="tiny"
                        color={active ? colors.yellow400 : colors.zinc300}
                        weight="600"
                      >
                        {METHOD_LABEL[m]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* Razorpay payment ID — needed when method=RAZORPAY OR
                when the partial advance came in via Razorpay. */}
            {method === "RAZORPAY" ||
            (isPartial && advanceMethod === "RAZORPAY") ? (
              <Section title="RAZORPAY PAYMENT ID">
                <TextInput
                  value={razorpayId}
                  onChangeText={setRazorpayId}
                  placeholder="pay_…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={colors.zinc600}
                  style={[styles.input, { fontFamily: "Courier" }]}
                />
              </Section>
            ) : null}

            {/* Partial-payment toggle — not available on FREE. */}
            {method !== "FREE" ? (
              <Section title="PARTIAL PAYMENT">
                <Pressable
                  onPress={() => setIsPartial((v) => !v)}
                  style={styles.toggleRow}
                >
                  <View
                    style={[
                      styles.checkbox,
                      isPartial && {
                        borderColor: colors.yellow400,
                        backgroundColor: "rgba(250, 204, 21, 0.18)",
                      },
                    ]}
                  />
                  <Text variant="small" weight="600">
                    Collect part now, rest at venue
                  </Text>
                </Pressable>

                {isPartial ? (
                  <View style={{ paddingLeft: 28, gap: spacing["2"] }}>
                    <View style={{ gap: 4 }}>
                      <Text variant="tiny" color={colors.zinc500}>
                        ADVANCE PAID (₹)
                      </Text>
                      <TextInput
                        value={advanceStr}
                        onChangeText={setAdvanceStr}
                        keyboardType="numeric"
                        placeholder={`e.g. ${Math.ceil(effectiveTotal / 2)}`}
                        placeholderTextColor={colors.zinc600}
                        style={[styles.input, { width: 140 }]}
                      />
                      {!advanceValid ? (
                        <Text variant="tiny" color={colors.destructive}>
                          Advance must be ≥ 0 and less than the total.
                        </Text>
                      ) : (
                        <Text variant="tiny" color={colors.yellow400}>
                          Remaining at venue: {formatRupees(remaining)}
                        </Text>
                      )}
                    </View>

                    <View style={{ gap: 4 }}>
                      <Text variant="tiny" color={colors.zinc500}>
                        VIA
                      </Text>
                      <View style={styles.chipRow}>
                        {ADVANCE_METHODS.map((m) => {
                          const active = advanceMethod === m;
                          return (
                            <Pressable
                              key={m}
                              onPress={() => setAdvanceMethod(m)}
                              style={[
                                styles.chip,
                                active && styles.chipActive,
                              ]}
                            >
                              <Text
                                variant="tiny"
                                color={
                                  active ? colors.yellow400 : colors.zinc300
                                }
                                weight="600"
                              >
                                {METHOD_LABEL[m]}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                ) : null}
              </Section>
            ) : null}

            {/* Note */}
            <Section title="NOTE (OPTIONAL)">
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Any context worth keeping (negotiation, special instructions)"
                multiline
                placeholderTextColor={colors.zinc600}
                style={[
                  styles.input,
                  { minHeight: 60, textAlignVertical: "top" },
                ]}
              />
            </Section>

            {/* Review / Submit */}
            <View style={styles.reviewCard}>
              <ReviewLine label="Customer" value={customer?.name ?? "—"} />
              <ReviewLine
                label="Court"
                value={`${SPORT_EMOJI[sport!]} ${courtConfig?.label ?? "—"}`}
              />
              <ReviewLine label="Date" value={prettyDate(date)} />
              <ReviewLine
                label="Slots"
                value={
                  hours.length === 0
                    ? "—"
                    : hours
                        .map((h) => formatHourRangeCompact(h))
                        .join(", ")
                }
              />
              <ReviewLine
                label="Method"
                value={`${METHOD_LABEL[method]}${isPartial ? " · Partial" : ""}${customAmountOverride ? " · Negotiated" : ""}`}
              />
              <View style={styles.totalRowReview}>
                <Text variant="small" color={colors.zinc400}>
                  Total
                </Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text variant="bodyStrong" color={colors.emerald400}>
                    {formatRupees(effectiveTotal)}
                  </Text>
                  {customAmountOverride && method !== "FREE" ? (
                    <Text
                      variant="tiny"
                      color={colors.zinc500}
                      style={{ textDecorationLine: "line-through" }}
                    >
                      {formatRupees(slotSum)}
                    </Text>
                  ) : null}
                </View>
              </View>
              {isPartial && advanceValid ? (
                <View style={{ gap: 2 }}>
                  <Text variant="tiny" color={colors.emerald400}>
                    Advance ({METHOD_LABEL[advanceMethod]}):{" "}
                    <Text
                      variant="tiny"
                      color={colors.emerald400}
                      weight="600"
                    >
                      {formatRupees(parsedAdvance)}
                    </Text>
                  </Text>
                  <Text variant="tiny" color={colors.yellow400}>
                    Due at venue:{" "}
                    <Text variant="tiny" color={colors.yellow400} weight="600">
                      {formatRupees(remaining)}
                    </Text>
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() => navigation.goBack()}
                style={[styles.actionBtn, styles.actionNeutral]}
              >
                <XCircle size={14} color={colors.zinc300} />
                <Text variant="small" color={colors.zinc300} weight="600">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => createBooking.mutate()}
                disabled={!canSubmit}
                style={[
                  styles.actionBtn,
                  styles.actionPrimary,
                  !canSubmit && { opacity: 0.5 },
                ]}
              >
                <Save size={14} color={colors.emerald400} />
                <Text variant="small" color={colors.emerald400} weight="600">
                  {createBooking.isPending ? "Creating…" : "Create booking"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// --------------------------------------------------------------------------
// Subcomponents

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text variant="tiny" color={colors.zinc500} style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function SlotTile({
  slot,
  selected,
  onToggle,
}: {
  slot: AvailableSlot;
  selected: boolean;
  onToggle: () => void;
}) {
  const disabled = slot.isBooked || slot.isBlocked;
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.slotTile,
        selected && styles.slotTileSelected,
        disabled && styles.slotTileDisabled,
        pressed && !disabled && { opacity: 0.7 },
      ]}
    >
      <View style={styles.slotTop}>
        {disabled ? (
          <Lock size={12} color={colors.zinc600} />
        ) : selected ? (
          <Check size={12} color={colors.emerald400} />
        ) : null}
        <Text
          variant="small"
          color={
            disabled
              ? colors.zinc600
              : selected
                ? colors.emerald400
                : colors.foreground
          }
          weight="600"
        >
          {formatHourRangeCompact(slot.hour)}
        </Text>
      </View>
      <Text
        variant="tiny"
        color={
          disabled
            ? colors.zinc700
            : selected
              ? colors.emerald400
              : colors.zinc500
        }
      >
        {disabled ? (slot.isBooked ? "Booked" : "Blocked") : formatRupees(slot.price)}
      </Text>
    </Pressable>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewLine}>
      <Text variant="tiny" color={colors.zinc500}>
        {label}
      </Text>
      <Text variant="small" color={colors.foreground} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

// --------------------------------------------------------------------------
// Styles

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  section: {
    gap: spacing["2"],
    paddingTop: spacing["2"],
  },
  sectionTitle: { letterSpacing: 1.5, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    backgroundColor: colors.background,
    fontSize: 14,
  },
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
  searchHit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  customerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.06)",
  },
  changeBtn: {
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  newCustomerCard: {
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  newCustomerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  primarySmallBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["3"],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
    alignSelf: "flex-start",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
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
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  dateBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  slotTile: {
    width: "48%",
    paddingVertical: spacing["2.5"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    gap: 4,
  },
  slotTileSelected: {
    borderColor: "rgba(34, 197, 94, 0.50)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  slotTileDisabled: {
    opacity: 0.5,
  },
  slotTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.zinc700,
  },
  reviewCard: {
    gap: spacing["1.5"],
    padding: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  reviewLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing["2"],
  },
  totalRowReview: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing["2"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
  },
  actions: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["1.5"],
    paddingVertical: spacing["3"],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionNeutral: {
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  actionPrimary: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
});

