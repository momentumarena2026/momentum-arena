"use client";

/**
 * Admin UI for the user-groups feature. Lives next to CouponsManager
 * because the only thing groups currently do is target coupons —
 * "User Groups" sits as a tab inside the Coupons admin page (see
 * coupons-tabs.tsx) rather than getting its own top-level nav entry.
 *
 * Two surfaces:
 *   - List page: every active group with member + coupon counts.
 *   - Detail/edit modal: rename, edit description, manage members
 *     (search-as-you-type picker + chip list).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Edit3,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  addUsersToGroup,
  createUserGroup,
  deleteUserGroup,
  getUserGroupWithMembers,
  removeUserFromGroup,
  searchUsersForPicker,
  updateUserGroup,
} from "@/actions/admin-user-groups";

export interface UserGroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  couponCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PickerUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface MemberRow {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  addedAt: string;
}

function userLabel(u: { name?: string | null; phone?: string | null; email?: string | null }) {
  return u.name?.trim() || u.phone || u.email || "Unknown";
}

function userSubLabel(u: { phone?: string | null; email?: string | null; name?: string | null }) {
  // Show whichever of phone/email is *different* from the primary
  // label so we never repeat the same string twice.
  const primary = userLabel(u);
  if (u.phone && u.phone !== primary) return u.phone;
  if (u.email && u.email !== primary) return u.email;
  return null;
}

export function UserGroupsManager({ groups }: { groups: UserGroupRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.trim().toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description ?? "").toLowerCase().includes(q),
    );
  }, [groups, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> New Group
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-2 text-sm text-zinc-400">
            {groups.length === 0
              ? "No user groups yet. Create one to start targeting coupons by cohort."
              : "No groups match your search."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Group</th>
                <th className="px-4 py-2.5 text-left font-medium">Members</th>
                <th className="px-4 py-2.5 text-left font-medium">Coupons</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950">
              {filtered.map((g) => (
                <tr key={g.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{g.name}</div>
                    {g.description && (
                      <div className="text-xs text-zinc-500 line-clamp-1">
                        {g.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{g.memberCount}</td>
                  <td className="px-4 py-3 text-zinc-300">{g.couponCount}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditingId(g.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <Edit3 className="h-3 w-3" />
                      Manage
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateGroupModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      )}

      {editingId && (
        <EditGroupModal
          groupId={editingId}
          onClose={() => setEditingId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ─── Create modal ────────────────────────────────────────────────

function CreateGroupModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pickedUsers, setPickedUsers] = useState<PickerUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createUserGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        initialUserIds: pickedUsers.map((u) => u.id),
      });
      if (result.success) {
        onSaved();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal title="New User Group" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. VIP Members"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            autoFocus
          />
        </Field>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Internal note — only admins see this"
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </Field>

        <Field label="Initial members (optional)">
          <UserPicker
            picked={pickedUsers}
            onAdd={(u) =>
              setPickedUsers((p) =>
                p.some((x) => x.id === u.id) ? p : [...p, u],
              )
            }
            onRemove={(id) =>
              setPickedUsers((p) => p.filter((x) => x.id !== id))
            }
          />
        </Field>

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={pending}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────

function EditGroupModal({
  groupId,
  onClose,
  onChanged,
}: {
  groupId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await getUserGroupWithMembers(groupId);
      if (cancelled) return;
      if (!data) {
        setError("Group not found");
        setLoading(false);
        return;
      }
      setName(data.name);
      setDescription(data.description || "");
      setMembers(data.members);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const saveMeta = async () => {
    setSavingMeta(true);
    setError(null);
    const result = await updateUserGroup(groupId, {
      name,
      description: description || null,
    });
    setSavingMeta(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onChanged();
  };

  const handleAdd = async (u: PickerUser) => {
    if (members.some((m) => m.userId === u.id)) return;
    // Optimistic — drop them in immediately so the picker feels live.
    const optimistic: MemberRow = {
      membershipId: `tmp-${u.id}`,
      userId: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      addedAt: new Date().toISOString(),
    };
    setMembers((prev) => [optimistic, ...prev]);

    const result = await addUsersToGroup(groupId, [u.id]);
    if (!result.success) {
      // Roll back the optimistic insert.
      setMembers((prev) => prev.filter((m) => m.userId !== u.id));
      setError(result.error);
      return;
    }
    onChanged();
  };

  const handleRemove = async (userId: string) => {
    const previous = members;
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    const result = await removeUserFromGroup(groupId, userId);
    if (!result.success) {
      setMembers(previous);
      setError(result.error);
      return;
    }
    onChanged();
  };

  const handleDelete = async () => {
    const result = await deleteUserGroup(groupId);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onChanged();
    onClose();
  };

  return (
    <Modal title="Manage Group" onClose={onClose} wide>
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveMeta}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              />
            </Field>
            <Field label="Description">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={saveMeta}
                placeholder="Optional"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              />
            </Field>
          </div>
          {savingMeta && (
            <p className="text-xs text-zinc-500">Saving…</p>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-400">
              Add members
            </p>
            <UserPicker
              picked={members.map((m) => ({
                id: m.userId,
                name: m.name,
                email: m.email,
                phone: m.phone,
              }))}
              onAdd={handleAdd}
              onRemove={handleRemove}
              showPickedAsList={false}
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-400">
              Members ({members.length})
            </p>
            {members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
                No members yet. Add one above to get started.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
                {members.map((m) => (
                  <li
                    key={m.membershipId}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">
                        {userLabel(m)}
                      </div>
                      {userSubLabel(m) && (
                        <div className="truncate text-xs text-zinc-500">
                          {userSubLabel(m)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(m.userId)}
                      className="ml-3 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                      title="Remove from group"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-4">
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1 rounded-md text-xs text-red-400 hover:text-red-300"
              >
                <Trash2 className="h-3 w-3" /> Delete group
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-red-400">Delete this group?</span>
                <button
                  onClick={handleDelete}
                  className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Picker (shared by group create/edit + coupon form) ──────────

export function UserPicker({
  picked,
  onAdd,
  onRemove,
  showPickedAsList = true,
}: {
  picked: PickerUser[];
  onAdd: (user: PickerUser) => void;
  onRemove: (userId: string) => void;
  /** When false, callers render the picked-list themselves (e.g. the
   *  Edit modal shows it as a separate "Members" panel). */
  showPickedAsList?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<PickerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Debounce the query so we don't fire a server action on every
  // keystroke. 200ms is fast enough that the dropdown feels live.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const r = await searchUsersForPicker(debounced, 10);
      if (cancelled) return;
      setResults(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // Filter out anyone already picked so the dropdown doesn't tease
  // useless options.
  const filteredResults = results.filter(
    (r) => !picked.some((p) => p.id === r.id),
  );

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          // Delay close so a click on a result still registers.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by name, email, or phone…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none"
        />
        {open && debounced && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Searching…
              </div>
            ) : filteredResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-500">
                No matches.
              </div>
            ) : (
              <ul className="max-h-56 overflow-y-auto">
                {filteredResults.map((u) => (
                  <li key={u.id}>
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onAdd(u);
                        setQuery("");
                        setResults([]);
                      }}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-900"
                    >
                      <UserPlus className="mt-0.5 h-3.5 w-3.5 text-emerald-400" />
                      <div className="min-w-0">
                        <div className="truncate text-white">
                          {userLabel(u)}
                        </div>
                        {userSubLabel(u) && (
                          <div className="truncate text-xs text-zinc-500">
                            {userSubLabel(u)}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showPickedAsList && picked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300"
            >
              {userLabel(u)}
              <button
                onClick={() => onRemove(u.id)}
                className="ml-1 rounded-full hover:bg-emerald-500/20"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tiny presentational helpers ─────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
