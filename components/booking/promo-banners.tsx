"use client";

import { Sparkles, Tag } from "lucide-react";

interface Banner {
  id: string;
  title: string;
  description: string;
  discountInfo: string | null;
}

export function PromoBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {banners.map((banner) => (
        <div
          key={banner.id}
          className="min-w-[260px] rounded-xl border border-yellow-500/20 bg-gradient-to-r from-yellow-500/10 to-orange-500/5 p-4"
        >
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 text-yellow-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-yellow-300">
                {banner.title}
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">{banner.description}</p>
              {banner.discountInfo && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5">
                  <Tag className="h-3 w-3 text-yellow-400" />
                  <span className="text-xs font-medium text-yellow-300">
                    {banner.discountInfo}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
