"use client";

import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  className?: string;
  label?: string;
}

export function BackButton({ className, label = "Back" }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      className={className || "inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}
