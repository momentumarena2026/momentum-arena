"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getCouponUsageDetails,
} from "@/actions/admin-coupons";
import {
  CouponScope,
  CouponConditionType,
  DiscountType,
  Sport,
  CafeItemCategory,
  UserGroupType,
} from "@prisma/client";
import {
  Plus,
  X,
  Loader2,
  Ticket,
  Percent,
  IndianRupee,
  ChevronDown,
  ChevronUp,
  Copy,
  Trash2,
  Edit3,
  Eye,
  EyeOff,
  Users,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface ConditionRow {
  conditionType: CouponConditionType;
  conditionValue: string;
}

interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  scope: CouponScope;
  type: DiscountType;
  value: number;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  minAmount: number | null;
  sportFilter: Sport[];
  categoryFilter: CafeItemCategory[];
  userGroupFilter: UserGroupType[];
  isStackable: boolean;
  stackGroup: string | null;
  isPublic: boolean;
  isSystemCode: boolean;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  usageCount: number;
  conditions: ConditionRow[];
}

interface UsageRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
  bookingId: string | null;
  cafeOrderId: string | null;
  discountAmount: number;
  createdAt: string;
}

const SPORTS: Sport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];
const CATEGORIES: CafeItemCategory[] = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
];
const USER_GROUPS: { value: UserGroupType; label: string }[] = [
  { value: "FIRST_TIME", label: "First Time" },
  { value: "PREMIUM_PLAYER", label: "Premium Player (10+ bookings)" },
  { value: "FREQUENT_VISITOR", label: "Frequent Visitor (5+ orders)" },
  { value: "BIRTHDAY_MONTH", label: "Birthday Month" },
];
const CONDITION_TYPES: { value: CouponConditionType; label: string }[] = [
  { value: "MIN_AMOUNT", label: "Minimum Amount" },
  { value: "FIRST_PURCHASE", label: "First Purchase" },
  { value: "TIME_WINDOW", label: "Time Window" },
];

const SCOPE_COLORS: Record<string, string> = {
  SPORTS: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  CAFE: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  BOTH: "bg-purple-500/10 border-purple-500/30 text-purple-400",
};

function emptyForm() {
  return {
    code: "",
    description: "",
    scope: "BOTH" as CouponScope,
    type: "PERCENTAGE" as DiscountType,
    value: "",
    maxDiscount: "",
    maxUses: "",
    maxUsesPerUser: "1",
    minAmount: "",
    sportFilter: [] as Sport[],
    categoryFilter: [] as CafeItemCategory[],
    userGroupFilter: [] as UserGroupType[],
    isStackable: false,
    stackGroup: "",
    isPublic: true,
    isSystemCode: false,
    validFrom: new Date().toISOString().split("T")[0],
    validUntil: new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .split("T")[0],
    conditions: [] as ConditionRow[],
  };
}

