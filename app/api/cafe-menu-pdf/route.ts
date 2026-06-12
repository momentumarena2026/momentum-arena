import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const CATEGORY_LABELS: Record<string, { label: string }> = {
  SNACKS: { label: "Snacks" },
  BEVERAGES: { label: "Beverages" },
  MEALS: { label: "Meals" },
  DESSERTS: { label: "Desserts" },
  COMBOS: { label: "Combos" },
};

const CATEGORY_ORDER = ["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"];

function formatMenuPrice(rupees: number): string {
  // CafeItem.price is stored as RUPEES (Float, decimals allowed).
  return `Rs. ${rupees.toLocaleString("en-IN")}`;
}

// Light, airy cafe theme — very light orange / cream tones for a
// print-friendly single-page menu (the previous dark theme burned
// ink on a full-bleed A4).
const C = {
  bgPage: [255, 250, 243] as [number, number, number], // warm ivory
  bgCard: [255, 244, 229] as [number, number, number], // pale peach
  bgCardAlt: [253, 239, 219] as [number, number, number], // slightly deeper peach
  orangeSoft: [253, 230, 200] as [number, number, number], // category bar fill
  orangeLight: [250, 204, 144] as [number, number, number], // accents / lines
  orangeMid: [240, 165, 80] as [number, number, number], // decorative
  orangeText: [194, 109, 22] as [number, number, number], // prices / headings
  brownDark: [92, 58, 20] as [number, number, number], // primary text
  brownMid: [140, 100, 60] as [number, number, number], // secondary text
  brownDim: [180, 150, 115] as [number, number, number], // tertiary text
  logoChip: [24, 16, 10] as [number, number, number], // dark badge behind logo
  vegGreen: [34, 160, 84] as [number, number, number],
  nonVegRed: [220, 70, 60] as [number, number, number],
  border: [243, 220, 190] as [number, number, number],
};

/**
 * Logo, sharp-compressed. The raw blackLogo.png is ~200KB and jsPDF
 * re-encodes PNGs into raw flate streams — embedding it untouched
 * ballooned the PDF to ~6MB. Downscale to 240px and flatten onto
 * the dark chip colour we draw behind it (the artwork is built for
 * dark backgrounds) as a ~3KB JPEG.
 */
async function loadLogoImage(): Promise<string | null> {
  try {
    const logoPath = path.join(process.cwd(), "public", "blackLogo.png");
    if (!fs.existsSync(logoPath)) return null;
    const jpeg = await sharp(logoPath)
      .resize(240, 180, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 24, g: 16, b: 10 } }) // == C.logoChip
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch { /* ignore */ }
  return null;
}

/**
 * Product thumbnail loader. Fetches the item's Vercel Blob image,
 * downscales to an 80px square on a white canvas, compresses to
 * JPEG q55 (~2-4KB each). 4s timeout + allSettled at the call site
 * so a dead blob degrades to a clipart placeholder, never a 500.
 */
async function loadItemThumb(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(buf)
      .resize(80, 80, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 55 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Clipart icons (vector, near-zero bytes) ────────────────────────

function drawCoffeeIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  doc.setFillColor(...C.orangeMid);
  doc.roundedRect(cx - s * 0.4, cy - s * 0.1, s * 0.8, s * 0.6, s * 0.08, s * 0.08, "F");
  doc.setDrawColor(...C.orangeMid);
  doc.setLineWidth(s * 0.08);
  doc.ellipse(cx + s * 0.5, cy + s * 0.18, s * 0.18, s * 0.22, "S");
  doc.setFillColor(...C.orangeLight);
  doc.ellipse(cx, cy - s * 0.1, s * 0.4, s * 0.1, "F");
  for (let i = -1; i <= 1; i++) {
    doc.setDrawColor(...C.orangeLight);
    doc.setLineWidth(s * 0.06);
    doc.line(cx + i * s * 0.18, cy - s * 0.5, cx + i * s * 0.18, cy - s * 0.25);
  }
}

function drawSnackIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  doc.setFillColor(...C.orangeMid);
  doc.triangle(cx - s * 0.45, cy + s * 0.4, cx + s * 0.45, cy + s * 0.4, cx, cy - s * 0.45, "F");
  doc.setFillColor(...C.orangeLight);
  doc.circle(cx - s * 0.08, cy + s * 0.05, s * 0.07, "F");
  doc.circle(cx + s * 0.12, cy + s * 0.22, s * 0.07, "F");
  doc.circle(cx - s * 0.15, cy + s * 0.28, s * 0.07, "F");
}

function drawMealIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  doc.setDrawColor(...C.orangeMid);
  doc.setLineWidth(s * 0.09);
  doc.circle(cx, cy, s * 0.45, "S");
  doc.setFillColor(...C.orangeMid);
  doc.circle(cx, cy, s * 0.28, "F");
  doc.setFillColor(...C.orangeLight);
  doc.circle(cx - s * 0.06, cy - s * 0.06, s * 0.1, "F");
}

function drawDessertIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  doc.setFillColor(...C.orangeMid);
  doc.triangle(cx - s * 0.35, cy - s * 0.1, cx + s * 0.35, cy - s * 0.1, cx, cy + s * 0.45, "F");
  doc.setFillColor(...C.orangeLight);
  doc.ellipse(cx, cy - s * 0.15, s * 0.38, s * 0.12, "F");
  doc.setFillColor(...C.nonVegRed);
  doc.circle(cx, cy - s * 0.32, s * 0.09, "F");
}

function drawComboIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  const points = 5;
  const outerR = s * 0.45;
  const innerR = s * 0.2;
  for (let i = 0; i < points; i++) {
    const angle = (Math.PI * 2 * i) / points - Math.PI / 2;
    const ox = cx + Math.cos(angle) * outerR;
    const oy = cy + Math.sin(angle) * outerR;
    const innerAngle = angle + Math.PI / points;
    const ix = cx + Math.cos(innerAngle) * innerR;
    const iy = cy + Math.sin(innerAngle) * innerR;
    doc.setFillColor(...C.orangeMid);
    doc.triangle(cx, cy, ox, oy, ix, iy, "F");
    const nextAngle = (Math.PI * 2 * (i + 1)) / points - Math.PI / 2;
    const nx = cx + Math.cos(nextAngle) * outerR;
    const ny = cy + Math.sin(nextAngle) * outerR;
    doc.triangle(cx, cy, ix, iy, nx, ny, "F");
  }
}

function drawCategoryIcon(doc: jsPDF, cat: string, cx: number, cy: number, size = 5) {
  switch (cat) {
    case "SNACKS": drawSnackIcon(doc, cx, cy, size); break;
    case "BEVERAGES": drawCoffeeIcon(doc, cx, cy, size); break;
    case "MEALS": drawMealIcon(doc, cx, cy, size); break;
    case "DESSERTS": drawDessertIcon(doc, cx, cy, size); break;
    case "COMBOS": drawComboIcon(doc, cx, cy, size); break;
  }
}

// ── Page chrome ────────────────────────────────────────────────────

function drawBackground(doc: jsPDF, pw: number, ph: number) {
  doc.setFillColor(...C.bgPage);
  doc.rect(0, 0, pw, ph, "F");

  // Soft corner blushes
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.18 }));
  doc.setFillColor(...C.orangeSoft);
  doc.circle(-15, -15, 70, "F");
  doc.circle(pw + 15, ph + 15, 70, "F");
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Top/bottom soft orange bands
  doc.setFillColor(...C.orangeLight);
  doc.rect(0, 0, pw, 2.5, "F");
  doc.setFillColor(...C.orangeSoft);
  doc.rect(0, 2.5, pw, 0.8, "F");
  doc.setFillColor(...C.orangeLight);
  doc.rect(0, ph - 2.5, pw, 2.5, "F");
  doc.setFillColor(...C.orangeSoft);
  doc.rect(0, ph - 3.3, pw, 0.8, "F");

  // Hairline side borders + corner dots
  doc.setDrawColor(...C.orangeLight);
  doc.setLineWidth(0.3);
  doc.line(7, 7, 7, ph - 7);
  doc.line(pw - 7, 7, pw - 7, ph - 7);
  doc.setFillColor(...C.orangeMid);
  for (const [x, y] of [[7, 7], [pw - 7, 7], [7, ph - 7], [pw - 7, ph - 7]] as const) {
    doc.circle(x, y, 1, "F");
  }
}

