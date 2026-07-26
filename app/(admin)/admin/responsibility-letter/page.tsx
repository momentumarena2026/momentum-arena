import {
  getResponsibilityRecords,
  listActiveResponsibilityItems,
} from "@/actions/admin-responsibilities";
import { listActiveEmployeesForLetters } from "@/actions/admin-employees";
import { ResponsibilityGenerator } from "./responsibility-generator";

export const dynamic = "force-dynamic";

export default async function AdminResponsibilityLetterPage() {
  const [records, items, employees] = await Promise.all([
    getResponsibilityRecords(),
    listActiveResponsibilityItems(),
    listActiveEmployeesForLetters(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Responsibility Letter</h1>
        <p className="mt-1 text-zinc-400">
          Select an employee, tick the responsibilities to assign, and generate a
          Roles &amp; Responsibilities letter on the company letterhead, stamped
          &amp; signed.
        </p>
      </div>

      <ResponsibilityGenerator
        employees={employees.map((e) => ({ id: e.id, name: e.name, designation: e.designation }))}
        items={items.map((i) => ({ id: i.id, text: i.text }))}
        records={records.map((r) => ({
          id: r.id,
          employeeName: r.employeeName,
          designation: r.designation,
          count: r.responsibilities.length,
          generatedByName: r.generatedByName,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
