"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useCafeCart } from "@/lib/cafe-cart-context";
import { formatPrice } from "@/lib/pricing";
import { CafeCartDrawer } from "./cafe-cart-drawer";
import { Search, X, Coffee, UtensilsCrossed, IceCreamCone, Package, Sandwich } from "lucide-react";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  image: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  tags: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  SNACKS: "Snacks",
  BEVERAGES: "Beverages",
  MEALS: "Meals",
  DESSERTS: "Desserts",
  COMBOS: "Combos",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  SNACKS: <Sandwich className="w-4 h-4" />,
  BEVERAGES: <Coffee className="w-4 h-4" />,
  MEALS: <UtensilsCrossed className="w-4 h-4" />,
  DESSERTS: <IceCreamCone className="w-4 h-4" />,
  COMBOS: <Package className="w-4 h-4" />,
};

const CATEGORY_EMOJIS: Record<string, string> = {
  SNACKS: "🍿",
  BEVERAGES: "☕",
  MEALS: "🍛",
  DESSERTS: "🍰",
  COMBOS: "🍱",
};

const CATEGORY_ORDER = ["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"];

export function CafeMenuPage({
  groupedItems,
}: {
  groupedItems: Record<string, MenuItem[]>;
}) {
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [cartOpen, setCartOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabsRef = useRef<HTMLDivElement>(null);
  const { items: cartItems, addItem, updateQuantity, totalItems, totalAmount } = useCafeCart();

  const categories = CATEGORY_ORDER.filter((c) => groupedItems[c]?.length > 0);

  const allItems = useMemo(
    () => Object.values(groupedItems).flat(),
    [groupedItems]
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase().trim();
    const tokens = query.split(/\s+/);

    return allItems
      .map((item) => {
        const searchFields = [
          item.name.toLowerCase(),
          (item.description || "").toLowerCase(),
          item.tags.join(" ").toLowerCase(),
          (CATEGORY_LABELS[item.category] || item.category).toLowerCase(),
          item.isVeg ? "veg vegetarian" : "non-veg nonveg",
        ].join(" ");

        let score = 0;
        let allTokensMatch = true;
        for (const token of tokens) {
          if (searchFields.includes(token)) {
            score += 10;
          } else {
            let fi = 0;
            let matched = 0;
            for (const ch of token) {
              const idx = searchFields.indexOf(ch, fi);
              if (idx >= 0) { fi = idx + 1; matched++; }
            }
            if (matched >= token.length * 0.7 && token.length >= 2) {
              score += 3;
            } else {
              allTokensMatch = false;
            }
          }
        }
        return { item, score, allTokensMatch };
      })
      .filter((r) => r.score > 0 && r.allTokensMatch)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.item);
  }, [searchQuery, allItems]);

  const isSearching = searchQuery.trim().length > 0;

  const searchGrouped = useMemo(() => {
    if (!searchResults) return {};
    const grouped: Record<string, MenuItem[]> = {};
    for (const item of searchResults) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    return grouped;
  }, [searchResults]);

  const displayGrouped = isSearching ? searchGrouped : groupedItems;
  const displayCategories = isSearching
    ? CATEGORY_ORDER.filter((c) => searchGrouped[c]?.length > 0)
    : categories;

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.getAttribute("data-category") || "");
          }
        }
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0 }
    );

    for (const cat of categories) {
      const el = sectionRefs.current[cat];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [categories]);

  function scrollToCategory(cat: string) {
    setActiveCategory(cat);
    const el = sectionRefs.current[cat];
    if (el) {
      const offset = 140;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  }

  function getCartQuantity(itemId: string): number {
    return cartItems.find((i) => i.itemId === itemId)?.quantity || 0;
  }

  return (
    <div className="min-h-screen bg-black pb-28">
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-amber-900/40 via-black to-black border-b border-amber-800/20">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 left-10 text-6xl">☕</div>
          <div className="absolute top-8 right-20 text-5xl">🍛</div>
          <div className="absolute bottom-4 left-1/3 text-4xl">🍿</div>
          <div className="absolute bottom-2 right-10 text-5xl">🍰</div>
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <a href="/"><img src="/blackLogo.png" alt="Momentum Arena" className="h-[120px] w-auto" /></a>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white">Momentum Cafe ☕</h1>
              <p className="text-amber-200/60 text-sm sm:text-base max-w-lg">
                Fuel your game! Snacks, beverages & meals — served fresh at the arena.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Search bar */}
        <div className="mt-6 mb-2 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search food, beverages, snacks..."
            className="w-full pl-11 pr-10 py-3 rounded-xl bg-zinc-900/80 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-amber-600/50 focus:ring-1 focus:ring-amber-600/20 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search results info */}
        {isSearching && (
          <div className="mb-3 text-sm text-zinc-400 px-1">
            {searchResults && searchResults.length > 0 ? (
              <span>{searchResults.length} item{searchResults.length !== 1 ? "s" : ""} found for &ldquo;{searchQuery}&rdquo;</span>
            ) : (
              <span className="text-red-400">No items found for &ldquo;{searchQuery}&rdquo;</span>
            )}
          </div>
        )}

        {/* Category tabs — sticky */}
        <div
          ref={tabsRef}
          className="sticky top-[64px] z-30 bg-black/95 backdrop-blur-md border-b border-zinc-800/50 -mx-4 px-4 sm:-mx-6 sm:px-6"
        >
          <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide max-w-5xl mx-auto">
            {displayCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => scrollToCategory(cat)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  activeCategory === cat
                    ? "bg-amber-600 text-white shadow-lg shadow-amber-900/20"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white border border-zinc-800"
                }`}
              >
                {CATEGORY_ICONS[cat]}
                {CATEGORY_LABELS[cat] || cat}
                {isSearching && searchGrouped[cat] && (
                  <span className="ml-0.5 text-xs opacity-70">({searchGrouped[cat].length})</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Menu sections */}
        <div className="mt-6 space-y-10">
          {displayCategories.map((cat) => (
            <div
              key={cat}
              ref={(el) => {
                sectionRefs.current[cat] = el;
              }}
              data-category={cat}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">{CATEGORY_EMOJIS[cat] || "🍽️"}</span>
                <h2 className="text-xl font-bold text-white">
                  {CATEGORY_LABELS[cat] || cat}
                </h2>
                <span className="text-xs text-zinc-500 ml-1">
                  ({(displayGrouped[cat] || []).length} items)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(displayGrouped[cat] || []).map((item) => {
                  const qty = getCartQuantity(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`group relative bg-zinc-900/70 border rounded-xl overflow-hidden transition-all ${
                        item.isAvailable
                          ? "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900"
                          : "border-zinc-800/40 opacity-50"
                      }`}
                    >
                      {/* Image */}
                      {item.image ? (
                        <div className="h-36 bg-zinc-800 overflow-hidden">
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      ) : (
                        <div className="h-28 bg-gradient-to-br from-zinc-800/80 to-zinc-900 flex items-center justify-center">
                          <span className="text-4xl opacity-40">
                            {CATEGORY_EMOJIS[item.category] || "🍽️"}
                          </span>
                        </div>
                      )}

                      {/* Tags */}
                      {item.tags.length > 0 && (
                        <div className="absolute top-2 right-2 flex gap-1">
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="bg-amber-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Veg/Non-veg badge */}
                      <div className="absolute top-2 left-2">
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 border-2 rounded-sm ${
                            item.isVeg
                              ? "border-green-500 bg-black/60"
                              : "border-red-500 bg-black/60"
                          }`}
                        >
                          <span
                            className={`block w-2 h-2 rounded-full ${
                              item.isVeg ? "bg-green-500" : "bg-red-500"
                            }`}
                          />
                        </span>
                      </div>

                      {/* Content */}
                      <div className="p-3.5">
                        <h3 className="font-semibold text-white text-sm leading-tight">
                          {item.name}
                        </h3>
                        {item.description && (
                          <p className="text-zinc-500 text-xs mt-1 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        )}

                        <div className="flex items-center justify-between mt-3">
                          <span className="text-amber-400 font-bold text-sm">
                            {formatPrice(item.price)}
                          </span>

                          {!item.isAvailable ? (
                            <span className="text-[11px] text-zinc-600 italic bg-zinc-800 px-2 py-1 rounded">
                              Unavailable
                            </span>
                          ) : qty === 0 ? (
                            <button
                              onClick={() =>
                                addItem({
                                  itemId: item.id,
                                  name: item.name,
                                  price: item.price,
                                  image: item.image || undefined,
                                  isVeg: item.isVeg,
                                  category: item.category,
                                })
                              }
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-1.5 rounded-lg transition-colors uppercase tracking-wide"
                            >
                              Add
                            </button>
                          ) : (
                            <div className="flex items-center bg-amber-600 rounded-lg overflow-hidden">
                              <button
                                onClick={() => updateQuantity(item.id, qty - 1)}
                                className="text-white font-bold px-2.5 py-1.5 hover:bg-amber-700 transition-colors text-sm"
                              >
                                −
                              </button>
                              <span className="text-white font-bold text-xs min-w-[24px] text-center">
                                {qty}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.id, qty + 1)}
                                className="text-white font-bold px-2.5 py-1.5 hover:bg-amber-700 transition-colors text-sm"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {categories.length === 0 && (
          <div className="text-center py-20">
            <span className="text-6xl block mb-4">🍽️</span>
            <p className="text-zinc-400 text-lg font-medium">Menu coming soon!</p>
            <p className="text-zinc-600 text-sm mt-1">Our chef is preparing something special.</p>
          </div>
        )}
      </div>

      {/* Floating cart bar */}
      {totalItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-black/95 backdrop-blur-md border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <button
              onClick={() => setCartOpen(true)}
              className="w-full flex items-center justify-between bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-5 py-3.5 my-3 transition-all hover:shadow-lg hover:shadow-amber-900/20"
            >
              <div className="flex items-center gap-3">
                <div className="bg-amber-700/50 rounded-lg p-1.5">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                </div>
                <span className="font-bold text-sm">
                  {totalItems} item{totalItems > 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold">{formatPrice(totalAmount)}</span>
                <span className="text-amber-200 text-sm">View Cart →</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Cart drawer */}
      <CafeCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}
