/**
 * The small HTML vocabulary admin-authored rich text is allowed to use.
 *
 * Deliberately tiny, and the reason matters: this same list is what the
 * MOBILE renderer understands (apps/mobile/src/components/ui/RichText.tsx).
 * The app has no HTML engine and adding one would mean a native-ish
 * dependency for one field, so instead the editor is constrained to tags
 * a ~100-line renderer can draw. Widen this list and the app silently
 * drops whatever it doesn't know — so widen BOTH or neither.
 *
 * Pure module: no `sanitize-html` import, so client components can read
 * the list without pulling a Node-only parser into the browser bundle.
 * The actual scrubbing lives in lib/rich-text.server.ts.
 */

export const RICH_TEXT_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "h3",
  "h4",
  "blockquote",
  "code",
  "a",
] as const;

/**
 * Does this value look like it came from the rich-text editor?
 *
 * Rules used to be a plain textarea whose "(markdown)" label was a
 * promise nothing kept — both renderers printed it verbatim. Those rows
 * are still in the database as newline-separated text with "- " bullets,
 * and feeding them through an HTML renderer would collapse every line
 * break into one grey blob. So the renderers ask this first and fall
 * back to the old pre-wrap treatment when the answer is no.
 *
 * The test is intentionally narrow — an opening tag from our own
 * vocabulary. A rule that happens to read "score < 5 and > 2" stays
 * plain text, which is the safe way to be wrong.
 */
export function looksLikeRichText(value: string | null | undefined): boolean {
  if (!value) return false;
  return new RegExp(`<(${RICH_TEXT_TAGS.join("|")})(\\s|>|/>)`, "i").test(value);
}

/**
 * True when the editor's HTML carries no actual words — TipTap emits
 * "<p></p>" for an empty document, which would otherwise be stored as a
 * non-null `rules` and make the public page render an empty Rules card.
 */
export function isEmptyRichText(value: string | null | undefined): boolean {
  if (!value) return true;
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim().length === 0;
}
