"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageCircle,
  X,
  Send,
  Sparkles,
  ExternalLink,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import {
  processMessage,
  createInitialContext,
  type ChatMessage,
} from "@/lib/chat-engine";

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hey! 👋 I'm the Momentum Arena assistant. I can help with bookings, pricing, sports, timings — anything about our facility. What would you like to know?",
  suggestions: [
    "How to book?",
    "Sports available",
    "Pricing info",
    "Operating hours",
    "Location",
    "Help",
  ],
  timestamp: Date.now(),
};

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [context, setContext] = useState(createInitialContext);
  const [hasUnread, setHasUnread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = useCallback(
    (text?: string) => {
      const query = (text || input).trim();
      if (!query) return;

      // Add user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: query,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsTyping(true);

      // Simulate typing delay for natural feel (200-600ms)
      const delay = Math.min(200 + query.length * 10, 600);

      setTimeout(() => {
        const { response, updatedContext } = processMessage(query, context);
        setContext(updatedContext);
        setMessages((prev) => [...prev, response]);
        setIsTyping(false);

        if (!isOpen) setHasUnread(true);
      }, delay);
    },
    [input, context, isOpen]
  );

  const handleReset = () => {
    setMessages([WELCOME_MESSAGE]);
    setContext(createInitialContext());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format markdown-like bold text
  const formatContent = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <>
      {/* Floating Bubble */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40 transition-all hover:scale-110 hover:shadow-emerald-900/60 active:scale-95"
          aria-label="Open chat assistant"
        >
          <MessageCircle className="h-6 w-6 text-white" />
          {hasUnread && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-black bg-red-500" />
          )}
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(550px,85vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 animate-in slide-in-from-bottom-4 fade-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-900/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 ring-1 ring-emerald-500/20">
                  <Sparkles className="h-4.5 w-4.5 text-emerald-400" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 bg-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  Arena Assistant
                </p>
                <p className="text-[10px] text-emerald-500/80">
                  Always online • Free
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleReset}
                className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                title="New conversation"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <Link
                href="/faq"
                className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                title="View all FAQs"
                onClick={() => setIsOpen(false)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-thin">
            {messages.map((msg) => (
              <div key={msg.id}>
                <div
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`relative max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-emerald-600 text-white rounded-br-md"
                        : "bg-zinc-800/80 text-zinc-300 rounded-bl-md border border-zinc-700/50"
                    }`}
                  >
                    <div className="whitespace-pre-line">
                      {msg.role === "assistant"
                        ? formatContent(msg.content)
                        : msg.content}
                    </div>
                  </div>
                </div>

                {/* Quick Actions (links) */}
                {msg.quickActions && msg.quickActions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                    {msg.quickActions.map((action) => (
                      <Link
                        key={action.href}
                        href={action.href}
                        onClick={() => setIsOpen(false)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 hover:border-emerald-500/40"
                      >
                        {action.label}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Suggestions */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                    {msg.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSend(s)}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/60 bg-zinc-800/40 px-2.5 py-1 text-[11px] text-zinc-400 transition-all hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        {s}
                        <ArrowRight className="h-2.5 w-2.5 opacity-50" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-zinc-700/50 bg-zinc-800/80 px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about Momentum Arena..."
                className="flex-1 rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                disabled={isTyping}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isTyping}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-all hover:bg-emerald-700 disabled:opacity-30 disabled:hover:bg-emerald-600 active:scale-95"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[9px] text-zinc-600">
              Powered by Momentum Arena • Instant answers, always free
            </p>
          </div>
        </div>
      )}
    </>
  );
}
