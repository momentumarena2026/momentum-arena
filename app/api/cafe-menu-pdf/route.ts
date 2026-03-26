import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";

const CATEGORY_LABELS: Record<string, { label: string }> = {
  SNACKS: { label: "Snacks" },
  BEVERAGES: { label: "Beverages" },
  MEALS: { label: "Meals" },
  DESSERTS: { label: "Desserts" },
  COMBOS: { label: "Combos" },
};

const CATEGORY_ORDER = ["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"];

function formatMenuPrice(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN")}`;
}

// Amber/Orange cafe theme
const C = {
  bgDark: [18, 12, 8] as [number, number, number],
  bgCard: [32, 22, 14] as [number, number, number],
  bgCardAlt: [38, 26, 16] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  amberDark: [180, 83, 9] as [number, number, number],
  amberLight: [252, 211, 77] as [number, number, number],
  textWhite: [255, 255, 255] as [number, number, number],
  textCream: [255, 243, 224] as [number, number, number],
  textGray: [168, 150, 132] as [number, number, number],
  textDimGray: [120, 105, 90] as [number, number, number],
  vegGreen: [34, 197, 94] as [number, number, number],
  nonVegRed: [239, 68, 68] as [number, number, number],
  borderWarm: [55, 40, 28] as [number, number, number],
};

function loadLogoImage(): string | null {
  try {
    const logoPath = path.join(process.cwd(), "public", "blackLogo.png");
    if (fs.existsSync(logoPath)) {
      const buf = fs.readFileSync(logoPath);
      return `data:image/png;base64,${buf.toString("base64")}`;
    }
  } catch { /* ignore */ }
  return null;
}

// Draw clipart icons using jsPDF drawing primitives
function drawCoffeeIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  // Cup body
  doc.setFillColor(...C.amberDark);
  doc.roundedRect(cx - s * 0.4, cy - s * 0.1, s * 0.8, s * 0.6, s * 0.08, s * 0.08, "F");
  // Handle
  doc.setDrawColor(...C.amberDark);
  doc.setLineWidth(s * 0.08);
  doc.circle(cx + s * 0.55, cy + s * 0.15, s * 0.15, "S");
  // Saucer
  doc.setFillColor(...C.amber);
  doc.ellipse(cx, cy + s * 0.55, s * 0.55, s * 0.1, "F");
  // Steam lines
  doc.setDrawColor(...C.amberLight);
  doc.setLineWidth(s * 0.04);
  doc.line(cx - s * 0.15, cy - s * 0.2, cx - s * 0.1, cy - s * 0.4);
  doc.line(cx, cy - s * 0.2, cx + s * 0.05, cy - s * 0.45);
  doc.line(cx + s * 0.15, cy - s * 0.2, cx + s * 0.1, cy - s * 0.38);
}

function drawSnackIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  // Popcorn bucket
  doc.setFillColor(220, 50, 50);
  doc.rect(cx - s * 0.3, cy - s * 0.1, s * 0.6, s * 0.6, "F");
  // Bucket top wider
  doc.setFillColor(220, 50, 50);
  doc.rect(cx - s * 0.35, cy - s * 0.15, s * 0.7, s * 0.15, "F");
  // Stripes
  doc.setFillColor(255, 255, 255);
  doc.rect(cx - s * 0.15, cy - s * 0.1, s * 0.06, s * 0.6, "F");
  doc.rect(cx + s * 0.1, cy - s * 0.1, s * 0.06, s * 0.6, "F");
  // Popcorn puffs
  doc.setFillColor(...C.amberLight);
  doc.circle(cx - s * 0.15, cy - s * 0.25, s * 0.12, "F");
  doc.circle(cx + s * 0.05, cy - s * 0.3, s * 0.13, "F");
  doc.circle(cx + s * 0.2, cy - s * 0.22, s * 0.1, "F");
  doc.circle(cx - s * 0.05, cy - s * 0.2, s * 0.1, "F");
}

function drawMealIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  // Plate
  doc.setFillColor(...C.textGray);
  doc.ellipse(cx, cy + s * 0.15, s * 0.5, s * 0.2, "F");
  doc.setFillColor(...C.textWhite);
  doc.ellipse(cx, cy + s * 0.12, s * 0.4, s * 0.15, "F");
  // Cloche/dome
  doc.setFillColor(...C.amberDark);
  doc.ellipse(cx, cy - s * 0.05, s * 0.35, s * 0.3, "F");
  // Handle knob
  doc.setFillColor(...C.amber);
  doc.circle(cx, cy - s * 0.35, s * 0.06, "F");
  // Steam
  doc.setDrawColor(...C.amberLight);
  doc.setLineWidth(s * 0.03);
  doc.line(cx - s * 0.1, cy - s * 0.45, cx - s * 0.05, cy - s * 0.55);
  doc.line(cx + s * 0.1, cy - s * 0.42, cx + s * 0.05, cy - s * 0.55);
}

function drawDessertIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  // Cake base
  doc.setFillColor(...C.amberDark);
  doc.roundedRect(cx - s * 0.35, cy + s * 0.05, s * 0.7, s * 0.35, s * 0.05, s * 0.05, "F");
  // Cake top layer
  doc.setFillColor(220, 130, 70);
  doc.roundedRect(cx - s * 0.3, cy - s * 0.15, s * 0.6, s * 0.25, s * 0.05, s * 0.05, "F");
  // Frosting
  doc.setFillColor(...C.amberLight);
  doc.ellipse(cx, cy - s * 0.15, s * 0.32, s * 0.08, "F");
  // Cherry
  doc.setFillColor(220, 50, 50);
  doc.circle(cx, cy - s * 0.3, s * 0.08, "F");
  // Candle
  doc.setFillColor(...C.textWhite);
  doc.rect(cx - s * 0.02, cy - s * 0.5, s * 0.04, s * 0.2, "F");
  // Flame
  doc.setFillColor(...C.amber);
  doc.ellipse(cx, cy - s * 0.55, s * 0.04, s * 0.06, "F");
}

function drawComboIcon(doc: jsPDF, cx: number, cy: number, size: number) {
  const s = size;
  // Star shape
  doc.setFillColor(...C.amber);
  const points = 5;
  const outerR = s * 0.4;
  const innerR = s * 0.18;
  for (let i = 0; i < points; i++) {
    const outerAngle = (Math.PI * 2 * i) / points - Math.PI / 2;
    const innerAngle = outerAngle + Math.PI / points;
    const ox = cx + Math.cos(outerAngle) * outerR;
    const oy = cy + Math.sin(outerAngle) * outerR;
    const ix = cx + Math.cos(innerAngle) * innerR;
    const iy = cy + Math.sin(innerAngle) * innerR;
    doc.setFillColor(...C.amber);
    doc.triangle(cx, cy, ox, oy, ix, iy, "F");
    // Next outer point
    const nextAngle = (Math.PI * 2 * (i + 1)) / points - Math.PI / 2;
    const nx = cx + Math.cos(nextAngle) * outerR;
    const ny = cy + Math.sin(nextAngle) * outerR;
    doc.triangle(cx, cy, ix, iy, nx, ny, "F");
  }
}

function drawCategoryIcon(doc: jsPDF, cat: string, cx: number, cy: number) {
  const size = 6;
  switch (cat) {
    case "SNACKS": drawSnackIcon(doc, cx, cy, size); break;
    case "BEVERAGES": drawCoffeeIcon(doc, cx, cy, size); break;
    case "MEALS": drawMealIcon(doc, cx, cy, size); break;
    case "DESSERTS": drawDessertIcon(doc, cx, cy, size); break;
    case "COMBOS": drawComboIcon(doc, cx, cy, size); break;
  }
}

function drawBackground(doc: jsPDF, pw: number, ph: number) {
  doc.setFillColor(...C.bgDark);
  doc.rect(0, 0, pw, ph, "F");

  // Subtle texture
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.03 }));
  for (let i = 0; i < pw; i += 8) {
    doc.setFillColor(180, 120, 60);
    doc.rect(i, 0, 4, ph, "F");
  }
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.02 }));
  for (let i = -ph; i < pw; i += 30) {
    doc.setFillColor(255, 180, 80);
    doc.rect(i, 0, 12, ph, "F");
  }
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Corner glow
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setFillColor(...C.amber);
  doc.circle(-20, -20, 80, "F");
  doc.circle(pw + 20, ph + 20, 80, "F");
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Top/bottom amber bars
  doc.setFillColor(...C.amberDark);
  doc.rect(0, 0, pw, 3, "F");
  doc.setFillColor(...C.amber);
  doc.rect(0, 3, pw, 0.5, "F");
  doc.setFillColor(...C.amberDark);
  doc.rect(0, ph - 3, pw, 3, "F");
  doc.setFillColor(...C.amber);
  doc.rect(0, ph - 3.5, pw, 0.5, "F");

  // Side borders
  doc.setDrawColor(...C.amberDark);
  doc.setLineWidth(0.3);
  doc.line(8, 8, 8, ph - 8);
  doc.line(pw - 8, 8, pw - 8, ph - 8);

  // Corner decorative squares
  const cornerSize = 3;
  doc.setFillColor(...C.amber);
  // Top-left
  doc.rect(8 - cornerSize / 2, 8 - cornerSize / 2, cornerSize, cornerSize, "F");
  // Top-right
  doc.rect(pw - 8 - cornerSize / 2, 8 - cornerSize / 2, cornerSize, cornerSize, "F");
  // Bottom-left
  doc.rect(8 - cornerSize / 2, ph - 8 - cornerSize / 2, cornerSize, cornerSize, "F");
  // Bottom-right
  doc.rect(pw - 8 - cornerSize / 2, ph - 8 - cornerSize / 2, cornerSize, cornerSize, "F");
}

