"use client";

import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, Loader2, ScanLine } from "lucide-react";

interface QrScannerProps {
  onScan: (token: string) => void;
}

export function QrScanner({ onScan }: QrScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startScanner = async () => {
    setError("");
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          // Extract token from URL like .../admin/checkin?token=xxx
          try {
            const url = new URL(decodedText);
            const token = url.searchParams.get("token");
            if (token) {
              stopScanner();
              onScan(token);
            } else {
              setError("Invalid QR code — no check-in token found");
            }
          } catch {
            // Not a URL — might be a raw token
            if (decodedText.length > 10) {
              stopScanner();
              onScan(decodedText);
            } else {
              setError("Invalid QR code format");
            }
          }
        },
        () => {
          // QR scan failure callback — ignore (fires on every frame without a QR)
        }
      );

      setScanning(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Camera access denied";
      if (message.includes("NotAllowedError") || message.includes("Permission")) {
        setError("Camera permission denied. Please allow camera access and try again.");
      } else {
        setError(`Could not start camera: ${message}`);
      }
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current?.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
    scannerRef.current = null;
    setScanning(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Scanner viewport */}
      <div className="relative rounded-2xl border border-zinc-800 bg-black overflow-hidden">
        <div
          id="qr-reader"
          ref={containerRef}
          className={`w-full ${scanning ? "min-h-[320px]" : "h-0 overflow-hidden"}`}
        />

        {!scanning && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="rounded-2xl bg-zinc-800/50 p-5 mb-4">
              <ScanLine className="h-12 w-12 text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">
              Scan Check-in QR
            </h2>
            <p className="text-sm text-zinc-500 max-w-xs">
              Point the camera at the customer&apos;s booking QR code to check them in
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 text-center">
          {error}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={scanning ? stopScanner : startScanner}
        className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-semibold text-sm transition-colors ${
          scanning
            ? "border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            : "bg-emerald-600 text-white hover:bg-emerald-700"
        }`}
      >
        {scanning ? (
          <>
            <CameraOff className="h-4 w-4" />
            Stop Scanner
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" />
            Open Camera Scanner
          </>
        )}
      </button>
    </div>
  );
}
