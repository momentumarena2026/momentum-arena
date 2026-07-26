import { listEmployees } from "@/actions/admin-employees";
import { EmployeeManager } from "./employee-manager";

export const dynamic = "force-dynamic";

export default async function AdminEmployeesPage() {
  const employees = await listEmployees();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Employees</h1>
        <p className="mt-1 text-zinc-400">
          Manage employee records. These feed the NDA and offer-letter
          generators — pick an employee there instead of re-typing details.
        </p>
      </div>

      <EmployeeManager employees={employees} />
    </div>
  );
}
