import sanitizeHtml from "sanitize-html";
import { RICH_TEXT_TAGS, isEmptyRichText } from "./rich-text";

/**
 * Scrub admin-authored rich text down to the allowed vocabulary.
 *
 * Run on SAVE, not on render, for two reasons. The public tournament
 * page is a server component and could sanitize on the way out, but the
 * MOBILE app receives the same string through the public API and has no
 * sanitiser at all — cleaning at the boundary where it enters the
 * database is the only point that covers every reader.
 *
 * And it is needed even though only a MANAGE_TOURNAMENTS admin can get
 * here: these are server-action arguments, which come from the client.
 * A compromised admin session posting a <script> into `rules` would be
 * stored XSS on a public page, so the editor's own constrained output is
 * not something the server may assume.
 */
export function sanitizeRichText(input: string | null | undefined): string | null {
  if (isEmptyRichText(input)) return null;

  const clean = sanitizeHtml(input!, {
    allowedTags: [...RICH_TEXT_TAGS],
    allowedAttributes: {
      // href only, and only on links. No target/rel from the author —
      // the renderers decide those, so a link can't opt itself out of
      // whatever the page sets.
      a: ["href"],
    },
    // No javascript:/data: URLs. `mailto` and `tel` are here because a
    // rules block plausibly lists a contact.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href"],
    // Anything outside the list loses its tag but keeps its words: a
    // pasted <div>Rule 4</div> becomes "Rule 4" rather than vanishing,
    // which is what an admin would expect after pasting from a doc.
    disallowedTagsMode: "discard",
    // Strip the enclosing tag of these entirely, contents included —
    // there is no reading of a <script> body that belongs in a rule.
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  }).trim();

  // A paste of pure markup ("<div><span></span></div>") survives the
  // scrub as empty tags; treat that as no rules at all rather than
  // storing something that renders an empty card.
  return isEmptyRichText(clean) ? null : clean;
}
