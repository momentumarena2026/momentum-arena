import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  SNACKS: { label: "Snacks", emoji: "Popcorn" },
  BEVERAGES: { label: "Beverages", emoji: "Coffee" },
  MEALS: { label: "Meals", emoji: "Plate" },
  DESSERTS: { label: "Desserts", emoji: "Cake" },
  COMBOS: { label: "Combos", emoji: "Star" },
};

const CATEGORY_ORDER = ["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"];

function formatMenuPrice(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN")}`;
}

// Dark theme colors
const COLORS = {
  bgDark: [15, 15, 15] as [number, number, number],
  bgCard: [26, 26, 26] as [number, number, number],
  bgCategoryBar: [22, 101, 52] as [number, number, number], // green-800
  bgCategoryBarLight: [34, 197, 94] as [number, number, number], // green-500
  textWhite: [255, 255, 255] as [number, number, number],
  textGray: [161, 161, 170] as [number, number, number],
  textDimGray: [113, 113, 122] as [number, number, number],
  textGreen: [74, 222, 128] as [number, number, number],
  textAmber: [251, 191, 36] as [number, number, number],
  vegGreen: [34, 197, 94] as [number, number, number],
  nonVegRed: [239, 68, 68] as [number, number, number],
  borderDark: [42, 42, 42] as [number, number, number],
  accentGold: [217, 169, 54] as [number, number, number],
};

function drawDarkBackground(doc: jsPDF, pageWidth: number, pageHeight: number) {
  doc.setFillColor(...COLORS.bgDark);
  doc.rect(0, 0, pageWidth, pageHeight, "F");
}

function drawHeader(doc: jsPDF, pageWidth: number) {
  // Top green accent bar
  doc.setFillColor(...COLORS.bgCategoryBar);
  doc.rect(0, 0, pageWidth, 4, "F");

  // Logo area
  const headerY = 12;

  // Company name
  doc.setTextColor(...COLORS.textGreen);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("MOMENTUM ARENA", pageWidth / 2, headerY + 2, { align: "center" });

  // Subtitle
  doc.setTextColor(...COLORS.textDimGray);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("Mathura's Premier Multi-Sport Arena", pageWidth / 2, headerY + 7, { align: "center" });

  // Divider line
  doc.setDrawColor(...COLORS.bgCategoryBar);
  doc.setLineWidth(0.5);
  doc.line(30, headerY + 11, pageWidth - 30, headerY + 11);

  // CAFE MENU title
  doc.setTextColor(...COLORS.textWhite);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("CAFE MENU", pageWidth / 2, headerY + 24, { align: "center" });

  // Decorative dots
  doc.setFillColor(...COLORS.textAmber);
  doc.circle(pageWidth / 2 - 28, headerY + 29, 0.8, "F");
  doc.circle(pageWidth / 2, headerY + 29, 0.8, "F");
  doc.circle(pageWidth / 2 + 28, headerY + 29, 0.8, "F");

  return headerY + 36;
}