function drawHeader(doc: jsPDF, pw: number, logoImg: string | null): number {
  const headerY = 9;

  // Logo on a dark rounded chip (the artwork is built for dark
  // backgrounds — floating it straight on ivory looks washed out).
  if (logoImg) {
    doc.setFillColor(...C.logoChip);
    doc.roundedRect(pw / 2 - 13, headerY - 1, 26, 18, 2, 2, "F");
    doc.addImage(logoImg, "JPEG", pw / 2 - 11, headerY, 22, 16);
  }

  const afterLogo = logoImg ? headerY + 20 : headerY + 2;

  doc.setTextColor(...C.orangeText);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA", pw / 2, afterLogo, { align: "center" });

  doc.setTextColor(...C.brownDim);
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.text("Mathura's Premier Multi-Sport Arena", pw / 2, afterLogo + 4, { align: "center" });

  // Decorative line + dots
  const lineY = afterLogo + 7.5;
  doc.setDrawColor(...C.orangeLight);
  doc.setLineWidth(0.4);
  doc.line(pw / 2 - 42, lineY, pw / 2 - 14, lineY);
  doc.line(pw / 2 + 14, lineY, pw / 2 + 42, lineY);
  doc.setFillColor(...C.orangeMid);
  doc.circle(pw / 2 - 9, lineY, 0.7, "F");
  doc.circle(pw / 2, lineY, 0.9, "F");
  doc.circle(pw / 2 + 9, lineY, 0.7, "F");

  // Title
  doc.setTextColor(...C.brownDark);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("CAFE MENU", pw / 2, lineY + 10, { align: "center" });
  drawCoffeeIcon(doc, pw / 2 - 40, lineY + 7, 4.5);
  drawCoffeeIcon(doc, pw / 2 + 40, lineY + 7, 4.5);

  doc.setTextColor(...C.orangeText);
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  doc.text("Fuel Your Game  |  Snacks, Beverages & Meals", pw / 2, lineY + 15, { align: "center" });

  const fy = lineY + 18.5;
  doc.setDrawColor(...C.orangeLight);
  doc.setLineWidth(0.3);
  doc.line(pw / 2 - 48, fy, pw / 2 + 48, fy);

  return fy + 4;
}

function drawContinuationHeader(doc: jsPDF, pw: number, margin: number, logoImg: string | null): number {
  if (logoImg) {
    doc.setFillColor(...C.logoChip);
    doc.roundedRect(margin - 1, 4, 14, 11, 1.5, 1.5, "F");
    doc.addImage(logoImg, "JPEG", margin, 5, 12, 9);
  }
  doc.setTextColor(...C.orangeText);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA  |  CAFE MENU", pw / 2, 10, { align: "center" });
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.3);
  doc.line(margin, 16, pw - margin, 16);
  return 20;
}

function drawFooter(doc: jsPDF, pw: number, ph: number, margin: number, pageNum: number, totalPages: number) {
  const fy = ph - 16;
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.3);
  doc.line(margin, fy, pw - margin, fy);

  doc.setFontSize(6);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...C.brownDim);
  doc.text("All prices inclusive of GST  |  Menu items subject to availability", pw / 2, fy + 3.5, { align: "center" });
  doc.text("+91 63961 77261  |  momentumarena2026@gmail.com  |  momentumarena.com", pw / 2, fy + 7, { align: "center" });
  if (totalPages > 1) {
    doc.setFontSize(5.5);
    doc.text(`${pageNum} / ${totalPages}`, pw / 2, fy + 10.5, { align: "center" });
  }
}

// ── Generator ──────────────────────────────────────────────────────

