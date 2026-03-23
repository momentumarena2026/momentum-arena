"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePricingRule } from "@/actions/admin-pricing";
import { formatPrice } from "@/lib/pricing";
import { DayType, TimeType } from "@prisma/client";
import { Loader2, Check, Pencil } from "lucide-react";

interface PricingEditorProps {
  configId: string;
  configLabel: string;
  prices: Record<string, number>;
}

const PRICE_KEYS: { key: string; dayType: DayType; timeType: TimeType }[] = [
  { key: "WEEKDAY_OFF_PEAK", dayType: "WEEKDAY", timeType: "OFF_PEAK" },
  { key: "WEEKDAY_PEAK", dayType: "WEEKDAY", timeType: "PEAK" },
  { key: "WEEKEND_OFF_PEAK", dayType: "WEEKEND", timeType: "OFF_PEAK" },
  { key: "WEEKEND_PEAK", dayType: "WEEKEND", timeType: "PEAK" },
];

export function PricingEditor({ configId, configLabel, prices }: PricingEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async (dayType: DayType, timeType: TimeType) => {
    const priceInRupees = parseFloat(editValue);
    if (isNaN(priceInRupees) || priceInRupees < 0) return;

    setSaving(true);
    await updatePricingRule({
      courtConfigId: configId,
      dayType,
      timeType,
      pricePerSlot: Math.round(priceInRupees * 100),
    });
    setEditing(null);
    setSaving(false);
    router.refresh();
  };

  return (
    <tr className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
      <td className="py-3 pr-4 text-white">{configLabel}</td>
      {PRICE_KEYS.map(({ key, dayType, timeType }) => {
        const currentPrice = prices[key] || 0;
        const isEditing = editing === `${configId}_${key}`;

        return (
          <td key={key} className="py-3 px-4 text-right">
            {isEditing ? (
              <div className="flex items-center justify-end gap-1">
                <span className="text-zinc-500">₹</span>
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave(dayType, timeType);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-right text-sm text-white focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={() => handleSave(dayType, timeType)}
                  disabled={saving}
                  className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setEditing(`${configId}_${key}`);
                  setEditValue((currentPrice / 100).toString());
                }}
                className="group inline-flex items-center gap-1 text-zinc-300 hover:text-white"
              >
                {formatPrice(currentPrice)}
                <Pencil className="h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </td>
        );
      })}
    </tr>
  );
}
