import { adminAuth } from "@/lib/admin-auth-session";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PERMISSION_LABELS } from "@/lib/permissions";
import { AdminChangePassword } from "./change-password";

export default async function AdminProfilePage() {
  const session = await adminAuth();
  if (!session?.user) {
    redirect("/godmode");
  }

  const admin = await db.adminUser.findUnique({
    where: { id: session.user.id },
    select: {
      username: true,
      email: true,
      role: true,
      permissions: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!admin) redirect("/godmode");

  const isSuperadmin = admin.role === "SUPERADMIN";

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin Profile</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Your account details and settings
        </p>
      </div>

      {/* Basic Info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Account Info</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Username</p>
            <p className="text-white font-medium">{admin.username}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Email</p>
            <p className="text-white">{admin.email}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Role</p>
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                isSuperadmin
                  ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                  : "bg-red-500/20 text-red-400 border border-red-500/30"
              }`}
            >
              {admin.role}
            </span>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Member Since</p>
            <p className="text-zinc-300 text-sm">
              {admin.createdAt.toLocaleDateString("en-IN", {
                dateStyle: "medium",
              })}
            </p>
          </div>
        </div>

        {admin.lastLoginAt && (
          <div>
            <p className="text-xs text-zinc-500 mb-1">Last Login</p>
            <p className="text-zinc-300 text-sm">
              {admin.lastLoginAt.toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
        )}
      </div>

      {/* Permissions */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Permissions</h2>
        {isSuperadmin ? (
          <p className="text-sm text-yellow-400">
            Superadmin — full access to all features
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {admin.permissions.map((p) => (
              <span
                key={p}
                className="text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-md"
              >
                {PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS] || p}
              </span>
            ))}
            {admin.permissions.length === 0 && (
              <p className="text-sm text-zinc-500">No permissions assigned</p>
            )}
          </div>
        )}
      </div>

      {/* Change Password */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Change Password</h2>
        <AdminChangePassword isSuperadmin={isSuperadmin} />
      </div>
    </div>
  );
}