function drawHeader(doc: jsPDF, pw: number, logoImg: string | null): number {
  const headerY = 10;

  // Logo
  if (logoImg) {
    doc.addImage(logoImg, "PNG", pw / 2 - 12, headerY, 24, 18);
  }

  const afterLogo = logoImg ? headerY + 21 : headerY + 2;

  // Company name
  doc.setTextColor(...C.amber);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA", pw / 2, afterLogo, { align: "center" });

  // Subtitle
  doc.setTextColor(...C.textDimGray);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.text("Mathura's Premier Multi-Sport Arena", pw / 2, afterLogo + 5, { align: "center" });

  // Decorative line
  const lineY = afterLogo + 9;
  doc.setDrawColor(...C.amber);
  doc.setLineWidth(0.4);
  doc.line(pw / 2 - 45, lineY, pw / 2 - 15, lineY);
  doc.line(pw / 2 + 15, lineY, pw / 2 + 45, lineY);
  doc.setFillColor(...C.amber);
  doc.circle(pw / 2 - 10, lineY, 0.7, "F");
  doc.circle(pw / 2, lineY, 0.9, "F");
  doc.circle(pw / 2 + 10, lineY, 0.7, "F");

  // CAFE MENU title
  doc.setTextColor(...C.textCream);
  doc.setFontSize(30);
  doc.setFont("helvetica", "bold");
  doc.text("CAFE MENU", pw / 2, lineY + 14, { align: "center" });

  // Coffee clipart on both sides of title
  drawCoffeeIcon(doc, pw / 2 - 45, lineY + 10, 5);
  drawCoffeeIcon(doc, pw / 2 + 45, lineY + 10, 5);

  // Tagline
  doc.setTextColor(...C.amberLight);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("Fuel Your Game  |  Snacks, Beverages & Meals", pw / 2, lineY + 20, { align: "center" });

  // Bottom flourish
  const fy = lineY + 24;
  doc.setDrawColor(...C.amber);
  doc.setLineWidth(0.3);
  doc.line(pw / 2 - 50, fy, pw / 2 + 50, fy);
  doc.setFillColor(...C.amber);
  doc.circle(pw / 2 - 52, fy, 0.6, "F");
  doc.circle(pw / 2 + 52, fy, 0.6, "F");

  return fy + 6;
}

function drawContinuationHeader(doc: jsPDF, pw: number, margin: number, logoImg: string | null): number {
  if (logoImg) {
    doc.addImage(logoImg, "PNG", margin, 5, 12, 9);
  }
  doc.setTextColor(...C.amber);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA  |  CAFE MENU", pw / 2, 10, { align: "center" });
  doc.setDrawColor(...C.borderWarm);
  doc.setLineWidth(0.3);
  doc.line(margin, 14, pw - margin, 14);
  return 19;
}

