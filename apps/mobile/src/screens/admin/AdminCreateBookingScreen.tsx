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
  Clock,
  Lock,
  Minus,
  Plus,
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
  type AdminBookingCoupon,
  type AdminCourt,
  type AdminEquipmentCatalogItem,
  type AvailableBowlingSlot,
  type AvailableSlot,
} from "../../lib/admin-bookings";
import {
  formatHourMinuteCompact,
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
  // Parallel state for the Bowling Machine court's 30-min picks.
  // Only one of `hours` / `bowlingSlots` is populated at a time —
  // the active branch is driven by the picked court's category.
  // Both get cleared on court swap so a stale hourly pick can't
  // sneak into a bowling submit and vice versa.
  const [bowlingSlots, setBowlingSlots] = useState<
    Array<{ hour: number; minute: 0 | 30 }>
  >([]);
  // Equipment rentals attached at create time. Map<id, qty> so the
  // qty controls below can −/+ a single key. Per-item cost = qty ×
  // pricePerHour (paise) × slotCount; rolls into effectiveTotal.
  const [selectedEquipment, setSelectedEquipment] = useState<
    Record<string, number>
  >({});

  // ---- Payment state ----
  const [method, setMethod] = useState<Method>("CASH");
  const [payWithPass, setPayWithPass] = useState(false);
  const [customAmountStr, setCustomAmountStr] = useState("");
  const [isPartial, setIsPartial] = useState(false);
  const [advanceStr, setAdvanceStr] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<AdvanceMethod>("CASH");
  const [razorpayId, setRazorpayId] = useState("");
  const [note, setNote] = useState("");
  // Coupon the desk is honouring at the counter. Web parity — the app
  // had no way to apply one at all, so a customer quoting a live code
  // could only be served by falling back to a custom amount.
  const [couponCode, setCouponCode] = useState("");

  // ---- Data queries ----
  // courtsQuery feeds both the picker chips AND the bowling/sport/
  // category derivations below; everything else depends on it
  // resolving first.
  const courtsQuery = useQuery({
    queryKey: ["admin-courts"],
    queryFn: () => adminBookingsApi.courts(),
  });

  // Resolve the picked court FIRST so the slot/equipment queries
  // below can branch off its category. Deriving these inline (vs.
  // a useMemo) is fine because the find() is O(n) over a small
  // list of courts and runs once per render.
  const courtConfig: AdminCourt | null =
    (courtsQuery.data?.courts ?? []).find((c) => c.id === courtConfigId) ??
    null;
  // Bowling detection — both signals checked so legacy rows with
  // slotDurationMinutes=60 + category=BOWLING_MACHINE still flip
  // into the 30-min picker. Mirror of the web detection (PR #129).
  const isBowlingConfig =
    courtConfig?.category === "BOWLING_MACHINE" ||
    courtConfig?.slotDurationMinutes === 30;

  // Hourly slots — only fetched for non-bowling courts. The bowling
  // branch below covers the 30-min picker.
  const slotsQuery = useQuery({
    queryKey: ["admin-create-slots", courtConfigId, date],
    queryFn: () =>
      adminBookingsApi.availableSlotsForCreate(courtConfigId!, date),
    enabled: !!courtConfigId && !!date && !isBowlingConfig,
  });

  // Bowling 30-min slots — only fetched when the picked court is the
  // Bowling Machine. Server runs adminOverride=true so all 48 slots
  // come back regardless of operating window / past-time guards.
  const bowlingSlotsQuery = useQuery({
    queryKey: ["admin-create-bowling-slots", courtConfigId, date],
    queryFn: () =>
      adminBookingsApi.availableBowlingSlots(courtConfigId!, date),
    enabled: !!courtConfigId && !!date && isBowlingConfig,
  });

  // Equipment catalog filtered to the court's sport + category.
  // Refetched whenever the court swaps; the cleanup effect below
  // also wipes any stale selections.
  const equipmentCatalogQuery = useQuery({
    queryKey: [
      "admin-create-equipment",
      courtConfig?.sport ?? null,
      courtConfig?.category ?? null,
    ],
    queryFn: () =>
      adminBookingsApi.equipmentForBookingCreate(
        courtConfig!.sport,
        courtConfig!.category ?? null,
      ),
    enabled: !!courtConfig,
  });

  // Coupons live for this court's sport/category. A failure leaves the
  // picker hidden — the booking still goes through at full price.
  const couponsQuery = useQuery({
    queryKey: [
      "admin-create-coupons",
      courtConfig?.sport ?? null,
      courtConfig?.category ?? null,
    ],
    queryFn: () =>
      adminBookingsApi.couponOptions(
        courtConfig!.sport,
        courtConfig!.category ?? null,
      ),
    enabled: !!courtConfig,
  });
  const couponOptions: AdminBookingCoupon[] = couponsQuery.data?.coupons ?? [];

  const slotPrices = slotsQuery.data?.slots ?? [];
  const bowlingPrices = bowlingSlotsQuery.data?.slots ?? [];
  const equipmentCatalog: AdminEquipmentCatalogItem[] =
    equipmentCatalogQuery.data?.items ?? [];

  // slotSum branches: bowling sums per-{hour,minute} pair, hourly
  // sums per-hour. selectedSlotCount drives equipment pricing
  // (every rental is billed quantity × pricePerHour × slotCount,
  // matching the post-create EquipmentEditor's formula).
  const slotSum = useMemo(() => {
    if (isBowlingConfig) {
      return bowlingSlots.reduce((sum, s) => {
        const slot = bowlingPrices.find(
          (x) => x.hour === s.hour && x.minute === s.minute,
        );
        return sum + (slot?.price ?? 0);
      }, 0);
    }
    return hours.reduce((sum, h) => {
      const slot = slotPrices.find((s) => s.hour === h);
      return sum + (slot?.price ?? 0);
    }, 0);
  }, [isBowlingConfig, hours, slotPrices, bowlingSlots, bowlingPrices]);
  const selectedSlotCount = isBowlingConfig ? bowlingSlots.length : hours.length;

  // Equipment subtotal in rupees. Mirror of the web form's formula:
  // qty * pricePerUnitPaise * slotCount, summed in paise, rounded
  // to rupees. Zero when no items picked.
  const equipmentTotalRupees = useMemo(() => {
    return Math.round(
      Object.entries(selectedEquipment).reduce((sum, [id, qty]) => {
        const item = equipmentCatalog.find((r) => r.id === id);
        if (!item || qty <= 0) return sum;
        return (
          sum + item.pricePerUnitPaise * qty * Math.max(1, selectedSlotCount)
        );
      }, 0) / 100,
    );
  }, [selectedEquipment, equipmentCatalog, selectedSlotCount]);

  // Effective total: typed value wins when valid, else slot-sum.
  // Locked at 0 for FREE.
  const parsedCustom = parseInt(customAmountStr, 10);
  const customAmountValid =
    customAmountStr.trim().length > 0 &&
    Number.isFinite(parsedCustom) &&
    parsedCustom >= 0 &&
    (method !== "FREE" ? parsedCustom > 0 : parsedCustom === 0);
  const customAmountOverride = customAmountValid && parsedCustom !== slotSum;

  // Coupon vs custom amount are mutually exclusive — the server rejects
  // both together, so a typed amount wins and the coupon stands down.
  const selectedCoupon =
    couponOptions.find((c) => c.code === couponCode) ?? null;
  const couponApplies =
    !!selectedCoupon && method !== "FREE" && !payWithPass && !customAmountValid;
  // Mirrors actions/coupon-validation.ts: PERCENTAGE value is basis
  // points and caps at maxDiscount; FLAT is whole rupees, capped at the
  // slot sum. Equipment isn't discounted, same as the web form.
  const couponDiscount = (() => {
    if (!couponApplies || !selectedCoupon) return 0;
    if (selectedCoupon.type === "PERCENTAGE") {
      const raw = Math.floor((slotSum * selectedCoupon.value) / 10000);
      return selectedCoupon.maxDiscount !== null
        ? Math.min(raw, selectedCoupon.maxDiscount)
        : raw;
    }
    return Math.min(selectedCoupon.value, slotSum);
  })();
  // Effective total includes the equipment rentals unless admin
  // typed a custom amount (which is treated as inclusive of
  // equipment, same convention the server enforces). FREE locks
  // at zero.
  const effectiveTotal =
    method === "FREE"
      ? 0
      : customAmountValid
        ? parsedCustom
        : slotSum - couponDiscount + equipmentTotalRupees;

  const parsedAdvance = parseInt(advanceStr, 10);
  const advanceValid =
    !isPartial ||
    (Number.isFinite(parsedAdvance) &&
      parsedAdvance >= 0 &&
      parsedAdvance < effectiveTotal);
  const remaining =
    isPartial && advanceValid ? effectiveTotal - parsedAdvance : 0;

  // When partial, the advance method the customer actually used IS the
  // method recorded on the Payment row — the top "PAYMENT METHOD" chip
  // only describes the remainder, which gets its own method later via
  // the mark-collected flow. Mirror of the web form's
  // effectivePaymentMethod so a UPI/Razorpay advance isn't filed as cash.
  const effectiveMethod: Method =
    isPartial && advanceValid ? advanceMethod : method;

  // ---- Derived UI gating ----
  const filteredCourts: AdminCourt[] = useMemo(
    () => (courtsQuery.data?.courts ?? []).filter((c) => c.sport === sport),
    [courtsQuery.data, sport],
  );

  // courtConfig + isBowlingConfig are derived above the queries so
  // the slot/equipment query branches can read them. Nothing to do
  // here.

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

  // Pass-coverage preview — recomputed whenever customer/court/date/
  // slots change; the checkbox renders only when a pass covers
  // something (mirror of the web create form).
  const passPreviewQ = useQuery({
    queryKey: [
      "admin-pass-preview",
      customer?.id,
      courtConfigId,
      date,
      hours.join(","),
      bowlingSlots.map((sl) => `${sl.hour}:${sl.minute}`).join(","),
    ],
    queryFn: () =>
      adminBookingsApi.passPreview({
        userId: customer!.id,
        courtConfigId: courtConfigId!,
        date,
        hours: isBowlingConfig ? [] : [...hours].sort((a, b) => a - b),
        bowlingSlots: isBowlingConfig ? bowlingSlots : undefined,
      }),
    enabled:
      !!customer &&
      !!courtConfigId &&
      !!date &&
      (isBowlingConfig ? bowlingSlots.length > 0 : hours.length > 0),
    staleTime: 15_000,
  });
  const passPreview = passPreviewQ.data?.preview;
  useEffect(() => {
    if (!passPreview?.eligible) setPayWithPass(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passPreview?.eligible]);

  const createBooking = useMutation({
    mutationFn: () => {
      if (!customer || !courtConfigId) {
        throw new Error("Missing required field");
      }
      // Reduce equipment Map → array; only send entries with qty > 0.
      // Server re-validates each id + isActive.
      const equipmentPayload = Object.entries(selectedEquipment)
        .filter(([, qty]) => qty > 0)
        .map(([equipmentId, quantity]) => ({ equipmentId, quantity }));

      return adminBookingsApi.create({
        courtConfigId,
        date,
        // Bowling courts ship bowlingSlots[]; hourly courts ship
        // hours[]. Server picks the path by court.category /
        // slotDurationMinutes and rejects mismatched payloads.
        hours: isBowlingConfig ? [] : hours,
        bowlingSlots: isBowlingConfig ? bowlingSlots : undefined,
        userId: customer.id,
        paymentMethod: effectiveMethod,
        // Server only persists razorpayPaymentId when paymentMethod is
        // RAZORPAY, so key it off the same effective method.
        razorpayPaymentId:
          effectiveMethod === "RAZORPAY"
            ? razorpayId.trim() || undefined
            : undefined,
        // Only send when the admin actually changed the figure — null
        // here lets the server default to the slot-sum.
        customTotalAmount: customAmountOverride ? parsedCustom : undefined,
        // Server rejects a coupon alongside a custom amount, and re-runs
        // the full validator on the code — this is a request, not a grant.
        applyCouponCode: couponApplies ? couponCode : undefined,
        advanceAmount: isPartial ? parsedAdvance : undefined,
        equipment:
          equipmentPayload.length > 0 ? equipmentPayload : undefined,
        payWithPass: payWithPass || undefined,
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
    selectedSlotCount > 0 &&
    (method === "FREE" || effectiveTotal > 0) &&
    advanceValid &&
    (effectiveMethod !== "RAZORPAY" || razorpayId.trim().length > 0) &&
    !createBooking.isPending;

  // ---- Reset selections when court swaps ----
  // Clears stale slot + equipment picks the moment the admin
  // changes the court (e.g. cricket → bowling, or any size swap
  // inside a sport). Without this, a hourly pick could survive into
  // the bowling submit payload (the server would reject, but the
  // UI would let the user reach Submit). Also clears the typed
  // custom amount because pricing is no longer comparable.
  useEffect(() => {
    setHours([]);
    setBowlingSlots([]);
    setSelectedEquipment({});
    setCustomAmountStr("");
    // A code that was live for the old court's sport may not be for the
    // new one — the picker reloads, so drop the stale pick.
    setCouponCode("");
    // courtConfigId is the trigger — date / isBowlingConfig
    // derive from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courtConfigId]);

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

  // Bowling 30-min toggle — parallel of toggleHour, but tracks
  // {hour, minute} pairs in the selectedBowlingSlots state.
  function toggleBowlingSlot(slot: AvailableBowlingSlot) {
    if (slot.isBooked || slot.isBlocked) return;
    setBowlingSlots((curr) => {
      const has = curr.some(
        (s) => s.hour === slot.hour && s.minute === slot.minute,
      );
      const next = has
        ? curr.filter(
            (s) => !(s.hour === slot.hour && s.minute === slot.minute),
          )
        : [...curr, { hour: slot.hour, minute: slot.minute }];
      return next.sort(
        (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
      );
    });
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
        {/* Hourly courts render the existing SlotTile grid; bowling
            courts render a 30-min BowlingSlotTile grid (parallel
            shape, distinct {hour, minute} keying). Branching here
            keeps the two flows independent and the loading state
            specific to whichever query is active. */}
        {courtConfigId && date ? (
          <Section
            title={
              isBowlingConfig
                ? `30-MIN SLOTS · ${bowlingSlots.length} selected`
                : `SLOTS · ${hours.length} selected`
            }
          >
            {isBowlingConfig ? (
              bowlingSlotsQuery.isLoading ? (
                <View style={styles.slotGrid}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} width="48%" height={48} rounded="md" />
                  ))}
                </View>
              ) : bowlingSlotsQuery.isError ? (
                <Text variant="small" color={colors.destructive}>
                  Couldn't load bowling slots for this date.
                </Text>
              ) : (
                <View style={styles.slotGrid}>
                  {bowlingSlotsQuery.data!.slots.map((s) => (
                    <BowlingSlotTile
                      key={`${s.hour}:${s.minute}`}
                      slot={s}
                      selected={bowlingSlots.some(
                        (b) => b.hour === s.hour && b.minute === s.minute,
                      )}
                      onToggle={() => toggleBowlingSlot(s)}
                    />
                  ))}
                </View>
              )
            ) : slotsQuery.isLoading ? (
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

        {/* ---------- 5b. Equipment rentals ---------- */}
        {/* Filtered to the court's sport + category. Per-row cost
            scales by the selected slot count, mirroring the post-
            create EquipmentEditor's pricing exactly. Section hidden
            when no items match (e.g. a sport with no rentals
            configured) or while the catalog is still fetching. */}
        {courtConfig && equipmentCatalog.length > 0 ? (
          <Section
            title={`RENTAL EQUIPMENT${
              selectedSlotCount > 0 ? ` · ${selectedSlotCount} × slot rate` : ""
            }`}
          >
            <Text variant="tiny" color={colors.zinc500}>
              {selectedSlotCount > 0
                ? "Cost folds into the total below."
                : "Pick slots first to see the per-item total."}
            </Text>
            {equipmentCatalog.map((item) => {
              const qty = selectedEquipment[item.id] ?? 0;
              const pricePerSlotRupees = Math.round(
                item.pricePerUnitPaise / 100,
              );
              const rowTotalRupees =
                qty > 0
                  ? Math.round(
                      (item.pricePerUnitPaise *
                        qty *
                        Math.max(1, selectedSlotCount)) /
                        100,
                    )
                  : 0;
              return (
                <View key={item.id} style={styles.equipmentRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="small" color={colors.foreground}>
                      {item.name}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {formatRupees(pricePerSlotRupees)} / slot
                    </Text>
                  </View>
                  <View style={styles.equipmentQtyRow}>
                    <Pressable
                      onPress={() =>
                        setSelectedEquipment((prev) => {
                          const next = { ...prev };
                          const nextQty = (next[item.id] ?? 0) - 1;
                          if (nextQty <= 0) delete next[item.id];
                          else next[item.id] = nextQty;
                          return next;
                        })
                      }
                      disabled={qty <= 0}
                      style={({ pressed }) => [
                        styles.equipmentQtyBtn,
                        qty <= 0 && { opacity: 0.3 },
                        pressed && qty > 0 && { opacity: 0.6 },
                      ]}
                    >
                      <Minus size={14} color={colors.foreground} />
                    </Pressable>
                    <Text
                      variant="small"
                      color={colors.foreground}
                      style={styles.equipmentQtyValue}
                    >
                      {qty}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setSelectedEquipment((prev) => ({
                          ...prev,
                          [item.id]: (prev[item.id] ?? 0) + 1,
                        }))
                      }
                      style={({ pressed }) => [
                        styles.equipmentQtyBtn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Plus size={14} color={colors.foreground} />
                    </Pressable>
                  </View>
                  <Text
                    variant="tiny"
                    color={colors.zinc400}
                    style={styles.equipmentRowTotal}
                  >
                    {qty > 0 ? formatRupees(rowTotalRupees) : ""}
                  </Text>
                </View>
              );
            })}
            {equipmentTotalRupees > 0 ? (
              <View style={styles.equipmentSubtotalRow}>
                <Text variant="small" color={colors.zinc400}>
                  Equipment subtotal
                </Text>
                <Text variant="small" weight="600" color={colors.emerald400}>
                  {formatRupees(equipmentTotalRupees)}
                </Text>
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* ---------- 6. Total + Payment ---------- */}
        {selectedSlotCount > 0 ? (
          <>
            {couponOptions.length > 0 && method !== "FREE" && !payWithPass ? (
              <Section title="COUPON">
                <Text variant="tiny" color={colors.zinc500}>
                  Codes live for this sport. The server re-checks every
                  rule when the booking is created.
                </Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setCouponCode("")}
                    style={[styles.chip, !couponCode && styles.chipActive]}
                  >
                    <Text
                      variant="small"
                      color={!couponCode ? colors.emerald400 : colors.zinc300}
                    >
                      No coupon
                    </Text>
                  </Pressable>
                  {couponOptions.map((c) => {
                    const on = couponCode === c.code;
                    return (
                      <Pressable
                        key={c.code}
                        onPress={() => setCouponCode(on ? "" : c.code)}
                        style={[styles.chip, on && styles.chipActive]}
                      >
                        <Text
                          variant="small"
                          color={on ? colors.emerald400 : colors.zinc300}
                        >
                          {c.code} ·{" "}
                          {c.type === "PERCENTAGE"
                            ? `${c.value / 100}% off`
                            : `${formatRupees(c.value)} off`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {selectedCoupon ? (
                  <>
                    {couponDiscount > 0 ? (
                      <Text variant="small" weight="600" color={colors.emerald400}>
                        Saves {formatRupees(couponDiscount)} —{" "}
                        {formatRupees(slotSum)} → {formatRupees(slotSum - couponDiscount)}
                      </Text>
                    ) : null}
                    {customAmountValid ? (
                      <Text variant="tiny" color={colors.yellow400}>
                        A custom amount is set — clear it to apply this coupon.
                      </Text>
                    ) : null}
                    {selectedCoupon.restrictedNote ? (
                      <Text variant="tiny" color={colors.zinc500}>
                        {selectedCoupon.restrictedNote} — the server may reject
                        it for this customer.
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </Section>
            ) : null}

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

              {/* Book with the customer's pass — renders only when an
                  eligible pass covers something. Full coverage books at
                  ₹0 (method PASS); partial keeps the chosen method for
                  the remainder. */}
              {passPreview?.eligible && method !== "FREE" ? (
                <Pressable
                  onPress={() => setPayWithPass((v) => !v)}
                  style={[
                    styles.passOptRow,
                    payWithPass && styles.passOptRowActive,
                  ]}
                >
                  <View
                    style={[
                      styles.passOptBox,
                      payWithPass && styles.passOptBoxActive,
                    ]}
                  >
                    {payWithPass ? (
                      <Text style={styles.passOptTick}>✓</Text>
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="small" weight="600" color={colors.foreground}>
                      Book with customer&apos;s pass
                    </Text>
                    <Text variant="tiny" color={colors.emerald400}>
                      {passPreview.passes
                        .map(
                          (sh) =>
                            `${sh.passName} (${(sh.coveredMinutes / 60)
                              .toFixed(1)
                              .replace(/\.0$/, "")}h)`,
                        )
                        .join(" + ")}
                      {passPreview.fullCoverage
                        ? " — fully covered, ₹0 to collect"
                        : ` — remainder ₹${passPreview.remainderAmount} via ${METHOD_LABEL[method]}`}
                    </Text>
                    {payWithPass ? (
                      <Text variant="tiny" color={colors.zinc500}>
                        Custom amounts and advance splits don&apos;t combine
                        with a pass.
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ) : null}
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
                value={`${METHOD_LABEL[effectiveMethod]}${isPartial ? " · Partial" : ""}${customAmountOverride ? " · Negotiated" : ""}`}
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

function BowlingSlotTile({
  slot,
  selected,
  onToggle,
}: {
  slot: AvailableBowlingSlot;
  selected: boolean;
  onToggle: () => void;
}) {
  const disabled = slot.isBooked || slot.isBlocked;
  const start = slot.hour * 60 + slot.minute;
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
        ) : (
          <Clock size={12} color={colors.zinc500} />
        )}
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
          {formatHourMinuteCompact(start)} - {formatHourMinuteCompact(start + 30)}
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
  passOptRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    marginTop: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    padding: spacing["3"],
  },
  passOptRowActive: {
    borderColor: "rgba(16,185,129,0.5)",
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  passOptBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  passOptBoxActive: {
    borderColor: colors.emerald500,
    backgroundColor: colors.emerald500,
  },
  passOptTick: {
    color: "#000",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 14,
  },
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
  // Equipment rental section — one row per catalog item with the
  // name+price on the left, qty −/+ controls in the middle, and
  // the per-row total pinned to the right. Subtotal pill at the
  // bottom mirrors the web layout.
  equipmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  equipmentQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  equipmentQtyBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  equipmentQtyValue: {
    minWidth: 18,
    textAlign: "center",
  },
  equipmentRowTotal: {
    minWidth: 60,
    textAlign: "right",
  },
  equipmentSubtotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing["2"],
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