export async function GET() {
  const items = await db.cafeItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  // Load the logo + every product thumb in parallel; allSettled so
  // a dead blob URL degrades to a thumb-less row, never a 500.
  const [logoImg, thumbEntries] = await Promise.all([
    loadLogoImage(),
    Promise.allSettled(
      items
        .filter((i) => !!i.image)
        .map(async (i) => ({
          id: i.id,
          thumb: await loadItemThumb(i.image!),
        })),
    ),
  ]);
  const thumbs = new Map<string, string>();
  for (const e of thumbEntries) {
    if (e.status === "fulfilled" && e.value.thumb) {
      thumbs.set(e.value.id, e.value.thumb);
    }
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = 210;
  const ph = 297;
  const margin = 13;
  const gutter = 6;
  // Two-column layout — the menu flows down the LEFT half of the
  // page, then continues in the RIGHT half, so a typical menu fits
  // on a single sheet. Spills to a second page only when both
  // halves are full.
  const colW = (pw - margin * 2 - gutter) / 2;
  const colX = [margin, margin + colW + gutter];
  const footerY = ph - 20;

  drawBackground(doc, pw, ph);
  let y = drawHeader(doc, pw, logoImg);
  let col = 0;
  let colTop = y; // top of the column area on the current page

  // Centre divider between the two halves (drawn per page).
  const drawDivider = (topY: number) => {
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.3);
    doc.line(pw / 2, topY, pw / 2, footerY - 2);
  };
  drawDivider(colTop);

  // Advance cursor: ensure `h` mm fit in the current column; move
  // to the right column, then to a fresh page, as needed.
  const ensure = (h: number) => {
    if (y + h <= footerY) return;
    if (col === 0) {
      col = 1;
      y = colTop;
      if (y + h <= footerY) return;
    }
    doc.addPage();
    drawBackground(doc, pw, ph);
    colTop = drawContinuationHeader(doc, pw, margin, logoImg);
    drawDivider(colTop);
    col = 0;
    y = colTop;
  };

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    const catItems = grouped[cat];
    const catInfo = CATEGORY_LABELS[cat] || { label: cat };

    // Keep the category header glued to at least its first item.
    ensure(9 + 13);
    const x = colX[col];

    // Category header — soft orange band, brown text.
    doc.setFillColor(...C.orangeSoft);
    doc.roundedRect(x, y, colW, 8, 1.5, 1.5, "F");
    doc.setDrawColor(...C.orangeLight);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, colW, 8, 1.5, 1.5, "S");
    drawCategoryIcon(doc, cat, x + 6, y + 4, 4.5);
    doc.setTextColor(...C.brownDark);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(catInfo.label.toUpperCase(), x + 12, y + 5.3);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.orangeText);
    doc.text(`${catItems.length} items`, x + colW - 3, y + 5.3, { align: "right" });
    y += 10.5;

    for (let ii = 0; ii < catItems.length; ii++) {
      const item = catItems[ii];
      const thumb = thumbs.get(item.id) ?? null;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      const descLines: string[] = item.description
        ? (doc.splitTextToSize(item.description, colW - 26) as string[]).slice(0, 2)
        : [];
      const itemH = descLines.length > 1 ? 13.5 : 11;

      ensure(itemH + 1.5);
      const ix0 = colX[col];

      // Card
      const cardColor = ii % 2 === 0 ? C.bgCard : C.bgCardAlt;
      doc.setFillColor(...cardColor);
      doc.roundedRect(ix0, y, colW, itemH, 1, 1, "F");
      doc.setFillColor(...C.orangeLight);
      doc.rect(ix0, y, 0.8, itemH, "F");

      // Thumbnail (8.5mm) or clipart placeholder
      const tX = ix0 + 2.2;
      const tY = y + (itemH - 8.5) / 2;
      if (thumb) {
        doc.addImage(thumb, "JPEG", tX, tY, 8.5, 8.5);
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(tX, tY, 8.5, 8.5, 0.8, 0.8, "S");
      } else {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(tX, tY, 8.5, 8.5, 0.8, 0.8, "F");
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(tX, tY, 8.5, 8.5, 0.8, 0.8, "S");
        drawCategoryIcon(doc, item.category, tX + 4.25, tY + 4.25, 4);
      }

      const nameX = ix0 + 15.5;

      // Veg / non-veg indicator
      const vx = ix0 + 12.6;
      const vy = y + 3.6;
      doc.setDrawColor(...(item.isVeg ? C.vegGreen : C.nonVegRed));
      doc.setLineWidth(0.4);
      doc.rect(vx - 1.2, vy - 1.2, 2.4, 2.4, "S");
      doc.setFillColor(...(item.isVeg ? C.vegGreen : C.nonVegRed));
      doc.circle(vx, vy, 0.5, "F");

      // Price (right-aligned) — measure first so the name can be
      // truncated to never collide with it in the narrow column.
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      const priceStr = formatMenuPrice(item.price);
      const priceW = doc.getTextWidth(priceStr);

      // Name — ellipsis-truncate to the space left of the price.
      doc.setFontSize(8);
      const maxNameW = colW - (nameX - ix0) - priceW - 5;
      let name = item.name;
      while (name.length > 3 && doc.getTextWidth(name) > maxNameW) {
        name = name.slice(0, -1);
      }
      if (name !== item.name) name = `${name.replace(/\s+$/, "")}…`;
      doc.setTextColor(...C.brownDark);
      doc.text(name, nameX, y + 4.4);

      doc.setTextColor(...C.orangeText);
      doc.setFontSize(8.5);
      doc.text(priceStr, ix0 + colW - 2.5, y + 4.4, { align: "right" });

      // Description
      if (descLines.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(...C.brownMid);
        let dy = y + 7.4;
        for (const line of descLines) {
          doc.text(line, nameX, dy);
          dy += 2.7;
        }
      }

      y += itemH + 1.5;
    }

    y += 2;
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, pw, ph, margin, i, totalPages);
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Momentum-Arena-Cafe-Menu.pdf"`,
      // Edge caches for 60s, then serves stale while regenerating in
      // the background — menu edits propagate within ~a minute while
      // every customer still gets an instant CDN hit. max-age=0 keeps
      // browsers from pinning an old copy.
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=3600",
    },
  });
}
