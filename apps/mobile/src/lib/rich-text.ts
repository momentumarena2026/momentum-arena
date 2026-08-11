/**
 * Parsing half of the app's rich-text renderer, kept free of React
 * Native imports so it can be exercised in plain Node.
 *
 * That is the whole reason for the split: the drawing is a handful of
 * <Text> elements and reads fine, but the parsing has to survive
 * malformed markup — unclosed tags, a stray </strong>, a paste that
 * never balances — and getting that wrong blanks the Rules card on a
 * screen nobody can reach without a simulator. Pure functions can be
 * tested; a component that imports react-native cannot.
 *
 * The vocabulary mirrors lib/rich-text.ts on the server. Widen one and
 * you must widen the other, or the app quietly drops what it doesn't
 * know.
 */

const BLOCK = new Set(["p", "h3", "h4", "ul", "ol", "li", "blockquote"]);

/**
 * Mirror of looksLikeRichText in lib/rich-text.ts on the server — the
 * mobile package can't import across the workspace. Rules written before
 * the editor existed are plain text with real newlines; drawing those
 * through this renderer would swallow every line break, so callers ask
 * this first and fall back to a plain <Text>.
 */
export function looksLikeRichText(value: string | null | undefined): boolean {
  if (!value) return false;
  return /<(p|br|strong|em|u|s|ul|ol|li|h3|h4|blockquote|code|a)(\s|>|\/>)/i.test(
    value,
  );
}

export type Token =
  | { kind: "text"; text: string }
  | { kind: "open"; tag: string; attrs: string }
  | { kind: "close"; tag: string };

export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\/?\s*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ kind: "text", text: html.slice(last, m.index) });
    const tag = m[2].toLowerCase();
    if (m[1]) out.push({ kind: "close", tag });
    else out.push({ kind: "open", tag, attrs: m[3] ?? "" });
    last = re.lastIndex;
  }
  if (last < html.length) out.push({ kind: "text", text: html.slice(last) });
  return out;
}

/** Named entities the editor actually emits, plus numeric escapes. */
function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function hrefOf(attrs: string): string | null {
  const m = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
  const raw = m?.[2] ?? m?.[3];
  if (!raw) return null;
  const url = decode(raw).trim();
  // Belt and braces: the server already restricts schemes, but this
  // component must never hand Linking something it can't vouch for.
  return /^(https?:|mailto:|tel:)/i.test(url) ? url : null;
}

export type Inline = { text: string; bold: boolean; italic: boolean; strike: boolean; underline: boolean; href: string | null };

/** One block's worth of tokens → styled runs. */
export function inlineRuns(tokens: Token[]): Inline[] {
  const runs: Inline[] = [];
  const marks = { bold: 0, italic: 0, strike: 0, underline: 0 };
  let href: string | null = null;

  for (const t of tokens) {
    if (t.kind === "text") {
      const text = decode(t.text);
      if (!text) continue;
      runs.push({
        text,
        bold: marks.bold > 0,
        italic: marks.italic > 0,
        strike: marks.strike > 0,
        underline: marks.underline > 0 || href != null,
        href,
      });
      continue;
    }
    const on = t.kind === "open";
    switch (t.tag) {
      case "strong":
      case "b":
        marks.bold += on ? 1 : -1;
        break;
      case "em":
      case "i":
        marks.italic += on ? 1 : -1;
        break;
      case "s":
      case "strike":
      case "del":
        marks.strike += on ? 1 : -1;
        break;
      case "u":
        marks.underline += on ? 1 : -1;
        break;
      case "code":
        // No monospace family in the theme; rendered as-is so the words
        // survive even though the styling doesn't.
        break;
      case "a":
        href = on ? hrefOf(t.kind === "open" ? t.attrs : "") : null;
        break;
      case "br":
        runs.push({ text: "\n", bold: false, italic: false, strike: false, underline: false, href: null });
        break;
    }
    // A stray close tag would otherwise drive a counter negative and
    // leave every later run bolded.
    for (const k of ["bold", "italic", "strike", "underline"] as const) {
      if (marks[k] < 0) marks[k] = 0;
    }
  }
  return runs.filter((r) => r.text.length > 0);
}

export type Block = { tag: string; tokens: Token[]; ordinal?: number };

/** Blocks whose text the editor nests inside its own <p>. */
function isContainer(b: Block | null): boolean {
  return b?.tag === "li" || b?.tag === "blockquote";
}

export function toBlocks(tokens: Token[]): Block[] {
  const blocks: Block[] = [];
  // Stack of list types so a nested list numbers independently, and so
  // an <li> knows which marker to draw.
  const listStack: { type: "ul" | "ol"; count: number }[] = [];
  let current: Block | null = null;

  const close = () => {
    if (current && current.tokens.some((t) => t.kind === "text" && decode(t.text).trim())) {
      blocks.push(current);
    }
    current = null;
  };

  for (const t of tokens) {
    if (t.kind === "open" && (t.tag === "ul" || t.tag === "ol")) {
      close();
      listStack.push({ type: t.tag, count: 0 });
      continue;
    }
    if (t.kind === "close" && (t.tag === "ul" || t.tag === "ol")) {
      close();
      listStack.pop();
      continue;
    }
    if (t.kind === "open" && t.tag === "li") {
      close();
      const top = listStack[listStack.length - 1];
      if (top) top.count += 1;
      current = { tag: "li", tokens: [], ordinal: top?.type === "ol" ? top.count : undefined };
      continue;
    }
    if (t.kind === "open" && BLOCK.has(t.tag) && t.tag !== "li") {
      // The editor wraps the CONTENTS of a list item and a blockquote
      // in their own <p>. Treating that inner paragraph as a new block
      // would close the container while it was still empty — which is
      // how a quote came out looking like ordinary body text — so keep
      // filling the container instead.
      if (isContainer(current) && t.tag === "p") continue;
      close();
      current = { tag: t.tag, tokens: [] };
      continue;
    }
    if (t.kind === "close" && BLOCK.has(t.tag)) {
      if (isContainer(current) && t.tag === "p") continue;
      close();
      continue;
    }
    // Text or an inline tag: belongs to the open block. Loose text with
    // no block wrapper still gets one, so a bare string renders.
    if (!current) current = { tag: "p", tokens: [] };
    current.tokens.push(t);
  }
  close();
  return blocks;
}

