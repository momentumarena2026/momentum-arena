import { getOfferRecords } from "@/actions/admin-offer";
import { listActiveEmployeesForLetters } from "@/actions/admin-employees";
import { OfferGenerator } from "./offer-generator";

export const dynamic = "force-dynamic";

export default async function AdminOfferLetterPage() {
  const [records, employees] = await Promise.all([
    getOfferRecords(),
    listActiveEmployeesForLetters(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Offer Letter Generator</h1>
        <p className="mt-1 text-zinc-400">
          Select an employee to generate a Letter of Appointment on the company
          letterhead, stamped &amp; signed.
        </p>
      </div>

      <OfferGenerator
        employees={employees.map((e) => ({
          id: e.id,
          name: e.name,
          designation: e.designation,
          salaryMonthly: e.salaryMonthly,
          dateOfJoining: e.dateOfJoining,
        }))}
        records={records.map((r) => ({
          id: r.id,
          employeeName: r.employeeName,
          designation: r.designation,
          salaryMonthly: r.salaryMonthly,
          dateOfJoining: r.dateOfJoining ? r.dateOfJoining.toISOString() : null,
          generatedByName: r.generatedByName,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
