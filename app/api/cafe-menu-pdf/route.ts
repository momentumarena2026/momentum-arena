import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";

const CATEGORY_LABELS: Record<string, string> = {
  SNACKS: "Snacks",
  BEVERAGES: "Beverages",
  MEALS: "Meals",
  DESSERTS: "Desserts",
  COMBOS: "Combos",
};

const CATEGORY_ORDER = ["SNACKS", "BEVERAGES", "MEALS", "DESSERTS", "COMBOS"];

function formatMenuPrice(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN")}`;
}

export async function GET() {
  // No auth required - public endpoint for QR code

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
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // Try to load letterhead
  let letterheadImage: string | null = null;
  try {
    const imagePath = path.join(process.cwd(), "public", "letterhead.png");
    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      letterheadImage = `data:image/png;base64,${imageBuffer.toString("base64")}`;
    }
  } catch {
    // no letterhead
  }

  if (letterheadImage) {
    doc.addImage(letterheadImage, "PNG", 0, 0, pageWidth, pageHeight);
  } else {
    doc.setFillColor(34, 120, 50);
    doc.rect(0, 0, pageWidth, 35, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("MOMENTUM ARENA", pageWidth / 2, 18, { align: "center" });
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Khasra no. 293/5, Mouja Ganeshra, Radhapuram Road, Mathura", pageWidth / 2, 28, { align: "center" });
  }

  let y = letterheadImage ? 70 : 45;

  // Title
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("CAFE MENU", pageWidth / 2, y, { align: "center" });
  y += 12;

  // Decorative line
  doc.setDrawColor(34, 120, 50);
  doc.setLineWidth(0.8);
  doc.line(margin + 30, y, pageWidth - margin - 30, y);
  y += 10;

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);
  const footerY = letterheadImage ? 215 : pageHeight - 30;

  for (let ci = 0; ci < categories.length; ci++) {
    const cat = categories[ci];
    const catItems = grouped[cat];

    // Check if we need a new page
    if (y + 20 > footerY) {
      doc.addPage();
      if (letterheadImage) {
        doc.addImage(letterheadImage, "PNG", 0, 0, pageWidth, pageHeight);
      }
      y = letterheadImage ? 70 : 20;
    }

    // Category heading
    doc.setFillColor(34, 120, 50);
    doc.rect(margin, y, contentWidth, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(
      (CATEGORY_LABELS[cat] || cat).toUpperCase(),
      pageWidth / 2,
      y + 5.8,
      { align: "center" }
    );
    y += 12;

    // Items
    for (const item of catItems) {
      if (y + 12 > footerY) {
        doc.addPage();
        if (letterheadImage) {
          doc.addImage(letterheadImage, "PNG", 0, 0, pageWidth, pageHeight);
        }
        y = letterheadImage ? 70 : 20;
      }

      // Veg/non-veg indicator
      if (item.isVeg) {
        doc.setFillColor(34, 139, 34);
      } else {
        doc.setFillColor(220, 50, 50);
      }
      doc.circle(margin + 3, y + 1, 1.8, "F");

      // Item name
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(item.name, margin + 8, y + 2);

      // Price (right-aligned)
      doc.setFont("helvetica", "bold");
      doc.text(formatMenuPrice(item.price), pageWidth - margin, y + 2, {
        align: "right",
      });

      // Dotted line between name and price
      const nameWidth = doc.getTextWidth(item.name);
      const priceWidth = doc.getTextWidth(formatMenuPrice(item.price));
      const dotsStart = margin + 8 + nameWidth + 2;
      const dotsEnd = pageWidth - margin - priceWidth - 2;
      if (dotsEnd > dotsStart) {
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.2);
        doc.setLineDashPattern([0.5, 1.5], 0);
        doc.line(dotsStart, y + 2, dotsEnd, y + 2);
        doc.setLineDashPattern([], 0);
      }

      y += 5;

      // Description
      if (item.description) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        const descLines = doc.splitTextToSize(
          item.description,
          contentWidth - 10
        );
        for (const line of descLines.slice(0, 2)) {
          doc.text(line, margin + 8, y + 1);
          y += 3.5;
        }
      }

      y += 3;
    }

    // Section divider (except last)
    if (ci < categories.length - 1) {
      y += 3;
    }
  }

  // Footer note
  if (y + 15 <= footerY) {
    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 120, 120);
    doc.text("Prices inclusive of GST", pageWidth / 2, y, {
      align: "center",
    });
    y += 4;
    doc.text(
      "For orders & queries: +91 63961 77261 | momentumarena2026@gmail.com",
      pageWidth / 2,
      y,
      { align: "center" }
    );
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Momentum-Arena-Cafe-Menu.pdf"`,
    },
  });
}
