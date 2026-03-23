import { FAQ_ENTRIES, type FAQEntry } from "./faq-data";

interface ScoredEntry {
  entry: FAQEntry;
  score: number;
}

export function searchFAQ(query: string, maxResults: number = 5): FAQEntry[] {
  if (!query.trim()) return [];

  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (tokens.length === 0) return [];

  const scored: ScoredEntry[] = FAQ_ENTRIES.map((entry) => {
    let score = 0;
    const questionLower = entry.question.toLowerCase();
    const answerLower = entry.answer.toLowerCase();

    for (const token of tokens) {
      // Exact keyword match (highest weight)
      if (entry.keywords.some((k) => k === token)) {
        score += 4;
      }
      // Partial keyword match
      else if (entry.keywords.some((k) => k.includes(token) || token.includes(k))) {
        score += 2;
      }

      // Question text match
      if (questionLower.includes(token)) {
        score += 3;
      }

      // Answer text match
      if (answerLower.includes(token)) {
        score += 1;
      }
    }

    // Bonus for matching multiple tokens
    const matchedTokens = tokens.filter(
      (t) =>
        entry.keywords.some((k) => k.includes(t) || t.includes(k)) ||
        questionLower.includes(t)
    );
    if (matchedTokens.length > 1) {
      score += matchedTokens.length * 2;
    }

    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.entry);
}

export function getFAQByCategory(category: string): FAQEntry[] {
  return FAQ_ENTRIES.filter((e) => e.category === category);
}

export function getFallbackResponse(): string {
  return "I couldn't find an answer to that. For specific queries, please contact us on WhatsApp at +91 6396 177 261 or call us directly. You can also browse our FAQ categories above.";
}
