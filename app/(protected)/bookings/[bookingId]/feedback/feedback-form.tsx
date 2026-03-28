"use client";

import { useState } from "react";
import { submitFeedback } from "@/actions/feedback";
import { Star, Loader2 } from "lucide-react";

const TAGS = [
  "Great Court",
  "Clean Facilities",
  "Good Lighting",
  "Friendly Staff",
  "Smooth Booking",
  "Will Return",
  "Great Value",
  "Well Maintained",
];

interface FeedbackFormProps {
  bookingId: string;
}

export function FeedbackForm({ bookingId }: FeedbackFormProps) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleSubmit() {
    if (!rating) { setError("Please select a rating"); return; }
    setLoading(true);
    setError("");
    const result = await submitFeedback({ bookingId, rating, comment, tags });
    if (result.success) {
      setSubmitted(true);
    } else {
      setError(result.error || "Failed to submit");
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <div className="text-center py-12 space-y-3">
        <div className="text-5xl">🎉</div>
        <h2 className="text-xl font-bold text-white">Thanks for your feedback!</h2>
        <p className="text-zinc-400">Your review helps us improve Momentum Arena.</p>
        <div className="flex justify-center gap-1 mt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`h-6 w-6 ${i < rating ? "text-yellow-400 fill-yellow-400" : "text-zinc-600"}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Star rating */}
      <div>
        <p className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Overall Rating
        </p>
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => {
            const val = i + 1;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setRating(val)}
                onMouseEnter={() => setHovered(val)}
                onMouseLeave={() => setHovered(0)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  className={`h-10 w-10 transition-colors ${
                    val <= (hovered || rating)
                      ? "text-yellow-400 fill-yellow-400"
                      : "text-zinc-600"
                  }`}
                />
              </button>
            );
          })}
        </div>
        {rating > 0 && (
          <p className="text-sm text-zinc-400 mt-1">
            {["", "Poor", "Fair", "Good", "Great", "Excellent!"][rating]}
          </p>
        )}
      </div>

      {/* Tags */}
      <div>
        <p className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          What went well? (optional)
        </p>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
                tags.includes(tag)
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Comment */}
      <div>
        <p className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Additional comments (optional)
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Tell us about your experience..."
          className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !rating}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 transition-colors"
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
        ) : (
          "Submit Feedback"
        )}
      </button>
    </div>
  );
}
