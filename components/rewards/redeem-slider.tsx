"use client";

import { useState, useCallback } from "react";
import { Star } from "lucide-react";

interface RedeemSliderProps {
  currentBalance: number;
  orderAmountPaise: number;
  config: {
    pointsPerRupee: number;
    minRedeemPoints: number;
    maxRedeemPercent: number; // basis points
  };
  onRedeemChange: (points: number, paiseSaved: number) => void;
}

export function RedeemSlider({
  currentBalance,
  orderAmountPaise,
  config,
  onRedeemChange,
}: RedeemSliderProps) {
  // Calculate max redeemable points
  const maxDiscountPaise = Math.floor(
    (orderAmountPaise * config.maxRedeemPercent) / 10000
  );
  const maxPointsByOrder = Math.floor(
    (maxDiscountPaise / 100) * config.pointsPerRupee
  );
  const maxRedeemable = Math.min(maxPointsByOrder, currentBalance);
  const isDisabled =
    currentBalance < config.minRedeemPoints || maxRedeemable < config.minRedeemPoints;

  const [points, setPoints] = useState(0);

  const handleChange = useCallback(
    (value: number) => {
      setPoints(value);
      const paiseSaved = Math.floor(value / config.pointsPerRupee) * 100;
      onRedeemChange(value, paiseSaved);
    },
    [config.pointsPerRupee, onRedeemChange]
  );

  const paiseSaved = Math.floor(points / config.pointsPerRupee) * 100;

  if (currentBalance <= 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-white">
            Use Reward Points
          </span>
        </div>
        <span className="text-xs text-zinc-400">
          Balance: {currentBalance.toLocaleString()} pts
        </span>
      </div>

      {isDisabled ? (
        <p className="text-xs text-zinc-500">
          Minimum {config.minRedeemPoints} points required to redeem
        </p>
      ) : (
        <>
          <input
            type="range"
            min={0}
            max={maxRedeemable}
            step={1}
            value={points}
            onChange={(e) => handleChange(parseInt(e.target.value))}
            className="w-full accent-amber-500"
            style={{
              background: `linear-gradient(to right, #f59e0b ${
                (points / maxRedeemable) * 100
              }%, #27272a ${(points / maxRedeemable) * 100}%)`,
            }}
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-zinc-400">0 pts</span>
            <span className="text-xs text-zinc-400">
              {maxRedeemable.toLocaleString()} pts
            </span>
          </div>

          {points > 0 && (
            <div className="mt-3 rounded-lg bg-amber-950/40 border border-amber-800/30 px-3 py-2 text-center">
              <span className="text-sm text-amber-300">
                Use <strong>{points.toLocaleString()}</strong> points to save{" "}
                <strong>
                  ₹{(paiseSaved / 100).toLocaleString("en-IN")}
                </strong>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
