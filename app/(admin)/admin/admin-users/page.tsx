import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminUsersManager } from "./admin-users-manager";

export default async function AdminUsersPage() {
  const session = await auth();
  if (session?.user?.adminRole !== "SUPERADMIN") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin Users</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Manage admin accounts and their permissions
        </p>
      </div>
      <AdminUsersManager />
    </div>
  );
}
