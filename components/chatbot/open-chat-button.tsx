"use client";

import type { PropsWithChildren } from "react";

/**
 * Opens the global ChatWidget floating panel. The widget itself
 * (components/chatbot/chat-widget.tsx) is mounted in app/layout.tsx
 * and already listens for a `toggle-chat` window event — this button
 * just dispatches it.
 *
 * Replaces the old `<Link href="/chat">` pattern that 404'd because
 * there's no /chat route; the assistant is a floating widget, not a
 * dedicated page. Keeping it as the widget (rather than building a
 * /chat page) preserves the cross-page chat history and stays in
 * step with how the mobile app exposes the same assistant.
 *
 * The button has no built-in styling so callers control the look —
 * accepts `className` + children so we can drop it in wherever the
 * old <Link> sat without touching layouts.
 */
export function OpenChatButton({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("toggle-chat"));
        }
      }}
    >
      {children}
    </button>
  );
}
