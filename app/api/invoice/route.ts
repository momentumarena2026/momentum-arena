import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsPDF } from "jspdf";
import { formatHour, SPORT_INFO, SIZE_INFO } from "@/lib/court-config";
import fs from "fs";
import path from "path";

// Company details for letterhead
const COMPANY = {
  name: "SPORTIVE VENTURES",
  brand: "MOMENTUM ARENA",
  gstin: "09AFWFS2503M1ZB",
  address: "Khasra no. 293/5, Mouja Ganeshra, Radhapuram Road, Mathura, UP, 281004",
  phone: "+91 63961 77261",
  email: "momentumarena2026@gmail.com",
};

const GST_RATE = 18; // 18% GST inclusive

function formatPrice(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function numberToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  if (num === 0) return "Zero";

  function convert(n: number): string {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + convert(n % 100) : "");
    if (n < 100000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
    if (n < 10000000) return convert(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + convert(n % 100000) : "");
    return convert(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + convert(n % 10000000) : "");
  }

  return convert(num) + " Rupees Only";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get("bookingId");

  if (!bookingId) {
    return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: true,
      courtConfig: true,
      slots: { orderBy: { startHour: "asc" } },
      payment: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  // Only allow the booking owner or admin to download
  if (booking.userId !== session.user.id && session.user.userType !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Only generate invoice for confirmed bookings with completed payment
  if (booking.status !== "CONFIRMED" || booking.payment?.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "Invoice only available for confirmed bookings with completed payment" },
      { status: 400 }
    );
  }

  // --- Generate PDF ---
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // Try to load the letterhead image
  let letterheadImage: string | null = null;
  try {
    const imagePath = path.join(process.cwd(), "public", "letterhead.png");
    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      letterheadImage = `data:image/png;base64,${imageBuffer.toString("base64")}`;
    }
  } catch {
    // Letterhead image not found, use text-based header
  }

  if (letterheadImage) {
    // Full-page letterhead background
    doc.addImage(letterheadImage, "PNG", 0, 0, pageWidth, pageHeight);
  } else {
    // Text-based letterhead header
    doc.setFillColor(34, 120, 50); // Green
    doc.rect(0, 0, pageWidth, 35, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(COMPANY.name, pageWidth / 2, 12, { align: "center" });

    doc.setFontSize(20);
    doc.text(COMPANY.brand, pageWidth / 2, 22, { align: "center" });

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`GSTIN: ${COMPANY.gstin}`, pageWidth / 2, 30, { align: "center" });

    // Footer
    doc.setFillColor(34, 120, 50);
    doc.rect(0, pageHeight - 25, pageWidth, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text(COMPANY.phone, pageWidth - margin, pageHeight - 18, { align: "right" });
    doc.text(COMPANY.email, pageWidth - margin, pageHeight - 13, { align: "right" });
    doc.text(COMPANY.address, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  // --- Invoice Content ---
  const contentTop = letterheadImage ? 70 : 45;
  let y = contentTop;

  // Invoice title
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("TAX INVOICE", pageWidth / 2, y, { align: "center" });
  y += 10;

  // Invoice details row
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);

  const invoiceDate = booking.payment?.confirmedAt || booking.createdAt;
  const invoiceNo = `MA-${booking.id.slice(-8).toUpperCase()}`;

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

  // Bill To section
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Bill To:", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(booking.user.name || "Customer", margin, y);
  y += 4;
  if (booking.user.email) {
    doc.text(booking.user.email, margin, y);
    y += 4;
  }
  if (booking.user.phone) {
    doc.text(booking.user.phone, margin, y);
    y += 4;
  }
  y += 4;

  // From section (right side)
  const fromY = contentTop + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("From:", pageWidth / 2 + 10, fromY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(COMPANY.brand, pageWidth / 2 + 10, fromY + 5);
  doc.text(`GSTIN: ${COMPANY.gstin}`, pageWidth / 2 + 10, fromY + 9);
  doc.text("Khasra no. 293/5, Mouja Ganeshra", pageWidth / 2 + 10, fromY + 13);
  doc.text("Radhapuram Road, Mathura, UP 281004", pageWidth / 2 + 10, fromY + 17);

  // Booking details
  y += 4;
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y, contentWidth, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Booking Details", margin + 3, y + 5);
  y += 12;

  const sportInfo = SPORT_INFO[booking.courtConfig.sport as keyof typeof SPORT_INFO];
  const sizeInfo = SIZE_INFO[booking.courtConfig.size as keyof typeof SIZE_INFO];
  const bookingDate = booking.date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const slotTimes = booking.slots.map((s) => formatHour(s.startHour)).join(", ");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const details = [
    ["Booking ID", booking.id],
    ["Sport", sportInfo?.name || booking.courtConfig.sport],
    ["Court", `${booking.courtConfig.label} (${sizeInfo?.name || booking.courtConfig.size})`],
    ["Date", bookingDate],
    ["Time Slots", slotTimes],
    ["Payment Method", booking.payment?.method?.replace("_", " ") || "N/A"],
    ["Payment ID", booking.payment?.razorpayPaymentId || "N/A"],
  ];

  for (const [label, value] of details) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), margin + 35, y);
    y += 5;
  }
  y += 5;

  // --- Items Table ---
  doc.setFillColor(34, 120, 50);
  doc.rect(margin, y, contentWidth, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);

  const colX = {
    sno: margin + 3,
    desc: margin + 15,
    hrs: margin + 100,
    rate: margin + 120,
    amount: margin + 150,
  };

  doc.text("S.No", colX.sno, y + 5.5);
  doc.text("Description", colX.desc, y + 5.5);
  doc.text("Hours", colX.hrs, y + 5.5);
  doc.text("Rate", colX.rate, y + 5.5);
  doc.text("Amount", colX.amount, y + 5.5);
  y += 10;

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");

  booking.slots.forEach((slot, index) => {
    const slotDesc = `${sportInfo?.name || booking.courtConfig.sport} - ${booking.courtConfig.label} (${formatHour(slot.startHour)})`;
    doc.text(String(index + 1), colX.sno, y + 4);
    doc.text(slotDesc, colX.desc, y + 4);
    doc.text("1", colX.hrs, y + 4);
    doc.text(formatPrice(slot.price), colX.rate, y + 4);
    doc.text(formatPrice(slot.price), colX.amount, y + 4);
    y += 6;
  });

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // --- GST Calculation ---
  // Total is inclusive of 18% GST
  const totalAmountPaise = booking.totalAmount;
  const baseAmountPaise = Math.round(totalAmountPaise / 1.18);
  const cgstPaise = Math.round((totalAmountPaise - baseAmountPaise) / 2);
  const sgstPaise = totalAmountPaise - baseAmountPaise - cgstPaise;

  const discountPaise = booking.discountAmount || 0;
  const originalPaise = booking.originalAmount || totalAmountPaise + discountPaise;

  // Subtotal
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rightCol = pageWidth - margin;
  const labelCol = rightCol - 45;

  if (discountPaise > 0) {
    doc.text("Subtotal:", labelCol, y);
    doc.text(formatPrice(originalPaise), rightCol, y, { align: "right" });
    y += 5;
    doc.text(`Discount:`, labelCol, y);
    doc.setTextColor(220, 50, 50);
    doc.text(`- ${formatPrice(discountPaise)}`, rightCol, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  doc.text("Taxable Amount:", labelCol, y);
  doc.text(formatPrice(baseAmountPaise), rightCol, y, { align: "right" });
  y += 5;

  doc.text(`CGST (${GST_RATE / 2}%):`, labelCol, y);
  doc.text(formatPrice(cgstPaise), rightCol, y, { align: "right" });
  y += 5;

  doc.text(`SGST (${GST_RATE / 2}%):`, labelCol, y);
  doc.text(formatPrice(sgstPaise), rightCol, y, { align: "right" });
  y += 5;

  // Total
  doc.setDrawColor(34, 120, 50);
  doc.setLineWidth(0.5);
  doc.line(labelCol - 5, y, rightCol, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total:", labelCol, y);
  doc.text(formatPrice(totalAmountPaise), rightCol, y, { align: "right" });
  y += 8;

  // Amount in words
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(80, 80, 80);
  const totalRupees = Math.round(totalAmountPaise / 100);
  doc.text(`Amount in words: ${numberToWords(totalRupees)}`, margin, y);
  y += 10;

  // Partial payment info
  if (booking.payment?.isPartialPayment) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`Advance Paid: ${formatPrice(booking.payment.advanceAmount || 0)}`, margin, y);
    y += 5;
    doc.text(`Due at Venue: ${formatPrice(booking.payment.remainingAmount || 0)}`, margin, y);
    y += 8;
  }

  // Terms
  y += 5;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text("Terms & Conditions:", margin, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("1. This is a computer-generated invoice and does not require a signature.", margin, y);
  y += 3.5;
  doc.text("2. All prices are inclusive of 18% GST (9% CGST + 9% SGST).", margin, y);
  y += 3.5;
  doc.text("3. Cancellation and refund policies apply as per Momentum Arena's terms.", margin, y);

  // Generate PDF buffer
  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice-${invoiceNo}.pdf"`,
    },
  });
}
