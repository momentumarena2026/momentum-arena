"use client";

import { trackChatWidgetOpened } from "@/lib/analytics";

export function ChatNavButton() {
  return (
    <button
      onClick={() => {
        trackChatWidgetOpened();
        window.dispatchEvent(new CustomEvent("toggle-chat"));
      }}
      className="flex flex-col items-center gap-0.5 text-zinc-400 hover:text-emerald-400 transition"
    >
      <span className="text-lg">💬</span>
      <span className="text-[10px] font-medium">Chat</span>
    </button>
  );
}