function drawFooter(doc: jsPDF, pw: number, ph: number, margin: number, pageNum: number, totalPages: number) {
  const fy = ph - 18;
  doc.setDrawColor(...C.borderWarm);
  doc.setLineWidth(0.3);
  doc.line(margin, fy, pw - margin, fy);

  doc.setFontSize(6.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...C.textDimGray);
  doc.text("All prices inclusive of GST  |  Menu items subject to availability", pw / 2, fy + 4, { align: "center" });
  doc.text("+91 63961 77261  |  momentumarena2026@gmail.com  |  momentumarena.com", pw / 2, fy + 8, { align: "center" });

  doc.setFontSize(6);
  doc.setTextColor(...C.textDimGray);
  doc.text(`${pageNum} / ${totalPages}`, pw / 2, fy + 12, { align: "center" });
}

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

  const logoImg = loadLogoImage();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = 210;
  const ph = 297;
  const margin = 16;
  const cw = pw - margin * 2;

  // First page
  drawBackground(doc, pw, ph);
  let y = drawHeader(doc, pw, logoImg);

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);
  const footerY = ph - 22;

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    const catItems = grouped[cat];
    const catInfo = CATEGORY_LABELS[cat] || { label: cat };

    if (y + 22 > footerY) {
      doc.addPage();
      drawBackground(doc, pw, ph);
      y = drawContinuationHeader(doc, pw, margin, logoImg);
    }

    // Category header — amber bar
    doc.setFillColor(...C.amberDark);
    doc.roundedRect(margin, y, cw, 10, 1.5, 1.5, "F");
    // @ts-expect-error jsPDF GState
    doc.setGState(new doc.GState({ opacity: 0.3 }));
    doc.setFillColor(...C.amber);
    doc.roundedRect(margin, y, cw, 5, 1.5, 1.5, "F");
    // @ts-expect-error jsPDF GState
    doc.setGState(new doc.GState({ opacity: 1 }));

    // Category icon on left
    drawCategoryIcon(doc, cat, margin + 10, y + 5);

    // Category label
    doc.setTextColor(...C.textWhite);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(catInfo.label.toUpperCase(), pw / 2, y + 7, { align: "center" });

    // Item count
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.amberLight);
    doc.text(`${catItems.length} items`, pw - margin - 4, y + 7, { align: "right" });

    y += 14;

    for (let ii = 0; ii < catItems.length; ii++) {
      const item = catItems[ii];
      const hasDesc = !!item.description;
      const itemH = hasDesc ? 13 : 8;

      if (y + itemH > footerY) {
        doc.addPage();
        drawBackground(doc, pw, ph);
        y = drawContinuationHeader(doc, pw, margin, logoImg);
      }

      // Alternating card background
      const cardColor = ii % 2 === 0 ? C.bgCard : C.bgCardAlt;
      doc.setFillColor(...cardColor);
      doc.roundedRect(margin, y - 0.5, cw, itemH - 1, 1, 1, "F");

      // Left amber accent line
      doc.setFillColor(...C.amber);
      doc.rect(margin, y - 0.5, 1, itemH - 1, "F");

      // Veg/Non-veg square indicator
      const ix = margin + 5;
      const iy = y + 2;
      doc.setDrawColor(...(item.isVeg ? C.vegGreen : C.nonVegRed));
      doc.setLineWidth(0.5);
      doc.rect(ix - 1.5, iy - 1.5, 3, 3, "S");
      doc.setFillColor(...(item.isVeg ? C.vegGreen : C.nonVegRed));
      doc.circle(ix, iy, 0.6, "F");

      // Item name
      doc.setTextColor(...C.textCream);
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      doc.text(item.name, margin + 11, y + 3.5);

      // Tags
      let tx = margin + 11 + doc.getTextWidth(item.name) + 2;
      if (item.tags.includes("Popular")) {
        doc.setFontSize(5.5);
        doc.setFillColor(...C.amber);
        const tw = doc.getTextWidth("POPULAR") + 3;
        doc.roundedRect(tx, y, tw, 3.5, 0.8, 0.8, "F");
        doc.setTextColor(30, 15, 5);
        doc.setFont("helvetica", "bold");
        doc.text("POPULAR", tx + 1.5, y + 2.5);
        tx += tw + 1.5;
      }
      if (item.tags.includes("Bestseller")) {
        doc.setFontSize(5.5);
        doc.setFillColor(220, 50, 50);
        const tw = doc.getTextWidth("BESTSELLER") + 3;
        doc.roundedRect(tx, y, tw, 3.5, 0.8, 0.8, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.text("BESTSELLER", tx + 1.5, y + 2.5);
      }

      // Price
      doc.setTextColor(...C.amber);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(formatMenuPrice(item.price), pw - margin - 4, y + 3.5, { align: "right" });

      y += 5;

      // Description
      if (item.description) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...C.textGray);
        const descLines = doc.splitTextToSize(item.description, cw - 20);
        for (const line of descLines.slice(0, 2)) {
          doc.text(line, margin + 11, y + 1);
          y += 3;
        }
      }

      y += 2.5;
    }

    y += 3;
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
    },
  });
}
