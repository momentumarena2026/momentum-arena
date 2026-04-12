"use client";

import { useRouter } from "next/navigation";
import { QrScanner } from "./qr-scanner";

export function ScannerWrapper() {
  const router = useRouter();

  const handleScan = (token: string) => {
    router.push(`/admin/checkin?token=${encodeURIComponent(token)}`);
  };

  return <QrScanner onScan={handleScan} />;
}
