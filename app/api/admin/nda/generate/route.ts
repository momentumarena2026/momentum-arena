import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { decryptAadhaar } from "@/lib/hr-crypto";
import { buildNdaBlocks, formatAadhaar, NDA_VERSION, type NdaFields } from "@/lib/nda-template";
import { renderLetter } from "@/lib/letter-pdf";

const bodySchema = z.object({ employeeId: z.string().min(1, "Select an employee") });

function formatTodayIST(): string {
  return new Date().toLocaleDateString("en-IN", {
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
  if (!employee.aadhaarEnc) {
    return NextResponse.json(
      { error: "This employee has no Aadhaar on file. Add it on the Employees screen first." },
      { status: 400 }
    );
  }

  let aadhaarDigits: string;
  try {
    aadhaarDigits = decryptAadhaar(employee.aadhaarEnc);
  } catch {
    return NextResponse.json({ error: "Could not read the stored Aadhaar for this employee." }, { status: 500 });
  }

  const fields: NdaFields = {
    name: employee.name,
    phone: employee.phone,
    email: employee.email,
    address: employee.address,
    aadhaar: formatAadhaar(aadhaarDigits),
    date: formatTodayIST(),
  };

  // Audit record: snapshot of what was printed + last-4 only.
  await db.ndaRecord.create({
    data: {
      employeeId: employee.id,
      employeeName: employee.name,
      employeePhone: employee.phone,
      employeeEmail: employee.email,
      employeeAddress: employee.address,
      aadhaarLast4: employee.aadhaarLast4 || aadhaarDigits.slice(-4),
      ndaVersion: NDA_VERSION,
      generatedById: admin.id,
      generatedByName: admin.name || admin.email || "admin",
    },
  });

  const doc = renderLetter(buildNdaBlocks(fields));
  const buffer = Buffer.from(doc.output("arraybuffer"));
  const safeName = employee.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="NDA-${safeName || "employee"}.pdf"`,
    },
  });
}
