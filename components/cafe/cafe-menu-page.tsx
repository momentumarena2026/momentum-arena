"use client";

import { useState, useRef, useEffect } from "react";
import { useCafeCart } from "@/lib/cafe-cart-context";
import { formatPrice } from "@/lib/pricing";
import { CafeCartDrawer } from "./cafe-cart-drawer";

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

const CATEGORY_ORDER = ["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"];

export function CafeMenuPage({
  groupedItems,
}: {
  groupedItems: Record<string, MenuItem[]>;
}) {
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [cartOpen, setCartOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabsRef = useRef<HTMLDivElement>(null);
  const { items: cartItems, addItem, updateQuantity, totalItems } = useCafeCart();

  const categories = CATEGORY_ORDER.filter((c) => groupedItems[c]?.length > 0);

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
      const offset = 120;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  }

  function getCartQuantity(itemId: string): number {
    return cartItems.find((i) => i.itemId === itemId)?.quantity || 0;
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Cafe Menu</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Order food and beverages at Momentum Arena
        </p>
      </div>

      {/* Category tabs */}
      <div
        ref={tabsRef}
        className="sticky top-16 z-30 bg-black/90 backdrop-blur-md border-b border-zinc-800 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <div className="flex gap-1 overflow-x-auto py-3 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => scrollToCategory(cat)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Menu sections */}
      <div className="mt-6 space-y-10">
        {categories.map((cat) => (
          <div
            key={cat}
            ref={(el) => {
              sectionRefs.current[cat] = el;
            }}
            data-category={cat}
          >
            <h2 className="text-xl font-bold text-white mb-4">
              {CATEGORY_LABELS[cat] || cat}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupedItems[cat].map((item) => {
                const qty = getCartQuantity(item.id);
                return (
                  <div
                    key={item.id}
                    className={`relative bg-zinc-900 border rounded-xl overflow-hidden transition-colors ${
                      item.isAvailable
                        ? "border-zinc-800 hover:border-zinc-700"
                        : "border-zinc-800/50 opacity-60"
                    }`}
                  >
                    {/* Image or placeholder */}
                    {item.image ? (
                      <div className="h-40 bg-zinc-800 overflow-hidden">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="h-32 bg-zinc-800/50 flex items-center justify-center text-4xl">
                        {item.category === "BEVERAGES"
                          ? "☕"
                          : item.category === "DESSERTS"
                            ? "🍰"
                            : item.category === "COMBOS"
                              ? "🍱"
                              : "🍽️"}
                      </div>
                    )}

                    {/* Tags */}
                    {item.tags.length > 0 && (
                      <div className="absolute top-2 right-2 flex gap-1">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className="bg-emerald-600/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Content */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block w-3.5 h-3.5 border-2 rounded-sm flex-shrink-0 ${
                                item.isVeg
                                  ? "border-green-500"
                                  : "border-red-500"
                              } flex items-center justify-center`}
                            >
                              <span
                                className={`block w-1.5 h-1.5 rounded-full ${
                                  item.isVeg ? "bg-green-500" : "bg-red-500"
                                }`}
                              />
                            </span>
                            <h3 className="font-semibold text-white text-sm truncate">
                              {item.name}
                            </h3>
                          </div>
                          {item.description && (
                            <p className="text-zinc-500 text-xs mt-1 line-clamp-2">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <span className="text-white font-bold text-sm">
                          {formatPrice(item.price)}
                        </span>

                        {!item.isAvailable ? (
                          <span className="text-xs text-zinc-500 italic">
                            Currently Unavailable
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
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-1.5 rounded-lg transition-colors"
                          >
                            ADD
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 bg-emerald-600 rounded-lg">
                            <button
                              onClick={() =>
                                updateQuantity(item.id, qty - 1)
                              }
                              className="text-white font-bold px-3 py-1.5 hover:bg-emerald-700 rounded-l-lg transition-colors"
                            >
                              -
                            </button>
                            <span className="text-white font-bold text-sm min-w-[20px] text-center">
                              {qty}
                            </span>
                            <button
                              onClick={() =>
                                updateQuantity(item.id, qty + 1)
                              }
                              className="text-white font-bold px-3 py-1.5 hover:bg-emerald-700 rounded-r-lg transition-colors"
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
          <p className="text-zinc-500 text-lg">No menu items available yet.</p>
          <p className="text-zinc-600 text-sm mt-1">Check back soon!</p>
        </div>
      )}

      {/* Floating cart button */}
      {totalItems > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/30 rounded-full px-6 py-3 flex items-center gap-3 transition-all hover:scale-105"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
            />
          </svg>
          <span className="font-bold">{totalItems} item{totalItems > 1 ? "s" : ""}</span>
          <span className="text-emerald-200">|</span>
          <span className="font-bold">View Cart</span>
        </button>
      )}

      {/* Cart drawer */}
      <CafeCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}
