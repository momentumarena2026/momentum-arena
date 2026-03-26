"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const ChatWidget = dynamic(
  () => import("./chat-widget").then((m) => ({ default: m.ChatWidget })),
  { ssr: false }
);

const HIDDEN_PATHS = ["/checkout", "/confirmation", "/godmode"];

export function ChatWidgetWrapper() {
  const pathname = usePathname();

  // Hide chat on checkout, confirmation, and admin pages
  const shouldHide = HIDDEN_PATHS.some((p) => pathname.includes(p));
  if (shouldHide) return null;

  return <ChatWidget />;
}
