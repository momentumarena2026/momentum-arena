import { FESTIVE_THEMES, type FestiveThemeId } from "@/lib/festive-themes";

/**
 * The seasonal skin, as a fixed layer BEHIND everything.
 *
 * ── WHY IT IS A BACKDROP AND NOT A THEME SWAP ─────────────────────────
 * The obvious implementation redefines the CSS variables in
 * `app/globals.css` for the duration of a festival. That is a trap here:
 * `--background` and `--foreground` are what every contrast decision in
 * this product was made against, and bending them for a fortnight means
 * every page's readability becomes a festival-shaped unknown. The
 * research on seasonal design says the same thing in product terms — a
 * festive theme is a temporary LAYER, not a redesign.
 *
 * So the canvas stays black, the text stays white, and this adds glows
 * and a motif underneath. The worst a bad palette can do here is look
 * wrong; it cannot make the site unreadable.
 *
 * `pointer-events-none` throughout: a decoration must never eat a tap,
 * and this spans the viewport.
 *
 * `aria-hidden`, and the motif is drawn with CSS rather than text, so a
 * screen reader is not told about eighteen diyas. The greeting that DOES
 * belong in the accessibility tree goes in the announcement strip, which
 * is real content an admin writes.
 *
 * Honours `prefers-reduced-motion`: the drift and twinkle stop, the
 * colour stays. Somebody who turned animation off still gets the
 * festival, just still.
 */
export function FestiveBackdrop({ theme }: { theme: FestiveThemeId | null }) {
  if (!theme) return null;
  const t = FESTIVE_THEMES[theme];

  return (
    <div
      aria-hidden="true"
      data-festive={t.id}
      className="festive-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={
        {
          "--festive-accent": t.accent,
          "--festive-accent-soft": t.accentSoft,
        } as React.CSSProperties
      }
    >
      {/* Two corner glows. Kept at the edges and well under half
          opacity so the middle of the page — where the text is — stays
          on the flat black it was designed for. */}
      <div className="festive-glow festive-glow-a" />
      <div className="festive-glow festive-glow-b" />
      {/* The motif. One element per particle; the count is small on
          purpose (18), because this renders on every page including
          long admin tables on mid-range Android. */}
      <div className={`festive-motif festive-motif-${t.motif}`}>
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className="festive-particle" data-i={i} />
        ))}
      </div>
    </div>
  );
}
