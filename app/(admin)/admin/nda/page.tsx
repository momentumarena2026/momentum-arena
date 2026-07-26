import { getNdaRecords } from "@/actions/admin-nda";
import { NdaGenerator } from "./nda-generator";

export const dynamic = "force-dynamic";

export default async function AdminNdaPage() {
  const records = await getNdaRecords();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Employee NDA Generator</h1>
        <p className="mt-1 text-zinc-400">
          Enter an employee&apos;s details to generate a ready-to-sign
          Non-Disclosure &amp; Confidentiality Agreement on the company
          letterhead.
        </p>
      </div>

      <NdaGenerator
        records={records.map((r) => ({
          id: r.id,
          employeeName: r.employeeName,
          employeePhone: r.employeePhone,
          employeeEmail: r.employeeEmail,
          aadhaarLast4: r.aadhaarLast4,
          generatedByName: r.generatedByName,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
