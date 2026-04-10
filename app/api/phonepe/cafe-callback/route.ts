import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPhonePeStatus } from "@/lib/phonepe";

// PhonePe S2S callback for cafe orders
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base64Response = body.response as string;
    if (!base64Response) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const decoded = JSON.parse(
      Buffer.from(base64Response, "base64").toString("utf-8")
    );
    const merchantTransactionId = decoded?.data?.merchantTransactionId;
    if (!merchantTransactionId) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const status = await checkPhonePeStatus(merchantTransactionId);
    if (!status.success) {
      return NextResponse.json({ success: true });
    }

    const payment = await db.cafePayment.findFirst({
      where: { phonePeMerchantTxnId: merchantTransactionId },
    });
    if (!payment || payment.status === "COMPLETED") {
      return NextResponse.json({ success: true });
    }

    await db.cafePayment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        phonePeTransactionId: status.transactionId,
        confirmedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PhonePe cafe callback error:", error);
    return NextResponse.json({ success: true });
  }
}
