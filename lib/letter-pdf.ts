import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";

// Shared letterhead PDF engine for all company letters (NDA, offer letter, …).
//
// A letter is a list of LetterBlocks. The engine draws the company letterhead
// (public/letterhead.png) full-page as the background, lays the blocks out in
// the safe band (y 70 → 215mm), auto-paginates (re-drawing the letterhead on
// each page via a shared image alias so the PNG embeds once), and renders the
// authorised-signatory block with the company stamp + signature overlaid.
//
// Stamp & signature images live at public/letter-assets/{signature,stamp}.png.
// If absent, a "signoff" block still prints the name + title over a signature
// line — the letter degrades gracefully.

export type LetterBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "lines"; lines: string[]; bold?: boolean; size?: number }
  | { type: "gap"; mm: number }
  | { type: "rule" }
  | { type: "signoff"; name: string; title: string };

type LoadedImage = { data: string; w: number; h: number };

// `rel` is relative to the project root. The letterhead lives under /public
// (it is only branding), but the signature + stamp live under /assets, which
// Next does NOT serve publicly — they are read server-side at render time and
// traced into the function bundle via next.config outputFileTracingIncludes.
function loadImage(rel: string): LoadedImage | null {
  try {
    const p = path.join(process.cwd(), rel);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    // PNG IHDR width/height are big-endian uint32 at byte offsets 16 and 20.
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { data: `data:image/png;base64,${buf.toString("base64")}`, w, h };
  } catch {
    return null;
  }
}

export function renderLetter(blocks: LetterBlock[]): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  const FOOTER_START = 215; // stay above the letterhead's footer band

  const letterhead = loadImage("public/letterhead.png");
  const signatureImg = loadImage("assets/letter-assets/signature.png");
  const stampImg = loadImage("assets/letter-assets/stamp.png");
  const contentTop = letterhead ? 70 : 45;

  const drawLetterhead = () => {
    if (letterhead) {
      doc.addImage(letterhead.data, "PNG", 0, 0, pageWidth, pageHeight, "letterhead", "FAST");
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

  const ensure = (need: number) => {
    if (y + need > FOOTER_START) {
      doc.addPage();
      drawLetterhead();
      y = contentTop;
    }
  };

  const para = (
    text: string,
    o: { bold?: boolean; size?: number; lh?: number; gap?: number } = {}
  ) => {
    const size = o.size ?? 9.5;
    const lh = o.lh ?? 4.6;
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(30, 30, 30);
    for (const ln of doc.splitTextToSize(text, contentWidth) as string[]) {
      ensure(lh);
      doc.text(ln, margin, y);
      y += lh;
    }
    y += o.gap ?? 2.2;
  };

  // Fit an image into a max width/height box, preserving its aspect ratio.
  const fit = (img: LoadedImage, maxW: number, maxH: number) => {
    let w = maxW;
    let h = (w * img.h) / img.w;
    if (h > maxH) {
      h = maxH;
      w = (h * img.w) / img.h;
    }
    return { w, h };
  };

  const signoff = (name: string, title: string) => {
    // Keep the whole signatory block together on one page.
    ensure(40);
    const top = y;
    let usedH = 0;
    // Company stamp first (underneath), then the signature drawn ON TOP,
    // overlapping and centred over the stamp — like a real stamped-and-signed
    // document. Both are drawn at their true aspect ratio (no stretching).
    let stampBox: { x: number; y: number; w: number; h: number } | null = null;
    if (stampImg) {
      const s = fit(stampImg, 54, 26);
      doc.addImage(stampImg.data, "PNG", margin, top, s.w, s.h, "stamp", "FAST");
      stampBox = { x: margin, y: top, w: s.w, h: s.h };
      usedH = s.h;
    }
    if (signatureImg) {
      const g = fit(signatureImg, 48, 22);
      const sx = stampBox ? stampBox.x + (stampBox.w - g.w) / 2 : margin;
      const sy = stampBox ? stampBox.y + (stampBox.h - g.h) / 2 : top;
      doc.addImage(signatureImg.data, "PNG", sx, sy, g.w, g.h, "sig", "FAST");
      usedH = Math.max(usedH, sy + g.h - top);
    }

    if (usedH > 0) {
      y = top + usedH + 3;
    } else {
      y = top + 2;
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(0.3);
      doc.line(margin, y, margin + 55, y);
      y += 4;
    }
    ensure(5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(name, margin, y);
    y += 4.5;
    ensure(5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(title, margin, y);
    y += 6;
  };

  for (const b of blocks) {
    switch (b.type) {
      case "title": {
        ensure(14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(0, 0, 0);
        doc.text(b.text, pageWidth / 2, y, { align: "center" });
        y += 4;
        doc.setDrawColor(34, 120, 50);
        doc.setLineWidth(0.4);
        const half = Math.min(80, doc.getTextWidth(b.text) / 2 + 6);
        doc.line(pageWidth / 2 - half, y, pageWidth / 2 + half, y);
        y += 8;
        break;
      }
      case "heading":
        para(b.text, { bold: true, size: 10, gap: 1 });
        break;
      case "paragraph":
        para(b.text, { gap: 2.5 });
        break;
      case "lines": {
        // Keep the whole block together — never orphan lines across a page break.
        const blockH = b.lines.reduce((h, ln) => h + (ln === "" ? 4 : 5.2), 0) + 1;
        ensure(blockH);
        doc.setFont("helvetica", b.bold ? "bold" : "normal");
        doc.setFontSize(b.size ?? 9.5);
        doc.setTextColor(20, 20, 20);
        for (const ln of b.lines) {
          if (ln === "") {
            y += 4;
            continue;
          }
          ensure(5.5);
          doc.text(ln, margin, y);
          y += 5.2;
        }
        y += 1;
        break;
      }
      case "gap":
        y += b.mm;
        break;
      case "rule": {
        ensure(4);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
        break;
      }
      case "signoff":
        signoff(b.name, b.title);
        break;
    }
  }

  return doc;
}
