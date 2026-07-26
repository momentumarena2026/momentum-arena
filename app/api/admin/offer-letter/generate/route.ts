import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { buildOfferBlocks, OFFER_VERSION, type OfferFields } from "@/lib/offer-template";
import { renderLetter } from "@/lib/letter-pdf";

const bodySchema = z.object({
  employeeId: z.string().min(1, "Select an employee"),
  // Optional override; defaults to the employee's stored joining date.
  dateOfJoining: z.string().trim().optional(),
});

function formatIST(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin("MANAGE_HR");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid data" }, { status: 400 });
  }

  const employee = await db.employee.findUnique({ where: { id: parsed.data.employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  if (!employee.designation) {
    return NextResponse.json(
      { error: "Set the employee's Designation on the Employees screen first." },
      { status: 400 }
    );
  }
  if (employee.salaryMonthly == null) {
    return NextResponse.json(
      { error: "Set the employee's monthly Salary on the Employees screen first." },
      { status: 400 }
    );
  }

  // Joining date: request override → employee record → error if neither.
  const joiningRaw = parsed.data.dateOfJoining;
  const joiningDate = joiningRaw ? new Date(joiningRaw) : employee.dateOfJoining;
  if (!joiningDate || isNaN(joiningDate.getTime())) {
    return NextResponse.json(
      { error: "Provide a Date of Joining (or set it on the employee)." },
      { status: 400 }
    );
  }

  const fields: OfferFields = {
    name: employee.name,
    address: employee.address,
    designation: employee.designation,
    salaryMonthly: employee.salaryMonthly,
    dateOfJoining: formatIST(joiningDate),
    date: formatIST(new Date()),
  };

  await db.offerLetterRecord.create({
    data: {
      employeeId: employee.id,
      employeeName: employee.name,
      designation: employee.designation,
      salaryMonthly: employee.salaryMonthly,
      dateOfJoining: joiningDate,
      offerVersion: OFFER_VERSION,
      generatedById: admin.id,
      generatedByName: admin.name || admin.email || "admin",
    },
  });

  const doc = renderLetter(buildOfferBlocks(fields));
  const buffer = Buffer.from(doc.output("arraybuffer"));
  const safeName = employee.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Offer-Letter-${safeName || "employee"}.pdf"`,
    },
  });
}
