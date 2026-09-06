/**
 * Reading a photographed page of the cafe register.
 *
 * The model's whole job is TRANSCRIPTION: what does each line say. It
 * does not decide what an item is, what it costs, or whether an order
 * should exist — that is the matcher's job and then the admin's. Keeping
 * it to transcription is what makes an unreliable component safe here:
 * every number it reads is shown to a human beside the photograph before
 * anything is created.
 *
 * ── On the model ─────────────────────────────────────────────────────
 *
 * Vision on Groq is a moving target. The Llama 4 models that served it
 * were retired in 2026, and the current option is a PREVIEW model, which
 * the provider labels as not for production. That is a real caveat and
 * the reason the id lives in the environment: when it is retired in turn,
 * this is a Vercel setting, not a deploy. The same lesson as
 * GROQ_MODEL — which shipped hardcoded to a model that had already been
 * shut down, and failed silently for a day.
 *
 * ── Degradation ─────────────────────────────────────────────────────
 *
 * No key, a timeout, a refusal or unparseable output all end the same
 * way: an empty row list and an error the admin can read. There is no
 * half-transcribed state — a page that could not be read is retyped by
 * hand, which is what happens today anyway.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq's current multimodal model. Preview-tier at time of writing; see
 * the note above about why this is configurable rather than compiled in.
 */
const VISION_MODEL = process.env.CAFE_VISION_MODEL || "qwen/qwen3.6-27b";

/** Handwriting on a phone photo is slow to read. Longer than the chat
 *  path's budget, because nobody is watching a chat bubble here — the
 *  admin has just uploaded a page and expects it to take a moment. */
const TIMEOUT_MS = 30_000;

/** One line of the register, exactly as written. Nothing is resolved. */
export type RegisterRow = {
  /** The item column, verbatim — "W.B (F)", not an interpretation. */
  item: string;
  qty: number | null;
  /** The price column as written, for the whole line. */
  price: number | null;
  /** The time column, e.g. "7-8PM". Free text; only ever displayed. */
  time: string | null;
  /** Which tick column carried a mark: "cash" | "online" | null. */
  payment: string | null;
};

export type VisionResult = {
  rows: RegisterRow[];
  error: string | null;
  latencyMs: number;
  /** The raw response, kept for the audit trail and for improving this. */
  raw: unknown;
};

const SYSTEM = [
  "You transcribe a handwritten daily sales register from an Indian sports-venue cafe.",
  "",
  "The page is a table. Typical columns: Item, Qty, Price, Time, and two tick",
  "columns for payment — Online and Cash. Column order and headings vary.",
  "",
  "Return ONLY JSON: { \"rows\": [ { item, qty, price, time, payment } ] }",
  "  item    string  the Item cell EXACTLY as written, including any brackets",
  "                  or abbreviations. Do NOT expand, correct or guess at it.",
  "  qty     number or null",
  "  price   number or null   (the figure written on that line, in rupees)",
  "  time    string or null   (e.g. \"7-8PM\")",
  "  payment \"cash\" | \"online\" | null",
  "",
  "Rules:",
  "- Transcribe. Do not interpret. \"W.B (F)\" stays \"W.B (F)\".",
  "- payment is whichever tick column carries a mark. If both or neither are",
  "  marked, or you cannot tell, use null. Never guess a payment method.",
  "- A cell you cannot read is null. A null is useful; a wrong number is not.",
  "- Skip the header row and any blank rows.",
  "- Keep the rows in the order they appear on the page.",
].join("\n");

/**
 * Transcribe one register photograph.
 *
 * `imageDataUrl` is a data: URL, so the image never has to be publicly
 * reachable for the provider to fetch it — a page of the day's takings
 * should not need a public URL to be read.
 */
export async function readRegisterImage(
  imageDataUrl: string,
): Promise<VisionResult> {
  const key = process.env.GROQ_API_KEY;
  const started = Date.now();
  if (!key) {
    return {
      rows: [],
      error: "Image reading isn't configured yet (no API key).",
      latencyMs: 0,
      raw: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe every row of this register page." },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // The body, not just the status. "HTTP 404" said nothing about
      // whether the url, the key or the model was wrong last time this
      // pattern bit — the body names the model and says it is gone.
      const detail = await res.text().catch(() => "");
      return {
        rows: [],
        error: `Couldn't read the image (${res.status}). ${detail.slice(0, 200)}`,
        latencyMs,
        raw: detail.slice(0, 500),
      };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      return { rows: [], error: "The image reader returned nothing.", latencyMs, raw: body };
    }

    const parsed = JSON.parse(content) as { rows?: unknown };
    return {
      rows: sanitizeRows(parsed.rows),
      error: null,
      latencyMs,
      raw: content.slice(0, 8000),
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      rows: [],
      error: aborted
        ? "Reading the image took too long. Try a clearer or smaller photo."
        : "Couldn't read the image. Try again, or enter the rows by hand.",
      latencyMs,
      raw: err instanceof Error ? err.name : "error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Coerce whatever came back into rows, dropping anything unusable.
 *
 * Everything downstream is shown to a human, but a row with a string
 * where a quantity should be would reach the review table as NaN and
 * quietly create an order for zero items — so shapes are enforced here
 * rather than trusted.
 */
function sanitizeRows(raw: unknown): RegisterRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RegisterRow[] = [];
  // A register page is a day of counter sales, not a ledger. Far past
  // this and something has gone wrong with the transcription.
  for (const r of raw.slice(0, 100)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const item = String(o.item ?? "").trim().slice(0, 80);
    if (!item) continue;
    out.push({
      item,
      qty: toNumber(o.qty),
      price: toNumber(o.price),
      time: o.time == null ? null : String(o.time).trim().slice(0, 30) || null,
      payment: o.payment == null ? null : String(o.payment).toLowerCase().trim() || null,
    });
  }
  return out;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}
