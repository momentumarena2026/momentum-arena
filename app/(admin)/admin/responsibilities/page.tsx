import { listResponsibilityItems } from "@/actions/admin-responsibilities";
import { ResponsibilityManager } from "./responsibility-manager";

export const dynamic = "force-dynamic";

export default async function AdminResponsibilitiesPage() {
  const items = await listResponsibilityItems();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Responsibilities</h1>
        <p className="mt-1 text-zinc-400">
          Maintain the master list of responsibility items. Only{" "}
          <span className="text-emerald-400">enabled</span> items appear when
          creating a Responsibility Letter.
        </p>
      </div>

      <ResponsibilityManager items={items} />
    </div>
  );
}
