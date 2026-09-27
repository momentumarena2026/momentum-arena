"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { lineIsEligible } from "@/lib/daily-push-lines";
import {
  deleteDailyPushLine,
  deleteDailyPushOccasion,
  saveDailyPushLine,
  saveDailyPushOccasion,
  type DailyPushLibraryView,
  type DailyPushLineView,
} from "@/actions/admin-daily-push";

/**
 * The creative library, and the calendar that makes half of it fire.
 *
 * Two things this page has to make obvious, because both are invisible
 * in a plain list of copy:
 *
 *   WHICH LINES CAN RUN TODAY. A tagged line is dormant most of the
 *   year. Showing the whole library undifferentiated makes a venue
 *   think ninety lines are in rotation when eleven are.
 *
 *   WHICH TAGS HAVE NO DATES. A festival line with no window never
 *   fires, silently, forever. That is the one failure nobody would
 *   notice on their own, so it gets a banner rather than a footnote.
 */

const COMMON_TAGS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "weekend", "weekday", "monsoon", "winter", "summer", "pleasant",
  "holi", "janmashtami", "diwali", "ipl", "india-match", "needs-slots",
];

export function LinesClient({ view }: { view: DailyPushLibraryView }) {
  const [editing, setEditing] = useState<DailyPushLineView | "new" | null>(null);
  const [addingOccasion, setAddingOccasion] = useState(false);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const today = new Set(view.todaysOccasions);
  // The SAME predicate the engine uses, rather than a second copy of
  // the logic written against the UI. A page that disagrees with the
  // sender about which lines are live is worse than no page.
  const ctx = { occasions: view.todaysOccasions, slotsAreFree: view.slotsAreFree };
  const canRun = (l: DailyPushLineView) =>
    lineIsEligible({ ...l, lastUsedAt: null }, ctx);
  const eligibleToday = useMemo(
    () => view.lines.filter(canRun).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lines, view.todaysOccasions, view.slotsAreFree],
  );

  const refresh = () => window.location.reload();

  return (
    <div className="space-y-6">
      {/* Today */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Today</h2>
          <span className="text-xs text-zinc-500">
            {eligibleToday} of {view.lines.length} lines can run today
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {view.todaysOccasions.map((t) => (
            <span
              key={t}
              className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300"
            >
              {t}
            </span>
          ))}
        </div>
        {!view.slotsAreFree && (
          <p className="mt-2 text-[11px] text-zinc-600">
            No free evening slots right now, so the lines tagged{" "}
            <span className="text-amber-300">needs-slots</span> are out of play
            today. They come back on an evening with space.
          </p>
        )}
        {view.refusal && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
            {view.refusal}
          </p>
        )}
      </section>

      {view.undatedTags.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            These tags are used by lines but have no dates, so those lines will
            never fire: <strong>{view.undatedTags.join(", ")}</strong>. Holi and
            Janmashtami move every year and there is no fixtures feed, so the
            dates have to be set here rather than guessed in code.
          </span>
        </div>
      )}

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            msg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          {msg.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Occasions */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-white">Occasion dates</h2>
          </div>
          <button
            onClick={() => setAddingOccasion(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        <p className="px-4 pt-3 text-[11px] text-zinc-600">
          Weekdays and seasons are worked out automatically. Only festivals and
          the cricket calendar need dates here.
        </p>
        {view.occasions.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No dates set yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/50">
            {view.occasions.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-white">
                    {o.label}{" "}
                    <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {o.tag}
                    </span>
                    {o.active && (
                      <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        running now
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {o.startsOn} → {o.endsOn}
                  </p>
                </div>
                <button
                  onClick={() =>
                    start(async () => {
                      await deleteDailyPushOccasion(o.id);
                      refresh();
                    })
                  }
                  className="shrink-0 rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                  aria-label={`Delete ${o.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Lines */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">
            Lines <span className="ml-1 text-xs text-zinc-500">{view.lines.length}</span>
          </h2>
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3 w-3" /> New line
          </button>
        </div>
        <ul className="divide-y divide-zinc-800/50">
          {view.lines.map((l) => {
            const runsToday = canRun(l);
            return (
              <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    runsToday ? "bg-emerald-400" : "bg-zinc-700"
                  }`}
                  title={runsToday ? "Can run today" : "Dormant today"}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${l.enabled ? "text-white" : "text-zinc-600 line-through"}`}>
                    {l.title}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">{l.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {l.tags.map((t) => (
                      <span
                        key={t}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          t === "needs-slots"
                            ? "bg-amber-500/10 text-amber-300"
                            : today.has(t)
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {t}
                      </span>
                    ))}
                    <span className="text-[10px] text-zinc-600">
                      {l.useCount === 0
                        ? "never sent"
                        : `sent ${l.useCount}×, last ${l.lastUsedAt?.slice(0, 10)}`}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setEditing(l)}
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                    aria-label={`Edit ${l.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      start(async () => {
                        const r = await deleteDailyPushLine(l.id);
                        if (r.ok) refresh();
                        else setMsg({ ok: false, text: r.error ?? "Could not delete." });
                      })
                    }
                    className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                    aria-label={`Delete ${l.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {editing && (
        <LineEditor
          line={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            start(async () => {
              const r = await saveDailyPushLine(input);
              if (r.ok) refresh();
              else setMsg({ ok: false, text: r.error });
            })
          }
        />
      )}

      {addingOccasion && (
        <OccasionEditor
          busy={busy}
          onClose={() => setAddingOccasion(false)}
          onSave={(input) =>
            start(async () => {
              const r = await saveDailyPushOccasion(input);
              if (r.ok) refresh();
              else setMsg({ ok: false, text: r.error });
            })
          }
        />
      )}
    </div>
  );
}

function LineEditor({
  line,
  busy,
  onClose,
  onSave,
}: {
  line: DailyPushLineView | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    id?: string;
    title: string;
    body: string;
    tags: string[];
    enabled: boolean;
  }) => void;
}) {
  const [title, setTitle] = useState(line?.title ?? "");
  const [body, setBody] = useState(line?.body ?? "");
  const [tags, setTags] = useState<string[]>(line?.tags ?? []);
  const [enabled, setEnabled] = useState(line?.enabled ?? true);

  const toggle = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <Sheet title={line ? "Edit line" : "New line"} onClose={onClose}>
      <label className="block">
        <span className="text-[11px] font-medium text-zinc-500">
          Title <span className="text-zinc-600">· a lock screen shows ~40 characters</span>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        />
        <span className="mt-0.5 block text-right text-[10px] text-zinc-600">{title.length}/60</span>
      </label>

      <label className="block">
        <span className="text-[11px] font-medium text-zinc-500">Body</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={200}
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        />
        <span className="mt-0.5 block text-right text-[10px] text-zinc-600">{body.length}/200</span>
      </label>

      <div>
        <span className="text-[11px] font-medium text-zinc-500">
          Tags <span className="text-zinc-600">· none means it can run any day</span>
        </span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {COMMON_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                tags.includes(t)
                  ? t === "needs-slots"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                  : "border-zinc-800 text-zinc-500 hover:bg-zinc-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tags.includes("needs-slots") && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
            This line claims the evening has space, so it only goes out when
            courts are genuinely free. Use it for any wording that promises
            availability.
          </p>
        )}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-emerald-600"
        />
        <span className="text-sm text-zinc-300">In rotation</span>
      </label>

      <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600">Lock screen</p>
        <p className="mt-1 text-sm font-semibold text-white">{title || "Title"}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{body || "Body"}</p>
      </div>

      <button
        onClick={() => onSave({ id: line?.id, title, body, tags, enabled })}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save
      </button>
    </Sheet>
  );
}

function OccasionEditor({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (input: { tag: string; label: string; startsOn: string; endsOn: string }) => void;
}) {
  const [tag, setTag] = useState("holi");
  const [label, setLabel] = useState("Holi");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  return (
    <Sheet title="Add occasion dates" onClose={onClose}>
      <p className="text-[11px] text-zinc-500">
        Set the window a tag is live for. Holi and Janmashtami are lunar and move
        every year, so they are entered rather than computed.
      </p>
      <label className="block">
        <span className="text-[11px] font-medium text-zinc-500">Tag</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="holi"
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium text-zinc-500">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-medium text-zinc-500">From</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-zinc-500">To</span>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
        </label>
      </div>
      <button
        onClick={() => onSave({ tag, label, startsOn, endsOn })}
        disabled={busy || !startsOn || !endsOn}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save
      </button>
    </Sheet>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-950 p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}
