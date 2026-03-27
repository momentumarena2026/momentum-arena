import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";

const COMPANY = {
  name: "SPORTIVE VENTURES",
  brand: "MOMENTUM ARENA",
  gstin: "09AFWFS2503M1ZB",
  address:
    "Khasra no. 293/5, Mouja Ganeshra, Radhapuram Road, Mathura, UP, 281004",
  phone: "+91 63961 77261",
  email: "momentumarena2026@gmail.com",
};

const GST_RATE = 18;

function formatPriceInv(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function numberToWords(num: number): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  if (num === 0) return "Zero";

  function convert(n: number): string {
    if (n < 20) return ones[n];
    if (n < 100)
      return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000)
      return (
        ones[Math.floor(n / 100)] +
        " Hundred" +
        (n % 100 ? " and " + convert(n % 100) : "")
      );
    if (n < 100000)
      return (
        convert(Math.floor(n / 1000)) +
        " Thousand" +
        (n % 1000 ? " " + convert(n % 1000) : "")
      );
    if (n < 10000000)
      return (
        convert(Math.floor(n / 100000)) +
        " Lakh" +
        (n % 100000 ? " " + convert(n % 100000) : "")
      );
    return (
      convert(Math.floor(n / 10000000)) +
      " Crore" +
      (n % 10000000 ? " " + convert(n % 10000000) : "")
    );
  }

  return convert(num) + " Rupees Only";
}

// Generate HMAC token for guest invoice access
function generateInvoiceToken(orderId: string): string {
  const crypto = require("crypto");
  const secret = process.env.AUTH_SECRET || "invoice-secret";
  return crypto.createHmac("sha256", secret).update(`cafe-invoice:${orderId}`).digest("hex").slice(0, 16);
}

export { generateInvoiceToken as generateCafeInvoiceToken };