export function CouponsManager({ coupons }: { coupons: CouponRow[] }) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [expandedUsage, setExpandedUsage] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageRow[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [filterScope, setFilterScope] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCoupons = coupons.filter((c) => {
    if (filterScope !== "ALL" && c.scope !== filterScope) return false;
    if (
      searchQuery &&
      !c.code.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !(c.description || "").toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setShowModal(true);
  };

  const openEdit = (coupon: CouponRow) => {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      description: coupon.description || "",
      scope: coupon.scope,
      type: coupon.type,
      value: String(coupon.value),
      maxDiscount: coupon.maxDiscount ? String(coupon.maxDiscount) : "",
      maxUses: coupon.maxUses ? String(coupon.maxUses) : "",
      maxUsesPerUser: String(coupon.maxUsesPerUser),
      minAmount: coupon.minAmount ? String(coupon.minAmount) : "",
      sportFilter: [...coupon.sportFilter],
      categoryFilter: [...coupon.categoryFilter],
      userGroupFilter: [...coupon.userGroupFilter],
      isStackable: coupon.isStackable,
      stackGroup: coupon.stackGroup || "",
      isPublic: coupon.isPublic,
      isSystemCode: coupon.isSystemCode,
      validFrom: coupon.validFrom,
      validUntil: coupon.validUntil,
      conditions: coupon.conditions.map((c) => ({
        conditionType: c.conditionType,
        conditionValue: c.conditionValue,
      })),
    });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const value = parseInt(form.value);
    if (isNaN(value) || value <= 0) {
      setError("Value must be a positive number");
      setSaving(false);
      return;
    }

    const payload = {
      code: form.code,
      description: form.description || undefined,
      scope: form.scope,
      type: form.type,
      value,
      maxDiscount: form.maxDiscount ? parseInt(form.maxDiscount) : null,
      maxUses: form.maxUses ? parseInt(form.maxUses) : null,
      maxUsesPerUser: parseInt(form.maxUsesPerUser) || 1,
      minAmount: form.minAmount ? parseInt(form.minAmount) : null,
      sportFilter: form.sportFilter,
      categoryFilter: form.categoryFilter,
      userGroupFilter: form.userGroupFilter,
      isStackable: form.isStackable,
      stackGroup: form.stackGroup || null,
      isPublic: form.isPublic,
      isSystemCode: form.isSystemCode,
      validFrom: form.validFrom,
      validUntil: form.validUntil,
      conditions: form.conditions,
    };

    let result;
    if (editingId) {
      result = await updateCoupon(editingId, payload);
    } else {
      result = await createCoupon(payload);
    }

    if (result.success) {
      setShowModal(false);
      setForm(emptyForm());
      router.refresh();
    } else {
      setError(result.error || "Failed to save coupon");
    }
    setSaving(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await updateCoupon(id, { isActive: !isActive });
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this coupon?")) return;
    await deleteCoupon(id);
    router.refresh();
  };

  const handleViewUsage = async (couponId: string) => {
    if (expandedUsage === couponId) {
      setExpandedUsage(null);
      return;
    }
    setLoadingUsage(true);
    setExpandedUsage(couponId);
    const data = await getCouponUsageDetails(couponId);
    setUsageData(data);
    setLoadingUsage(false);
  };

  const toggleSportFilter = (sport: Sport) => {
    setForm((p) => ({
      ...p,
      sportFilter: p.sportFilter.includes(sport)
        ? p.sportFilter.filter((s) => s !== sport)
        : [...p.sportFilter, sport],
    }));
  };

  const toggleCategoryFilter = (cat: CafeItemCategory) => {
    setForm((p) => ({
      ...p,
      categoryFilter: p.categoryFilter.includes(cat)
        ? p.categoryFilter.filter((c) => c !== cat)
        : [...p.categoryFilter, cat],
    }));
  };

  const toggleUserGroup = (group: UserGroupType) => {
    setForm((p) => ({
      ...p,
      userGroupFilter: p.userGroupFilter.includes(group)
        ? p.userGroupFilter.filter((g) => g !== group)
        : [...p.userGroupFilter, group],
    }));
  };

  const addCondition = () => {
    setForm((p) => ({
      ...p,
      conditions: [
        ...p.conditions,
        { conditionType: "MIN_AMOUNT" as CouponConditionType, conditionValue: "{}" },
      ],
    }));
  };

  const removeCondition = (index: number) => {
    setForm((p) => ({
      ...p,
      conditions: p.conditions.filter((_, i) => i !== index),
    }));
  };

  const updateCondition = (
    index: number,
    field: "conditionType" | "conditionValue",
    value: string
  ) => {
    setForm((p) => ({
      ...p,
      conditions: p.conditions.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      ),
    }));
  };

  const formatValue = (type: DiscountType, value: number) => {
    if (type === "PERCENTAGE") return `${(value / 100).toFixed(0)}%`;
    return formatPrice(value);
  };

  const showSports = form.scope === "SPORTS" || form.scope === "BOTH";
  const showCategories = form.scope === "CAFE" || form.scope === "BOTH";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-emerald-600/10 border border-emerald-500/30 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
        >
          <Plus className="h-4 w-4" />
          Create Coupon
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {["ALL", "SPORTS", "CAFE", "BOTH"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterScope(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filterScope === s
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search coupons..."
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500"
        />
      </div>

      {/* Coupons Table */}
      <div className="space-y-2">
        {filteredCoupons.map((coupon) => (
          <div key={coupon.id}>
            <div
              className={`rounded-xl border p-4 ${
                coupon.isActive
                  ? "border-zinc-800 bg-zinc-900"
                  : "border-zinc-800/50 bg-zinc-900/50 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`mt-0.5 shrink-0 rounded-lg p-2 ${
                      coupon.type === "PERCENTAGE"
                        ? "bg-purple-500/10"
                        : "bg-emerald-500/10"
                    }`}
                  >
                    {coupon.type === "PERCENTAGE" ? (
                      <Percent className="h-4 w-4 text-purple-400" />
                    ) : (
                      <IndianRupee className="h-4 w-4 text-emerald-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-white">
                        {coupon.code}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          SCOPE_COLORS[coupon.scope]
                        }`}
                      >
                        {coupon.scope}
                      </span>
                      {coupon.isSystemCode && (
                        <span className="rounded-full bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[10px] text-blue-400">
                          System
                        </span>
                      )}
                      {!coupon.isPublic && (
                        <span className="rounded-full bg-zinc-500/10 border border-zinc-500/30 px-2 py-0.5 text-[10px] text-zinc-400">
                          Hidden
                        </span>
                      )}
                      {coupon.isStackable && (
                        <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] text-cyan-400">
                          Stackable
                        </span>
                      )}
                      <span className="text-sm font-medium text-emerald-400">
                        {formatValue(coupon.type, coupon.value)} off
                        {coupon.maxDiscount
                          ? ` (max ${formatPrice(coupon.maxDiscount)})`
                          : ""}
                      </span>
                    </div>
                    {coupon.description && (
                      <p className="mt-0.5 text-xs text-zinc-400 truncate">
                        {coupon.description}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      <span>
                        {coupon.usedCount}/{coupon.maxUses ?? "\u221E"} used
                      </span>
                      <span>
                        Valid {coupon.validFrom} to {coupon.validUntil}
                      </span>
                      {coupon.minAmount && (
                        <span>Min {formatPrice(coupon.minAmount)}</span>
                      )}
                      {coupon.sportFilter.length > 0 && (
                        <span>{coupon.sportFilter.join(", ")}</span>
                      )}
                      {coupon.categoryFilter.length > 0 && (
                        <span>{coupon.categoryFilter.join(", ")}</span>
                      )}
                      {coupon.userGroupFilter.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {coupon.userGroupFilter.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleViewUsage(coupon.id)}
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    title="View usage"
                  >
                    {expandedUsage === coupon.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(coupon)}
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    title="Edit"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(coupon.id, coupon.isActive)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      coupon.isActive ? "bg-emerald-600" : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                        coupon.isActive ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <button
                    onClick={() => handleDelete(coupon.id)}
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                    title="Deactivate"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Usage Details */}
            {expandedUsage === coupon.id && (
              <div className="mx-4 rounded-b-xl border border-t-0 border-zinc-800 bg-zinc-950 p-4">
                {loadingUsage ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading
                    usage...
                  </div>
                ) : usageData.length === 0 ? (
                  <p className="text-sm text-zinc-500">No usages yet</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-400">
                      {usageData.length} usage(s)
                    </p>
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-zinc-500">
                            <th className="pb-2 pr-3">User</th>
                            <th className="pb-2 pr-3">Discount</th>
                            <th className="pb-2 pr-3">Type</th>
                            <th className="pb-2">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageData.map((u) => (
                            <tr
                              key={u.id}
                              className="border-t border-zinc-800/50"
                            >
                              <td className="py-1.5 pr-3 text-zinc-300">
                                {u.userName}
                                {u.userEmail && (
                                  <span className="ml-1 text-zinc-600">
                                    ({u.userEmail})
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 pr-3 text-emerald-400">
                                {formatPrice(u.discountAmount)}
                              </td>
                              <td className="py-1.5 pr-3 text-zinc-400">
                                {u.bookingId
                                  ? "Booking"
                                  : u.cafeOrderId
                                    ? "Cafe"
                                    : "-"}
                              </td>
                              <td className="py-1.5 text-zinc-500">
                                {new Date(u.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {filteredCoupons.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <Ticket className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">No coupons found</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">
                {editingId ? "Edit Coupon" : "Create Coupon"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* Code & Description */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Code
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        code: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. SUMMER20"
                    disabled={!!editingId}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 uppercase disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, description: e.target.value }))
                    }
                    placeholder="Summer sale 20% off"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                  />
                </div>
              </div>

              {/* Scope */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Scope
                </label>
                <div className="flex gap-2">
                  {(["SPORTS", "CAFE", "BOTH"] as CouponScope[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setForm((p) => ({ ...p, scope: s }))}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                        form.scope === s
                          ? SCOPE_COLORS[s]
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type & Value */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Discount Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        type: e.target.value as DiscountType,
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  >
                    <option value="PERCENTAGE">Percentage</option>
                    <option value="FLAT">Flat Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Value{" "}
                    <span className="text-zinc-600">
                      {form.type === "PERCENTAGE"
                        ? "(basis pts, 1000=10%)"
                        : "(paise, 10000=₹100)"}
                    </span>
                  </label>
                  <input
                    type="number"
                    value={form.value}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, value: e.target.value }))
                    }
                    placeholder={
                      form.type === "PERCENTAGE" ? "1000" : "10000"
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                  />
                </div>
                {form.type === "PERCENTAGE" && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Max Discount{" "}
                      <span className="text-zinc-600">(paise, optional)</span>
                    </label>
                    <input
                      type="number"
                      value={form.maxDiscount}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          maxDiscount: e.target.value,
                        }))
                      }
                      placeholder="e.g. 50000 = ₹500"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                    />
                  </div>
                )}
              </div>

              {/* Limits */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Max Uses{" "}
                    <span className="text-zinc-600">(empty=unlimited)</span>
                  </label>
                  <input
                    type="number"
                    value={form.maxUses}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, maxUses: e.target.value }))
                    }
                    placeholder="Unlimited"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Per-User Limit
                  </label>
                  <input
                    type="number"
                    value={form.maxUsesPerUser}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        maxUsesPerUser: e.target.value,
                      }))
                    }
                    placeholder="1"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Min Amount{" "}
                    <span className="text-zinc-600">(paise, optional)</span>
                  </label>
                  <input
                    type="number"
                    value={form.minAmount}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, minAmount: e.target.value }))
                    }
                    placeholder="e.g. 50000 = ₹500"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                  />
                </div>
              </div>

              {/* Sport Filter */}
              {showSports && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Sport Filter{" "}
                    <span className="text-zinc-600">
                      (empty = all sports)
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SPORTS.map((sport) => (
                      <button
                        key={sport}
                        onClick={() => toggleSportFilter(sport)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          form.sportFilter.includes(sport)
                            ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                            : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {sport}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Category Filter */}
              {showCategories && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Category Filter{" "}
                    <span className="text-zinc-600">
                      (empty = all categories)
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => toggleCategoryFilter(cat)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          form.categoryFilter.includes(cat)
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                            : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* User Groups */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  User Group Filter{" "}
                  <span className="text-zinc-600">(optional targeting)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {USER_GROUPS.map((g) => (
                    <button
                      key={g.value}
                      onClick={() => toggleUserGroup(g.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        form.userGroupFilter.includes(g.value)
                          ? "border-purple-500/30 bg-purple-500/10 text-purple-400"
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditions Builder */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-400">
                    Conditions
                  </label>
                  <button
                    onClick={addCondition}
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    <Plus className="h-3 w-3" /> Add Condition
                  </button>
                </div>
                {form.conditions.length === 0 && (
                  <p className="text-xs text-zinc-600">No conditions set</p>
                )}
                <div className="space-y-2">
                  {form.conditions.map((cond, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                    >
                      <select
                        value={cond.conditionType}
                        onChange={(e) =>
                          updateCondition(
                            i,
                            "conditionType",
                            e.target.value
                          )
                        }
                        className="rounded-md border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                      >
                        {CONDITION_TYPES.map((ct) => (
                          <option key={ct.value} value={ct.value}>
                            {ct.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex-1">
                        {cond.conditionType === "MIN_AMOUNT" && (
                          <input
                            type="number"
                            value={
                              (() => {
                                try {
                                  return JSON.parse(cond.conditionValue)
                                    .minAmount || "";
                                } catch {
                                  return "";
                                }
                              })()
                            }
                            onChange={(e) =>
                              updateCondition(
                                i,
                                "conditionValue",
                                JSON.stringify({
                                  minAmount: parseInt(e.target.value) || 0,
                                })
                              )
                            }
                            placeholder="Min amount in paise"
                            className="w-full rounded-md border border-zinc-700 bg-zinc-800 p-2 text-xs text-white placeholder-zinc-500"
                          />
                        )}
                        {cond.conditionType === "TIME_WINDOW" && (
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="0"
                              max="23"
                              value={
                                (() => {
                                  try {
                                    return (
                                      JSON.parse(cond.conditionValue)
                                        .startHour ?? ""
                                    );
                                  } catch {
                                    return "";
                                  }
                                })()
                              }
                              onChange={(e) => {
                                let existing: Record<string, number> = {};
                                try {
                                  existing = JSON.parse(cond.conditionValue);
                                } catch {}
                                updateCondition(
                                  i,
                                  "conditionValue",
                                  JSON.stringify({
                                    ...existing,
                                    startHour: parseInt(e.target.value) || 0,
                                  })
                                );
                              }}
                              placeholder="Start hour (0-23)"
                              className="w-full rounded-md border border-zinc-700 bg-zinc-800 p-2 text-xs text-white placeholder-zinc-500"
                            />
                            <input
                              type="number"
                              min="0"
                              max="23"
                              value={
                                (() => {
                                  try {
                                    return (
                                      JSON.parse(cond.conditionValue)
                                        .endHour ?? ""
                                    );
                                  } catch {
                                    return "";
                                  }
                                })()
                              }
                              onChange={(e) => {
                                let existing: Record<string, number> = {};
                                try {
                                  existing = JSON.parse(cond.conditionValue);
                                } catch {}
                                updateCondition(
                                  i,
                                  "conditionValue",
                                  JSON.stringify({
                                    ...existing,
                                    endHour: parseInt(e.target.value) || 0,
                                  })
                                );
                              }}
                              placeholder="End hour (0-23)"
                              className="w-full rounded-md border border-zinc-700 bg-zinc-800 p-2 text-xs text-white placeholder-zinc-500"
                            />
                          </div>
                        )}
                        {cond.conditionType === "FIRST_PURCHASE" && (
                          <p className="p-2 text-xs text-zinc-500">
                            User must have no prior coupon usage
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => removeCondition(i)}
                        className="mt-1 text-zinc-600 hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-lg border border-zinc-800 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isStackable}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        isStackable: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-sm text-white">Stackable</p>
                    <p className="text-xs text-zinc-500">
                      Can be combined with other coupons
                    </p>
                  </div>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-800 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isPublic}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        isPublic: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-sm text-white">Public</p>
                    <p className="text-xs text-zinc-500">
                      Visible on customer coupon page
                    </p>
                  </div>
                </label>
              </div>

              {form.isStackable && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Stack Group{" "}
                    <span className="text-zinc-600">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.stackGroup}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, stackGroup: e.target.value }))
                    }
                    placeholder="e.g. summer-promo"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
                  />
                </div>
              )}

              {/* Validity */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Valid From
                  </label>
                  <input
                    type="date"
                    value={form.validFrom}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, validFrom: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Valid Until
                  </label>
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, validUntil: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-zinc-800">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.code || !form.value}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
                ) : null}
                {editingId ? "Update Coupon" : "Create Coupon"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
