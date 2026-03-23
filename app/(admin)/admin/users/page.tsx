import { getAdminUsers } from "@/actions/admin-users";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; role?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");

  const { users, total, totalPages } = await getAdminUsers({
    search: params.search,
    role: params.role,
    page,
    limit: 20,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        <p className="mt-1 text-zinc-400">{total} total users</p>
      </div>

      <UsersTable
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          bookingCount: u._count.bookings,
          createdAt: u.createdAt.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        }))}
        currentSearch={params.search || ""}
        currentRole={params.role || ""}
        page={page}
        totalPages={totalPages}
      />
    </div>
  );
}
