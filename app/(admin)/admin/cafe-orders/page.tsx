import { getCafeOrders, getCafeOrderStats } from "@/actions/admin-cafe-orders";
import { CafeOrdersClient } from "./cafe-orders-client";

export default async function AdminCafeOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    date?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;

  // No default date filter — the admin sees ALL orders across all
  // dates by default, paginated. A date filter is only applied when
  // the admin explicitly picks one from the date input. Mirrors the
  // /admin/bookings list which is also date-agnostic by default.
  const [{ orders, total, totalPages }, stats] = await Promise.all([
    getCafeOrders({
      date: params.date || undefined,
      status: params.status as any,
      search: params.search,
      page: parseInt(params.page || "1"),
    }),
    getCafeOrderStats(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cafe Orders</h1>
        <p className="mt-1 text-zinc-400">
          Manage cafe orders and track kitchen status
        </p>
      </div>

      <CafeOrdersClient
        orders={orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          totalAmount: o.totalAmount,
          note: o.note,
          guestName: o.guestName,
          guestPhone: o.guestPhone,
          createdAt: o.createdAt.toISOString(),
          user: o.user
            ? { name: o.user.name, email: o.user.email, phone: o.user.phone }
            : null,
          items: o.items.map((i) => ({
            id: i.id,
            itemName: i.itemName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice,
            isVeg: i.cafeItem?.isVeg ?? true,
          })),
          payment: o.payment
            ? { method: o.payment.method, status: o.payment.status }
            : null,
          createdByAdmin: o.createdByAdmin?.username || null,
        }))}
        stats={stats}
        total={total}
        totalPages={totalPages}
        currentPage={parseInt(params.page || "1")}
        currentStatus={params.status || ""}
        currentDate={params.date || ""}
      />
    </div>
  );
}
