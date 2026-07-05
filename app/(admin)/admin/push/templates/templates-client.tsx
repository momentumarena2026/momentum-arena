"use client";

import { useRef, useState, useTransition } from "react";
import { Users, Shield } from "lucide-react";
import {
  updatePushTemplate,
  type PushTemplateView,
} from "@/actions/admin-push";

// ---------------------------------------------------------------------
// Page body: templates grouped by audience
// ---------------------------------------------------------------------

export function TemplatesClient({ templates }: { templates: PushTemplateView[] }) {
  const customer = templates.filter((t) => t.audience === "customer");
  const admin = templates.filter((t) => t.audience === "admin");

  return (
    <div className="space-y-8">
      <Section
        title="Customer notifications"
        icon={<Users className="h-4 w-4 text-emerald-400" />}
        templates={customer}
      />
      <Section
        title="Admin notifications"
        icon={<Shield className="h-4 w-4 text-emerald-400" />}
        templates={admin}
      />
    </div>
  );
}

function Section({
  title,
  icon,
  templates,
}: {
  title: string;
  icon: React.ReactNode;
  templates: PushTemplateView[];
}) {
  if (templates.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
          {title}
        </h2>
        <span className="text-[10px] text-zinc-600">
          {templates.length} message{templates.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-4">
        {templates.map((t) => (
          <TemplateCard key={t.key} template={t} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// One template card
// ---------------------------------------------------------------------

function TemplateCard({ template: t }: { template: PushTemplateView }) {
  const [enabled, setEnabled] = useState(t.enabled);
  const [title, setTitle] = useState(t.title);
  const [body, setBody] = useState(t.body);
  // Last values persisted on the server — dirty = fields differ from these.
  const [saved, setSaved] = useState({ title: t.title, body: t.body });
  const [customized, setCustomized] = useState(t.isCustomized);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const dirty = title !== saved.title || body !== saved.body;

  function toggle() {
    const previous = enabled;
    const next = !enabled;
    setEnabled(next); // optimistic
    setMessage(null);
    startTransition(async () => {
      const result = await updatePushTemplate(t.key, { enabled: next });
      if (!result.success) {
        setEnabled(previous); // revert
        setMessage({ kind: "err", text: result.error || "Failed to update" });
      }
    });
  }

  function persist(nextTitle: string, nextBody: string, okText: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await updatePushTemplate(t.key, {
        title: nextTitle,
        body: nextBody,
      });
      if (!result.success) {
        setMessage({ kind: "err", text: result.error || "Failed to save" });
        return;
      }
      // The server clears the override when a value is blank or equals the
      // default, so the effective value falls back to the default. Mirror
      // that here so the fields always show what will actually be sent.
      const effTitle = nextTitle.trim() === "" ? t.defaultTitle : nextTitle.trim();
      const effBody = nextBody.trim() === "" ? t.defaultBody : nextBody.trim();
      setTitle(effTitle);
      setBody(effBody);
      setSaved({ title: effTitle, body: effBody });
      setCustomized(effTitle !== t.defaultTitle || effBody !== t.defaultBody);
      setMessage({ kind: "ok", text: okText });
    });
  }

  function save() {
    persist(title, body, "Saved");
  }

  function resetToDefault() {
    setTitle(t.defaultTitle);
    setBody(t.defaultBody);
    persist(t.defaultTitle, t.defaultBody, "Reset to default");
  }

  function insertVariable(name: string) {
    const token = `{${name}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? start;
    setBody(body.slice(0, start) + token + body.slice(end));
    setMessage(null);
    // Restore focus + caret just after the inserted token.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  /** Substitute every {variable} with its example value for the preview. */
  function fillExamples(text: string): string {
    return t.variables.reduce(
      (acc, v) => acc.split(`{${v.name}}`).join(v.example),
      text,
    );
  }

  const isDefault = title === t.defaultTitle && body === t.defaultBody;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      {/* Top row: label + badges + switch */}
      <div className="flex items-center gap-3">
        <p className="font-medium text-white flex-1 min-w-0 truncate">{t.label}</p>
        {customized && (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
            Customized
          </span>
        )}
        <button
          onClick={toggle}
          disabled={isPending}
          role="switch"
          aria-checked={enabled}
          aria-label={`${t.label} ${enabled ? "enabled" : "disabled"}`}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-emerald-500" : "bg-zinc-700"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-150 ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Trigger */}
      <p className="text-xs text-zinc-500">{t.trigger}</p>

      {/* Body — dimmed (but still editable) while the message is off */}
      <div className={`space-y-3 ${enabled ? "" : "opacity-50"}`}>
        {/* Editable copy */}
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setMessage(null);
            }}
            placeholder={t.defaultTitle}
            aria-label="Notification title"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
          />
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setMessage(null);
            }}
            rows={2}
            placeholder={t.defaultBody}
            aria-label="Notification body"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 resize-y"
          />
        </div>

        {/* Variables */}
        {t.variables.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {t.variables.map((v) => (
              <span key={v.name} className="inline-flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => insertVariable(v.name)}
                  title={`${v.description} — e.g. ${v.example}. Click to insert into the body.`}
                  className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  {`{${v.name}}`}
                </button>
                <span className="text-[10px] text-zinc-600 truncate">
                  {v.description} — e.g. {v.example}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Live preview with example values */}
        <p className="text-xs text-zinc-400 italic">
          <span className="not-italic text-zinc-600">Preview: </span>
          <span className="font-medium">{fillExamples(title) || "—"}</span>
          {" · "}
          {fillExamples(body) || "—"}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={!dirty || isPending}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          {!isDefault && (
            <button
              onClick={resetToDefault}
              disabled={isPending}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset to default
            </button>
          )}
          {message && (
            <span
              className={`text-xs ${
                message.kind === "ok" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
