"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/actions/profile";
import { User, Mail, Phone, Loader2, Check, Pencil } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { normalizeIndianPhone } from "@/lib/phone";

interface ProfileFormProps {
  name: string;
  email: string;
  phone: string;
}

// Strip the "91" country code prefix from a DB-stored phone so the
// editable input only shows the 10-digit national number. If the stored
// value is malformed (not "91" + 10 digits), fall back to the raw
// digits — the PhoneInput will cap at 10 chars.
function toDisplayDigits(phoneFromDb: string): string {
  const digits = phoneFromDb.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  return digits.slice(-10);
}

export function ProfileForm({ name, email, phone }: ProfileFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    name,
    email,
    // Keep phone in state as the 10-digit national number only; we
    // prepend "91" right before submitting so the DB always stores the
    // canonical 91XXXXXXXXXX form.
    phone: toDisplayDigits(phone),
  });

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    // Require either empty (clearing the number) or a full 10 digits.
    if (form.phone.length !== 0 && form.phone.length !== 10) {
      setError("Phone number must be exactly 10 digits");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    const result = await updateProfile({
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.length === 10
        ? normalizeIndianPhone(form.phone)
        : undefined,
    });

    if (result.success) {
      setSuccess(true);
      setEditing(false);
      router.refresh();
      setTimeout(() => setSuccess(false), 3000);
    } else {
      setError(result.error || "Failed to update profile");
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setForm({ name, email, phone: toDisplayDigits(phone) });
    setEditing(false);
    setError(null);
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
          Edit Profile
        </h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <User className="h-3 w-3" />
            Full Name
          </label>
          {editing ? (
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Your full name"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          ) : (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white">
              {form.name || "—"}
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <Mail className="h-3 w-3" />
            Email Address
          </label>
          {editing ? (
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="your@email.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          ) : (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white">
              {form.email || "Not set"}
            </p>
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <Phone className="h-3 w-3" />
            Phone Number
          </label>
          {editing ? (
            <PhoneInput
              value={form.phone}
              onChange={(digits) => setForm((p) => ({ ...p, phone: digits }))}
            />
          ) : (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white">
              {form.phone ? `+91 ${form.phone}` : "Not set"}
            </p>
          )}
        </div>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          <Check className="h-4 w-4" />
          Profile updated successfully!
        </div>
      )}

      {/* Action Buttons */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : (
              "Save Changes"
            )}
          </button>
          <button
            onClick={handleCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