export async function GET() {
  const items = await db.cafeItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  // Group by category
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  // First page
  drawDarkBackground(doc, pageWidth, pageHeight);
  let y = drawHeader(doc, pageWidth);

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);
  const footerY = pageHeight - 25;

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    const catItems = grouped[cat];
    const catInfo = CATEGORY_LABELS[cat] || { label: cat, emoji: "" };

    // Check if we need a new page for category header
    if (y + 25 > footerY) {
      doc.addPage();
      drawDarkBackground(doc, pageWidth, pageHeight);
      // Simple header on continuation pages
      doc.setFillColor(...COLORS.bgCategoryBar);
      doc.rect(0, 0, pageWidth, 4, "F");
      doc.setTextColor(...COLORS.textGreen);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("MOMENTUM ARENA  |  CAFE MENU", pageWidth / 2, 10, { align: "center" });
      doc.setDrawColor(...COLORS.borderDark);
      doc.setLineWidth(0.3);
      doc.line(margin, 14, pageWidth - margin, 14);
      y = 20;
    }

    // Category header bar with rounded corners effect
    doc.setFillColor(...COLORS.bgCategoryBar);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, "F");

    // Category label
    doc.setTextColor(...COLORS.textWhite);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(catInfo.label.toUpperCase(), pageWidth / 2, y + 7, { align: "center" });

    // Item count badge
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORS.textGreen);
    const countText = `${catItems.length} items`;
    doc.text(countText, pageWidth - margin - 4, y + 7, { align: "right" });

    y += 14;

    // Items
    for (let ii = 0; ii < catItems.length; ii++) {
      const item = catItems[ii];

      // Check page break
      const itemHeight = item.description ? 14 : 9;
      if (y + itemHeight > footerY) {
        doc.addPage();
        drawDarkBackground(doc, pageWidth, pageHeight);
        doc.setFillColor(...COLORS.bgCategoryBar);
        doc.rect(0, 0, pageWidth, 4, "F");
        doc.setTextColor(...COLORS.textGreen);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text("MOMENTUM ARENA  |  CAFE MENU", pageWidth / 2, 10, { align: "center" });
        doc.setDrawColor(...COLORS.borderDark);
        doc.setLineWidth(0.3);
        doc.line(margin, 14, pageWidth - margin, 14);
        y = 20;
      }

      // Item card background
      doc.setFillColor(...COLORS.bgCard);
      const cardHeight = item.description ? 12 : 8;
      doc.roundedRect(margin, y - 1, contentWidth, cardHeight, 1.5, 1.5, "F");

      // Veg/Non-veg square indicator
      const indicatorX = margin + 4;
      const indicatorY = y + 1.5;
      doc.setDrawColor(...(item.isVeg ? COLORS.vegGreen : COLORS.nonVegRed));
      doc.setLineWidth(0.5);
      doc.rect(indicatorX - 1.5, indicatorY - 1.5, 3, 3, "S");
      doc.setFillColor(...(item.isVeg ? COLORS.vegGreen : COLORS.nonVegRed));
      doc.circle(indicatorX, indicatorY, 0.7, "F");

      // Item name
      doc.setTextColor(...COLORS.textWhite);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(item.name, margin + 10, y + 3);

      // Tags
      let tagX = margin + 10 + doc.getTextWidth(item.name) + 3;
      if (item.isPopular) {
        doc.setFontSize(6);
        doc.setFillColor(...COLORS.textAmber);
        const tagW = doc.getTextWidth("POPULAR") + 4;
        doc.roundedRect(tagX, y - 0.5, tagW, 4, 1, 1, "F");
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.text("POPULAR", tagX + 2, y + 2.2);
        tagX += tagW + 2;
      }
      if (item.isBestseller) {
        doc.setFontSize(6);
        doc.setFillColor(239, 68, 68);
        const tagW = doc.getTextWidth("BESTSELLER") + 4;
        doc.roundedRect(tagX, y - 0.5, tagW, 4, 1, 1, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.text("BESTSELLER", tagX + 2, y + 2.2);
      }

      // Price (right-aligned)
      doc.setTextColor(...COLORS.textGreen);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(formatMenuPrice(item.price), pageWidth - margin - 4, y + 3, {
        align: "right",
      });

      y += 5;

      // Description
      if (item.description) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...COLORS.textDimGray);
        const descLines = doc.splitTextToSize(item.description, contentWidth - 20);
        for (const line of descLines.slice(0, 2)) {
          doc.text(line, margin + 10, y + 1);
          y += 3;
        }
      }

      y += 3;
    }

    // Category spacing
    y += 4;
  }

  // Footer
  const drawFooter = (d: jsPDF, pw: number, ph: number) => {
    const fy = ph - 20;
    d.setDrawColor(...COLORS.borderDark);
    d.setLineWidth(0.3);
    d.line(margin, fy, pw - margin, fy);

    d.setFontSize(7);
    d.setFont("helvetica", "italic");
    d.setTextColor(...COLORS.textDimGray);
    d.text("All prices inclusive of GST  |  Menu items subject to availability", pw / 2, fy + 5, { align: "center" });
    d.text("+91 63961 77261  |  momentumarena2026@gmail.com  |  momentumarena.com", pw / 2, fy + 9, { align: "center" });

    // Bottom green bar
    d.setFillColor(...COLORS.bgCategoryBar);
    d.rect(0, ph - 4, pw, 4, "F");
  };

  // Add footer to all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawFooter(doc, pageWidth, pageHeight);
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Momentum-Arena-Cafe-Menu.pdf"`,
    },
  });
}
