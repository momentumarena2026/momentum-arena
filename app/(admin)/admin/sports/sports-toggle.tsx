"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleSportActive, toggleConfigActive } from "@/actions/admin-slots";
import { Sport } from "@prisma/client";
import { Loader2, Maximize2 } from "lucide-react";

interface Config {
  id: string;
  label: string;
  size: string;
  sizeName: string;
  isActive: boolean;
  widthFt: number;
  lengthFt: number;
}

interface SportsToggleProps {
  sport: string;
  sportName: string;
  configs: Config[];
  allActive: boolean;
}

export function SportsToggle({
  sport,
  sportName,
  configs,
  allActive,
}: SportsToggleProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleToggleSport = async () => {
    setLoading("sport");
    await toggleSportActive(sport as Sport, !allActive);
    setLoading(null);
    router.refresh();
  };

  const handleToggleConfig = async (configId: string, currentActive: boolean) => {
    setLoading(configId);
    await toggleConfigActive(configId, !currentActive);
    setLoading(null);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {/* Sport Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{sportName}</h2>
        <button
          onClick={handleToggleSport}
          disabled={loading !== null}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            allActive ? "bg-emerald-600" : "bg-zinc-700"
          }`}
        >
          {loading === "sport" ? (
            <Loader2 className="absolute left-1/2 -translate-x-1/2 h-3 w-3 animate-spin text-white" />
          ) : (
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                allActive ? "translate-x-6" : "translate-x-1"
              }`}
            />
          )}
        </button>
      </div>

      {/* Config List */}
      <div className="space-y-2">
        {configs.map((config) => (
          <div
            key={config.id}
            className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
              config.isActive
                ? "border-zinc-800 bg-zinc-950"
                : "border-zinc-800/50 bg-zinc-950/50 opacity-60"
            }`}
          >
            <div>
              <p className="text-sm font-medium text-white">
                {config.sizeName}
              </p>
              <p className="flex items-center gap-1 text-xs text-zinc-500">
                <Maximize2 className="h-3 w-3" />
                {config.label} — {config.widthFt}x{config.lengthFt}ft
              </p>
            </div>
            <button
              onClick={() => handleToggleConfig(config.id, config.isActive)}
              disabled={loading !== null}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                config.isActive ? "bg-emerald-600" : "bg-zinc-700"
              }`}
            >
              {loading === config.id ? (
                <Loader2 className="absolute left-1/2 -translate-x-1/2 h-2.5 w-2.5 animate-spin text-white" />
              ) : (
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                    config.isActive ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
