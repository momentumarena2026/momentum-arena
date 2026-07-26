import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";
import { buildNda, type NdaFields } from "@/lib/nda-template";

// Renders the employee NDA as a jsPDF document on the company letterhead.
//
// Mirrors app/api/invoice/route.ts: the letterhead PNG (public/letterhead.png)
// is drawn full-page as the background and content is laid out in the safe
// band (y 70 → 215mm). Long text auto-paginates, re-drawing the letterhead on
// each new page — the same image alias is reused, so the 4.7MB PNG is embedded
// once regardless of page count.
export function renderNdaPdf(f: NdaFields): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const FOOTER_START = 215; // stay above the letterhead's footer band

  let letterhead: string | null = null;
  try {
    const imagePath = path.join(process.cwd(), "public", "letterhead.png");
    if (fs.existsSync(imagePath)) {
      letterhead = `data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}`;
    }
  } catch {
    // fall back to the text header below
  }

  const contentTop = letterhead ? 70 : 45;

  const drawLetterhead = () => {
    if (letterhead) {
      // Same alias "letterhead" on every page → embedded once, referenced N times.
      doc.addImage(letterhead, "PNG", 0, 0, pageWidth, pageHeight, "letterhead", "FAST");
    } else {
      doc.setFillColor(34, 120, 50);
      doc.rect(0, 0, pageWidth, 35, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("SPORTIVE VENTURES", pageWidth / 2, 14, { align: "center" });
      doc.setFontSize(20);
      doc.text("MOMENTUM ARENA", pageWidth / 2, 24, { align: "center" });
    }
  };

  let y = contentTop;
  drawLetterhead();

  const ensureSpace = (needed: number) => {
    if (y + needed > FOOTER_START) {
      doc.addPage();
      drawLetterhead();
      y = contentTop;
    }
  };

  const writeParagraph = (
    text: string,
    opts: { bold?: boolean; size?: number; lineHeight?: number; gap?: number } = {}
  ) => {
    const size = opts.size ?? 9.5;
    const lineHeight = opts.lineHeight ?? 4.8;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += opts.gap ?? 2.5;
  };

  const nda = buildNda(f);

  // Title + underline
  ensureSpace(14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text(nda.title, pageWidth / 2, y, { align: "center" });
  y += 4;
  doc.setDrawColor(34, 120, 50);
  doc.setLineWidth(0.4);
  doc.line(pageWidth / 2 - 48, y, pageWidth / 2 + 48, y);
  y += 8;

  // Intro paragraphs
  for (const p of nda.intro) writeParagraph(p, { gap: 3 });
  y += 1;

  // Numbered clauses (heading kept with at least its first lines)
  for (const c of nda.clauses) {
    ensureSpace(12);
    writeParagraph(c.heading, { bold: true, size: 10, gap: 1 });
    writeParagraph(c.body, { gap: 3.5 });
  }

  // Closing paragraph(s)
  for (const p of nda.closing) writeParagraph(p, { gap: 4 });

  // Signature block — keep it whole; push to a new page if it won't fit
  ensureSpace(46);
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  for (const line of nda.signature) {
    if (line === "") {
      y += 4;
      continue;
    }
    ensureSpace(6);
    doc.text(line, margin, y);
    y += 6;
  }

  return doc;
}
