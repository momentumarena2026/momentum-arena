"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUser, updateUser, deleteUser } from "@/actions/admin-users";
import { UserRole } from "@prisma/client";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  Shield,
  User as UserIcon,
} from "lucide-react";
import Link from "next/link";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  bookingCount: number;
  createdAt: string;
}

interface UsersTableProps {
  users: UserRow[];
  currentSearch: string;
  currentRole: string;
  page: number;
  totalPages: number;
}

export function UsersTable({
  users,
  currentSearch,
  currentRole,
  page,
  totalPages,
}: UsersTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState(currentSearch);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", role: "CUSTOMER" as UserRole });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = () => {
    router.push(`/admin/users?search=${search}&role=${currentRole}`);
  };

  const openCreateForm = () => {
    setEditingUser(null);
    setFormData({ name: "", email: "", phone: "", role: "CUSTOMER" });
    setShowForm(true);
    setError(null);
  };

  const openEditForm = (user: UserRow) => {
    setEditingUser(user);
    setFormData({
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role,
    });
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const result = editingUser
      ? await updateUser(editingUser.id, formData)
      : await createUser(formData);

    if (result.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error || "Failed");
    }
    setSaving(false);
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Are you sure? This will soft-delete the user.")) return;
    setDeleting(userId);
    const result = await deleteUser(userId);
    if (!result.success) {
      alert(result.error);
    }
    setDeleting(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Search + Actions */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search name, email, phone..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          {["", "CUSTOMER", "ADMIN"].map((role) => (
            <Link
              key={role}
              href={`/admin/users?search=${currentSearch}&role=${role}`}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${
                currentRole === role
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700"
              }`}
            >
              {role || "All"}
            </Link>
          ))}
        </div>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">
              {editingUser ? "Edit User" : "Create User"}
            </h3>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              placeholder="Name *"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
              placeholder="Email"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
              placeholder="Phone (e.g., +91XXXXXXXXXX)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <select
              value={formData.role}
              onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value as UserRole }))}
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              <option value="CUSTOMER">Customer</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !formData.name}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
            {editingUser ? "Update" : "Create"}
          </button>
        </div>
      )}

      {/* Users List */}
      <div className="space-y-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`rounded-lg p-2 ${user.role === "ADMIN" ? "bg-red-500/10" : "bg-blue-500/10"}`}>
                {user.role === "ADMIN" ? (
                  <Shield className="h-4 w-4 text-red-400" />
                ) : (
                  <UserIcon className="h-4 w-4 text-blue-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-white truncate">{user.name || "—"}</p>
                <p className="text-xs text-zinc-500">
                  {user.email || user.phone} • {user.bookingCount} bookings • {user.createdAt}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  user.role === "ADMIN"
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-400"
                }`}
              >
                {user.role}
              </span>
              <button
                onClick={() => openEditForm(user)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleDelete(user.id)}
                disabled={deleting === user.id}
                className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
              >
                {deleting === user.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/admin/users?page=${p}&search=${currentSearch}&role=${currentRole}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                p === page
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