export async function GET(request: Request) {
  const session = await auth();

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");
  const token = searchParams.get("token");

  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const order = await db.cafeOrder.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      items: true,
      payment: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Auth: guest orders need a valid token, logged-in users need to be owner or admin
  const isOwner = session?.user?.id && order.userId === session.user.id;
  const isAdmin = (session?.user as { userType?: string })?.userType === "admin";
  const isValidGuestToken = !order.userId && token === generateInvoiceToken(orderId);

  if (!isOwner && !isAdmin && !isValidGuestToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Generate PDF
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
    // Letterhead not found
  }

  if (letterheadImage) {
    doc.addImage(letterheadImage, "PNG", 0, 0, pageWidth, pageHeight);
  } else {
    // Text-based letterhead
    doc.setFillColor(34, 120, 50);
    doc.rect(0, 0, pageWidth, 35, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(COMPANY.name, pageWidth / 2, 12, { align: "center" });
    doc.setFontSize(20);
    doc.text(COMPANY.brand, pageWidth / 2, 22, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`GSTIN: ${COMPANY.gstin}`, pageWidth / 2, 30, {
      align: "center",
    });

    // Footer
    doc.setFillColor(34, 120, 50);
    doc.rect(0, pageHeight - 25, pageWidth, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text(COMPANY.phone, pageWidth - margin, pageHeight - 18, {
      align: "right",
    });
    doc.text(COMPANY.email, pageWidth - margin, pageHeight - 13, {
      align: "right",
    });
    doc.text(COMPANY.address, pageWidth - margin, pageHeight - 8, {
      align: "right",
    });
  }

  // Invoice content
  const contentTop = letterheadImage ? 70 : 45;
  let y = contentTop;

  // Title
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("TAX INVOICE", pageWidth / 2, y, { align: "center" });
  y += 10;

  // Invoice details
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);

  const invoiceDate = order.payment?.confirmedAt || order.createdAt;
  const invoiceNo = `MA-CAFE-INV-${order.orderNumber}`;

  doc.text(`Invoice No: ${invoiceNo}`, margin, y);
  doc.text(
    `Date: ${invoiceDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
    pageWidth - margin,
    y,
    { align: "right" }
  );
  y += 8;

  // Divider
  doc.setDrawColor(34, 120, 50);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Bill To
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Bill To:", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  if (order.user) {
    doc.text(order.user.name || "Customer", margin, y);
    y += 4;
    if (order.user.email) {
      doc.text(order.user.email, margin, y);
      y += 4;
    }
    if (order.user.phone) {
      doc.text(order.user.phone, margin, y);
      y += 4;
    }
  } else {
    doc.text(order.guestName || "Walk-in Guest", margin, y);
    y += 4;
    if (order.guestPhone) {
      doc.text(order.guestPhone, margin, y);
      y += 4;
    }
  }
  y += 4;

  // From section (right side)
  const fromY = contentTop + 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("From:", pageWidth / 2 + 10, fromY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(COMPANY.brand, pageWidth / 2 + 10, fromY + 5);
  doc.text(`GSTIN: ${COMPANY.gstin}`, pageWidth / 2 + 10, fromY + 9);
  doc.text("Khasra no. 293/5, Mouja Ganeshra", pageWidth / 2 + 10, fromY + 13);
  doc.text("Radhapuram Road, Mathura, UP 281004", pageWidth / 2 + 10, fromY + 17);

  // Order details
  y += 4;
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y, contentWidth, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Order Details", margin + 3, y + 5);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const details = [
    ["Order Number", order.orderNumber],
    ["Payment Method", order.payment?.method?.replace("_", " ") || "N/A"],
    ["Payment ID", order.payment?.razorpayPaymentId || "N/A"],
  ];

  for (const [label, value] of details) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), margin + 35, y);
    y += 5;
  }
  y += 5;

  // Items table header
  doc.setFillColor(34, 120, 50);
  doc.rect(margin, y, contentWidth, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);

  const colX = {
    sno: margin + 3,
    desc: margin + 15,
    qty: margin + 100,
    rate: margin + 120,
    amount: margin + 150,
  };

  doc.text("S.No", colX.sno, y + 5.5);
  doc.text("Item", colX.desc, y + 5.5);
  doc.text("Qty", colX.qty, y + 5.5);
  doc.text("Rate", colX.rate, y + 5.5);
  doc.text("Amount", colX.amount, y + 5.5);
  y += 10;

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");

  order.items.forEach((item, index) => {
    doc.text(String(index + 1), colX.sno, y + 4);
    doc.text(item.itemName, colX.desc, y + 4);
    doc.text(String(item.quantity), colX.qty, y + 4);
    doc.text(formatPriceInv(item.unitPrice), colX.rate, y + 4);
    doc.text(formatPriceInv(item.totalPrice), colX.amount, y + 4);
    y += 6;
  });

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // GST calculation (inclusive of 18% GST)
  const totalAmountPaise = order.totalAmount;
  const baseAmountPaise = Math.round(totalAmountPaise / 1.18);
  const cgstPaise = Math.round((totalAmountPaise - baseAmountPaise) / 2);
  const sgstPaise = totalAmountPaise - baseAmountPaise - cgstPaise;

  const discountPaise = order.discountAmount || 0;
  const originalPaise =
    order.originalAmount || totalAmountPaise + discountPaise;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rightCol = pageWidth - margin;
  const labelCol = rightCol - 45;

  if (discountPaise > 0) {
    doc.text("Subtotal:", labelCol, y);
    doc.text(formatPriceInv(originalPaise), rightCol, y, { align: "right" });
    y += 5;
    doc.text("Discount:", labelCol, y);
    doc.setTextColor(220, 50, 50);
    doc.text(`- ${formatPriceInv(discountPaise)}`, rightCol, y, {
      align: "right",
    });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  doc.text("Taxable Amount:", labelCol, y);
  doc.text(formatPriceInv(baseAmountPaise), rightCol, y, { align: "right" });
  y += 5;

  doc.text(`CGST (${GST_RATE / 2}%):`, labelCol, y);
  doc.text(formatPriceInv(cgstPaise), rightCol, y, { align: "right" });
  y += 5;

  doc.text(`SGST (${GST_RATE / 2}%):`, labelCol, y);
  doc.text(formatPriceInv(sgstPaise), rightCol, y, { align: "right" });
  y += 5;

  // Total
  doc.setDrawColor(34, 120, 50);
  doc.setLineWidth(0.5);
  doc.line(labelCol - 5, y, rightCol, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total:", labelCol, y);
  doc.text(formatPriceInv(totalAmountPaise), rightCol, y, { align: "right" });
  y += 8;

  // Amount in words
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(80, 80, 80);
  const totalRupees = Math.round(totalAmountPaise / 100);
  doc.text(`Amount in words: ${numberToWords(totalRupees)}`, margin, y);
  y += 6;

  // Terms
  const footerStart = letterheadImage ? 215 : pageHeight - 30;
  const termsY = Math.min(y + 3, footerStart - 20);

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, termsY, pageWidth / 2 + 20, termsY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text("Terms & Conditions:", margin, termsY + 3.5);
  doc.setFont("helvetica", "normal");
  doc.text(
    "1. Computer-generated invoice. No signature required.",
    margin,
    termsY + 6.5
  );
  doc.text(
    "2. All prices inclusive of 18% GST (9% CGST + 9% SGST).",
    margin,
    termsY + 9.5
  );
  doc.text(
    "3. No refund on cafe orders once prepared.",
    margin,
    termsY + 12.5
  );

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice-${invoiceNo}.pdf"`,
    },
  });
}
