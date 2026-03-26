"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ChatWidget = dynamic(
  () => import("./chat-widget").then((m) => ({ default: m.ChatWidget })),
  { ssr: false }
);

const HIDDEN_PATHS = ["/checkout", "/confirmation", "/godmode"];

export function ChatWidgetWrapper() {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Hide on checkout, confirmation, admin pages
  const shouldHide = HIDDEN_PATHS.some((p) => pathname.includes(p));
  if (shouldHide) return null;

  // Mobile: only show on homepage
  if (isMobile && pathname !== "/") return null;

  return <ChatWidget />;
}
