"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  getAdminUsers,
  createAdminUser,
  deleteAdminUser,
  updateAdminPermissions,
  resendAdminInvite,
} from "@/actions/admin-auth";
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  SUPERADMIN_ONLY_PERMISSIONS,
} from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN" | "STAFF";
  permissions: string[];
  isDeletable: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  passwordSet: boolean;
  inviteExpired: boolean;
};

export function AdminUsersManager() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<
    { id: string; kind: "success" | "error"; text: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();

  const loadAdmins = () => {
    startTransition(async () => {
      const data = await getAdminUsers();
      setAdmins(data as AdminUser[]);
    });
  };

  useEffect(() => {
    loadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (id: string, username: string) => {
    if (!confirm(`Delete admin user "${username}"? This cannot be undone.`))
      return;
    startTransition(async () => {
      await deleteAdminUser(id);
      loadAdmins();
    });
  };

  const handleResend = (id: string, username: string) => {
    if (!confirm(`Resend invite email to "${username}"?`)) return;
    setResendingId(id);
    setResendMessage(null);
    startTransition(async () => {
      const result = await resendAdminInvite(id);
      setResendingId(null);
      if (result.success) {
        setResendMessage({
          id,
          kind: "success",
          text: "Invite email sent. Link is valid for 48 hours.",
        });
      } else {
        setResendMessage({
          id,
          kind: "error",
          text: result.error || "Could not resend invite.",
        });
      }
      loadAdmins();
    });
  };

  const assignablePermissions = ALL_PERMISSIONS.filter(
    (p) => !SUPERADMIN_ONLY_PERMISSIONS.includes(p)
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <span className="text-sm text-zinc-400">
          {admins.length} admin user{admins.length !== 1 ? "s" : ""}
        </span>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {showCreate ? "Cancel" : "Invite Admin"}
        </Button>
      </div>

      {showCreate && (
        <CreateAdminForm
          permissions={assignablePermissions}
          onSuccess={() => {
            setShowCreate(false);
            loadAdmins();
          }}
        />
      )}

      <div className="space-y-4">
        {admins.map((admin) => {
          // Superadmins never use the invite flow, so they're implicitly active.
          const isSuperadmin = admin.role === "SUPERADMIN";
          const isPendingInvite = !isSuperadmin && !admin.passwordSet;
          const statusBadge = isPendingInvite
            ? admin.inviteExpired
              ? {
                  label: "Invite expired",
                  cls: "bg-red-500/20 text-red-400 border border-red-500/30",
                }
              : {
                  label: "Pending",
                  cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
                }
            : {
                label: "Active",
                cls: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
              };
          const msg = resendMessage?.id === admin.id ? resendMessage : null;

          return (
            <Card key={admin.id} className="bg-zinc-950 border-zinc-800">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <CardTitle className="text-lg text-white">
                      {admin.username}
                    </CardTitle>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        admin.role === "SUPERADMIN"
                          ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                          : "bg-red-500/20 text-red-400 border border-red-500/30"
                      }`}
                    >
                      {admin.role}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${statusBadge.cls}`}
                    >
                      {statusBadge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPendingInvite && (
                      <button
                        onClick={() => handleResend(admin.id, admin.username)}
                        disabled={isPending || resendingId === admin.id}
                        className="text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                      >
                        {resendingId === admin.id ? "Sending..." : "Resend Invite"}
                      </button>
                    )}
                    {admin.role !== "SUPERADMIN" && (
                      <button
                        onClick={() =>
                          setEditingId(editingId === admin.id ? null : admin.id)
                        }
                        className="text-xs text-zinc-400 hover:text-white transition-colors"
                      >
                        {editingId === admin.id ? "Close" : "Edit Permissions"}
                      </button>
                    )}
                    {admin.isDeletable && (
                      <button
                        onClick={() => handleDelete(admin.id, admin.username)}
                        disabled={isPending}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-zinc-400">{admin.email}</p>
                {msg && (
                  <div
                    className={`rounded-md p-2 text-xs border ${
                      msg.kind === "success"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border-red-500/20"
                    }`}
                  >
                    {msg.text}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {admin.permissions.map((p) => (
                    <span
                      key={p}
                      className="text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded"
                    >
                      {PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS] ||
                        p}
                    </span>
                  ))}
                </div>
                {admin.lastLoginAt ? (
                  <p className="text-xs text-zinc-500">
                    Last login:{" "}
                    {new Date(admin.lastLoginAt).toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                    })}
                  </p>
                ) : isPendingInvite ? (
                  <p className="text-xs text-zinc-500">
                    Never logged in — waiting for password setup
                  </p>
                ) : null}

                {editingId === admin.id && (
                  <EditPermissionsForm
                    adminId={admin.id}
                    currentPermissions={admin.permissions}
                    allPermissions={assignablePermissions}
                    onSave={() => {
                      setEditingId(null);
                      loadAdmins();
                    }}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CreateAdminForm({
  permissions,
  onSuccess,
}: {
  permissions: readonly string[];
  onSuccess: () => void;
}) {
  const [state, formAction, isPending] = useActionState<
    { error?: string; success?: boolean },
    FormData
  >(createAdminUser, {});

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  return (
    <Card className="bg-zinc-900 border-zinc-700">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          {state.error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {state.error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-zinc-300">Username</Label>
              <Input
                name="username"
                required
                placeholder="admin_user"
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Email</Label>
              <Input
                name="email"
                type="email"
                required
                placeholder="admin@example.com"
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-300">Permissions</Label>
            <div className="grid grid-cols-2 gap-2">
              {permissions.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={p}
                    defaultChecked
                    className="rounded border-zinc-700"
                  />
                  {PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS] || p}
                </label>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isPending ? "Creating..." : "Send Invite"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EditPermissionsForm({
  adminId,
  currentPermissions,
  allPermissions,
  onSave,
}: {
  adminId: string;
  currentPermissions: string[];
  allPermissions: readonly string[];
  onSave: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(currentPermissions);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      await updateAdminPermissions(adminId, selected);
      onSave();
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {allPermissions.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelected([...selected, p]);
                } else {
                  setSelected(selected.filter((s) => s !== p));
                }
              }}
              className="rounded border-zinc-700"
            />
            {PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS] || p}
          </label>
        ))}
      </div>
      <Button
        onClick={handleSave}
        disabled={isPending}
        size="sm"
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        {isPending ? "Saving..." : "Save Permissions"}
      </Button>
    </div>
  );
}
