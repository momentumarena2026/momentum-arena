"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, HelpCircle, ExternalLink } from "lucide-react";
import { searchFAQ, getFallbackResponse } from "@/lib/faq-search";
import { FAQ_CATEGORIES } from "@/lib/faq-data";
import Link from "next/link";

interface Message {
  id: string;
  role: "user" | "bot";
  content: string;
  faqResults?: { question: string; answer: string }[];
}

const QUICK_SUGGESTIONS = [
  "How do I book?",
  "What sports are available?",
  "Pricing info",
  "Payment methods",
  "Operating hours",
  "Location & contact",
];

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "bot",
      content: "Hi! I'm the Momentum Arena assistant. Ask me anything about bookings, sports, pricing, or our facility. You can also try the quick topics below!",
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (text?: string) => {
    const query = text || input.trim();
    if (!query) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: query,
    };

    const results = searchFAQ(query, 3);

    const botMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: "bot",
      content:
        results.length > 0
          ? `I found ${results.length} relevant answer${results.length > 1 ? "s" : ""}:`
          : getFallbackResponse(),
      faqResults: results.length > 0
        ? results.map((r) => ({ question: r.question, answer: r.answer }))
        : undefined,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInput("");
  };

  return (
    <>
      {/* Floating Bubble */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 md:bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 shadow-lg shadow-emerald-900/30 transition-all hover:bg-emerald-700 hover:scale-110"
          aria-label="Open FAQ chat"
        >
          <MessageCircle className="h-6 w-6 text-white" />
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-20 md:bottom-6 right-6 z-40 flex h-[500px] w-[360px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 sm:w-[380px]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-emerald-500/20 p-1.5">
                <HelpCircle className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">FAQ Assistant</p>
                <p className="text-[10px] text-zinc-500">Momentum Arena</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href="/faq"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                title="View all FAQs"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-emerald-600 text-white rounded-br-md"
                      : "bg-zinc-800 text-zinc-300 rounded-bl-md"
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.content}</p>
                  {msg.faqResults && (
                    <div className="mt-2 space-y-2">
                      {msg.faqResults.map((faq, i) => (
                        <details
                          key={i}
                          className="rounded-lg border border-zinc-700 bg-zinc-900/50"
                        >
                          <summary className="cursor-pointer p-2 text-xs font-medium text-emerald-400 hover:text-emerald-300">
                            {faq.question}
                          </summary>
                          <p className="border-t border-zinc-700/50 p-2 text-xs text-zinc-400 whitespace-pre-line">
                            {faq.answer}
                          </p>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions (only show at start) */}
          {messages.length <= 1 && (
            <div className="border-t border-zinc-800/50 px-4 py-2">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-emerald-500/30 hover:text-emerald-400 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-zinc-800 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask a question..."
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="rounded-xl bg-emerald-600 p-2 text-white hover:bg-emerald-700 disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
