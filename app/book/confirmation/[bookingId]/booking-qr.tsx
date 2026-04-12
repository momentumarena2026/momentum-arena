"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface BookingQRProps {
  qrToken: string;
  bookingId: string;
}

export function BookingQR({ qrToken, bookingId }: BookingQRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const url = `${baseUrl}/admin/checkin?token=${qrToken}`;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 180,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  }, [qrToken]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
        Check-in QR Code
      </p>
      <div className="flex justify-center">
        <div className="rounded-lg bg-white p-2 inline-block">
          <canvas ref={canvasRef} />
        </div>
      </div>
      <p className="text-xs text-zinc-500 mt-3">
        Show this QR code to staff at arrival
      </p>
      <p className="text-xs text-zinc-600 mt-1">
        Booking: {bookingId.slice(-8).toUpperCase()}
      </p>
    </div>
  );
}
