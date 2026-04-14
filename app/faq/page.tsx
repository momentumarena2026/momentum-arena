import { FAQ_ENTRIES, FAQ_CATEGORIES } from "@/lib/faq-data";
import { FAQPageClient } from "./faq-client";
import { getPublicFAQs } from "@/actions/admin-faqs";
import { HelpCircle } from "lucide-react";
import { BackButton } from "@/components/back-button";

export default async function FAQPage() {
  // Try to load DB FAQs first; fall back to static data
  let faqs: { question: string; answer: string; category: string; keywords: string[] }[];

  try {
    const dbFaqs = await getPublicFAQs();
    faqs =
      dbFaqs.length > 0
        ? dbFaqs.map((f) => ({
            question: f.question,
            answer: f.answer,
            category: f.category,
            keywords: f.keywords,
          }))
        : FAQ_ENTRIES.map((f) => ({
            question: f.question,
            answer: f.answer,
            category: f.category,
            keywords: f.keywords,
          }));
  } catch {
    faqs = FAQ_ENTRIES.map((f) => ({
      question: f.question,
      answer: f.answer,
      category: f.category,
      keywords: f.keywords,
    }));
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <BackButton className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" label="Back" />

        <div className="flex items-center gap-3 mb-8">
          <div className="rounded-xl bg-emerald-500/10 p-3">
            <HelpCircle className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              Frequently Asked Questions
            </h1>
            <p className="text-zinc-400">
              Find answers about Momentum Arena
            </p>
          </div>
        </div>

        <FAQPageClient faqs={faqs} />
      </div>
    </div>
  );
}
