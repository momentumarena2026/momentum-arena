import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSoldPassDetail } from "@/actions/admin-passes";
import { PassDetailAdmin } from "./pass-detail-admin";

// Balance, redemptions and members all move at booking time — never cache.
export const dynamic = "force-dynamic";

export default async function AdminPassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pass = await getSoldPassDetail(id);
  if (!pass) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/passes"
        className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Passes
      </Link>
      <PassDetailAdmin pass={pass} />
    </div>
  );
}
