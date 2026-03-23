"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { blockSlot, unblockSlot } from "@/actions/admin-slots";
import { formatHour, getAllSlotHours, SPORT_INFO } from "@/lib/court-config";
import { Plus, Trash2, Loader2, CalendarOff, X } from "lucide-react";
import { Sport } from "@prisma/client";

interface Config {
  id: string;
  sport: string;
  label: string;
  size: string;
}

interface Block {
  id: string;
  date: string;
  startHour: number | null;
  reason: string | null;
  sport: string | null;
  configLabel: string;
}

interface SlotBlockManagerProps {
  configs: Config[];
  existingBlocks: Block[];
}

export function SlotBlockManager({ configs, existingBlocks }: SlotBlockManagerProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [blockType, setBlockType] = useState<"config" | "sport">("config");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [selectedSport, setSelectedSport] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [blockFullDay, setBlockFullDay] = useState(true);
  const [selectedHour, setSelectedHour] = useState(5);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleBlock = async () => {
    setSaving(true);
    await blockSlot({
      courtConfigId: blockType === "config" ? selectedConfigId || undefined : undefined,
      sport: blockType === "sport" ? (selectedSport as Sport) || undefined : undefined,
      date,
      startHour: blockFullDay ? undefined : selectedHour,
      reason: reason || undefined,
    });
    setSaving(false);
    setShowForm(false);
    setReason("");
    router.refresh();
  };

  const handleUnblock = async (blockId: string) => {
    setDeleting(blockId);
    await unblockSlot(blockId);
    setDeleting(null);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Add Block Button */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-red-600/10 border border-red-500/30 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-600/20 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Block Slot
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">New Slot Block</h3>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          </div>

          {/* Block Type */}
          <div className="flex gap-2">
            <button
              onClick={() => setBlockType("config")}
              className={`rounded-lg px-3 py-1.5 text-xs ${
                blockType === "config"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700"
              }`}
            >
              Specific Court
            </button>
            <button
              onClick={() => setBlockType("sport")}
              className={`rounded-lg px-3 py-1.5 text-xs ${
                blockType === "sport"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700"
              }`}
            >
              Entire Sport
            </button>
          </div>

          {blockType === "config" ? (
            <select
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              <option value="">Select court configuration</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {SPORT_INFO[c.sport as keyof typeof SPORT_INFO]?.name} — {c.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={selectedSport}
              onChange={(e) => setSelectedSport(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              <option value="">Select sport</option>
              {Object.entries(SPORT_INFO).map(([key, info]) => (
                <option key={key} value={key}>
                  {info.name}
                </option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
          />

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={blockFullDay}
                onChange={(e) => setBlockFullDay(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Block full day
            </label>
          </div>

          {!blockFullDay && (
            <select
              value={selectedHour}
              onChange={(e) => setSelectedHour(parseInt(e.target.value))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              {getAllSlotHours().map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
          />

          <button
            onClick={handleBlock}
            disabled={saving}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              "Block Slot"
            )}
          </button>
        </div>
      )}

      {/* Existing Blocks */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
          Active Blocks
        </h2>
        {existingBlocks.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <CalendarOff className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">No active blocks</p>
          </div>
        ) : (
          <div className="space-y-2">
            {existingBlocks.map((block) => (
              <div
                key={block.id}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">
                    {block.configLabel}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {new Date(block.date).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {block.startHour !== null
                      ? ` • ${formatHour(block.startHour)}`
                      : " • Full day"}
                    {block.reason ? ` • ${block.reason}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleUnblock(block.id)}
                  disabled={deleting === block.id}
                  className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                >
                  {deleting === block.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
