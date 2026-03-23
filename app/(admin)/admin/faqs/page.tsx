import { getAllFAQs } from "@/actions/admin-faqs";
import { FAQManager } from "./faq-manager";

export default async function AdminFAQsPage() {
  const faqs = await getAllFAQs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">FAQ Management</h1>
        <p className="mt-1 text-zinc-400">
          Add, edit, and manage FAQ entries for the chatbot
        </p>
      </div>

      <FAQManager
        faqs={faqs.map((f) => ({
          id: f.id,
          question: f.question,
          answer: f.answer,
          keywords: f.keywords,
          category: f.category,
          sortOrder: f.sortOrder,
          isActive: f.isActive,
        }))}
      />
    </div>
  );
}
