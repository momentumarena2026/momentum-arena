import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";

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
  bgDark: [18, 12, 8] as [number, number, number],       // warm dark brown-black
  bgCard: [32, 22, 14] as [number, number, number],       // dark warm brown
  bgCardAlt: [38, 26, 16] as [number, number, number],    // slightly lighter
  amber: [245, 158, 11] as [number, number, number],      // amber-500
  amberDark: [180, 83, 9] as [number, number, number],    // amber-700
  amberLight: [252, 211, 77] as [number, number, number], // amber-300
  textWhite: [255, 255, 255] as [number, number, number],
  textCream: [255, 243, 224] as [number, number, number], // warm cream
  textGray: [168, 150, 132] as [number, number, number],  // warm gray
  textDimGray: [120, 105, 90] as [number, number, number],
  vegGreen: [34, 197, 94] as [number, number, number],
  nonVegRed: [239, 68, 68] as [number, number, number],
  borderWarm: [55, 40, 28] as [number, number, number],
};

function drawBackground(doc: jsPDF, pw: number, ph: number) {
  // Main dark background
  doc.setFillColor(...C.bgDark);
  doc.rect(0, 0, pw, ph, "F");

  // Subtle warm gradient overlay — vertical strips to simulate texture
  doc.setGState(new doc.GState({ opacity: 0.03 }));
  for (let i = 0; i < pw; i += 8) {
    doc.setFillColor(180, 120, 60);
    doc.rect(i, 0, 4, ph, "F");
  }
  // Diagonal warm light streaks
  doc.setGState(new doc.GState({ opacity: 0.02 }));
  for (let i = -ph; i < pw; i += 30) {
    doc.setFillColor(255, 180, 80);
    doc.rect(i, 0, 12, ph, "F");
  }
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Corner decorative elements — warm amber circles
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setFillColor(...C.amber);
  doc.circle(-20, -20, 80, "F");
  doc.circle(pw + 20, ph + 20, 80, "F");
  doc.setGState(new doc.GState({ opacity: 1 }));

  // Top amber accent bar
  doc.setFillColor(...C.amberDark);
  doc.rect(0, 0, pw, 3, "F");
  doc.setFillColor(...C.amber);
  doc.rect(0, 3, pw, 0.5, "F");

  // Bottom amber accent bar
  doc.setFillColor(...C.amberDark);
  doc.rect(0, ph - 3, pw, 3, "F");
  doc.setFillColor(...C.amber);
  doc.rect(0, ph - 3.5, pw, 0.5, "F");

  // Side borders — thin amber lines
  doc.setDrawColor(...C.amberDark);
  doc.setLineWidth(0.3);
  doc.line(8, 8, 8, ph - 8);
  doc.line(pw - 8, 8, pw - 8, ph - 8);
}

function drawHeader(doc: jsPDF, pw: number): number {
  const headerY = 14;

  // Decorative top flourish
  doc.setDrawColor(...C.amber);
  doc.setLineWidth(0.4);
  doc.line(pw / 2 - 40, headerY, pw / 2 - 12, headerY);
  doc.line(pw / 2 + 12, headerY, pw / 2 + 40, headerY);
  doc.setFillColor(...C.amber);
  doc.circle(pw / 2 - 8, headerY, 0.8, "F");
  doc.circle(pw / 2, headerY, 1, "F");
  doc.circle(pw / 2 + 8, headerY, 0.8, "F");

  // Company name
  doc.setTextColor(...C.amber);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA", pw / 2, headerY + 7, { align: "center" });

  // Subtitle
  doc.setTextColor(...C.textDimGray);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.text("Mathura's Premier Multi-Sport Arena", pw / 2, headerY + 12, { align: "center" });

  // Main title — CAFE MENU
  doc.setTextColor(...C.textCream);
  doc.setFontSize(32);
  doc.setFont("helvetica", "bold");
  doc.text("CAFE MENU", pw / 2, headerY + 28, { align: "center" });

  // Tagline
  doc.setTextColor(...C.amberLight);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("Fuel Your Game  |  Snacks, Beverages & Meals", pw / 2, headerY + 34, { align: "center" });

  // Bottom flourish
  const fy = headerY + 38;
  doc.setDrawColor(...C.amber);
  doc.setLineWidth(0.3);
  doc.line(pw / 2 - 50, fy, pw / 2 + 50, fy);
  doc.setFillColor(...C.amber);
  doc.circle(pw / 2 - 52, fy, 0.6, "F");
  doc.circle(pw / 2 + 52, fy, 0.6, "F");

  return fy + 6;
}

function drawContinuationHeader(doc: jsPDF, pw: number, margin: number): number {
  doc.setTextColor(...C.amber);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA  |  CAFE MENU", pw / 2, 10, { align: "center" });
  doc.setDrawColor(...C.borderWarm);
  doc.setLineWidth(0.3);
  doc.line(margin, 13, pw - margin, 13);
  return 18;
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

  // Page number
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

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = 210;
  const ph = 297;
  const margin = 16;
  const cw = pw - margin * 2;

  // First page
  drawBackground(doc, pw, ph);
  let y = drawHeader(doc, pw);

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);
  const footerY = ph - 22;

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    const catItems = grouped[cat];
    const catInfo = CATEGORY_LABELS[cat] || { label: cat };

    if (y + 22 > footerY) {
      doc.addPage();
      drawBackground(doc, pw, ph);
      y = drawContinuationHeader(doc, pw, margin);
    }

    // Category header — amber bar
    doc.setFillColor(...C.amberDark);
    doc.roundedRect(margin, y, cw, 9, 1.5, 1.5, "F");

    // Amber gradient highlight on top
    doc.setGState(new doc.GState({ opacity: 0.3 }));
    doc.setFillColor(...C.amber);
    doc.roundedRect(margin, y, cw, 4.5, 1.5, 1.5, "F");
    doc.setGState(new doc.GState({ opacity: 1 }));

    // Category label
    doc.setTextColor(...C.textWhite);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(catInfo.label.toUpperCase(), pw / 2, y + 6.5, { align: "center" });

    // Item count
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.amberLight);
    doc.text(`${catItems.length} items`, pw - margin - 4, y + 6.5, { align: "right" });

    y += 13;

    for (let ii = 0; ii < catItems.length; ii++) {
      const item = catItems[ii];
      const hasDesc = !!item.description;
      const itemH = hasDesc ? 13 : 8;

      if (y + itemH > footerY) {
        doc.addPage();
        drawBackground(doc, pw, ph);
        y = drawContinuationHeader(doc, pw, margin);
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
      if (item.isPopular) {
        doc.setFontSize(5.5);
        doc.setFillColor(...C.amber);
        const tw = doc.getTextWidth("POPULAR") + 3;
        doc.roundedRect(tx, y, tw, 3.5, 0.8, 0.8, "F");
        doc.setTextColor(30, 15, 5);
        doc.setFont("helvetica", "bold");
        doc.text("POPULAR", tx + 1.5, y + 2.5);
        tx += tw + 1.5;
      }
      if (item.isBestseller) {
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

  // Add footer to all pages
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
