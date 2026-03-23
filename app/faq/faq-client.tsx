"use client";

import { useState } from "react";
import { Search, ChevronDown, ChevronUp } from "lucide-react";
import { FAQ_CATEGORIES } from "@/lib/faq-data";

interface FAQ {
  question: string;
  answer: string;
  category: string;
  keywords: string[];
}

export function FAQPageClient({ faqs }: { faqs: FAQ[] }) {
  const [search, setSearch] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = faqs.filter((faq) => {
    const matchesSearch =
      !search ||
      faq.question.toLowerCase().includes(search.toLowerCase()) ||
      faq.answer.toLowerCase().includes(search.toLowerCase()) ||
      faq.keywords.some((k) => k.includes(search.toLowerCase()));
    const matchesCategory = !activeCategory || faq.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Group by category
  const grouped = filtered.reduce((acc, faq, index) => {
    if (!acc[faq.category]) acc[faq.category] = [];
    acc[faq.category].push({ ...faq, index });
    return acc;
  }, {} as Record<string, (FAQ & { index: number })[]>);

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search FAQs..."
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-3 pl-12 pr-4 text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Category Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            !activeCategory
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
          }`}
        >
          All
        </button>
        {FAQ_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              activeCategory === cat.id
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* FAQ Accordion */}
      {Object.entries(grouped).map(([category, categoryFaqs]) => {
        const catInfo = FAQ_CATEGORIES.find((c) => c.id === category);
        return (
          <div key={category}>
            <h2 className="mb-3 text-sm font-medium text-zinc-500 uppercase tracking-wider">
              {catInfo?.label || category}
            </h2>
            <div className="space-y-2">
              {categoryFaqs.map((faq) => {
                const isOpen = openIndex === faq.index;
                return (
                  <div
                    key={faq.index}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden"
                  >
                    <button
                      onClick={() => setOpenIndex(isOpen ? null : faq.index)}
                      className="flex w-full items-center justify-between p-4 text-left"
                    >
                      <span className="text-sm font-medium text-white pr-4">
                        {faq.question}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4 text-zinc-500 shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="border-t border-zinc-800 px-4 py-3">
                        <p className="text-sm text-zinc-400 whitespace-pre-line">
                          {faq.answer}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">No FAQs found matching your search.</p>
          <p className="mt-1 text-sm text-zinc-500">
            Contact us on WhatsApp: +91 6396 177 261
          </p>
        </div>
      )}
    </div>
  );
}
