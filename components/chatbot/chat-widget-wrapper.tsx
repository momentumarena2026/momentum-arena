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

  // Hide on checkout, confirmation, admin pages
  const shouldHide = HIDDEN_PATHS.some((p) => pathname.includes(p));
  if (shouldHide) return null;

  // On mobile, the chat widget is triggered via the bottom nav bar's custom event.
  // The widget still needs to render to listen for the event and show the panel.
  // The floating bubble is hidden on mobile inside ChatWidget itself.
  return <ChatWidget />;
}
