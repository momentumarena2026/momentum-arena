import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import {
  buildResponsibilityBlocks,
  RESP_LETTER_VERSION,
  type ResponsibilityFields,
} from "@/lib/responsibility-template";
import { renderLetter } from "@/lib/letter-pdf";

const bodySchema = z.object({
  employeeId: z.string().min(1, "Select an employee"),
  itemIds: z.array(z.string().min(1)).min(1, "Select at least one responsibility"),
});

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

  // Load the chosen items (active only), preserving the catalogue order.
  const items = await db.responsibilityItem.findMany({
    where: { id: { in: parsed.data.itemIds }, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (items.length === 0) {
    return NextResponse.json({ error: "None of the selected responsibilities are available." }, { status: 400 });
  }
  const responsibilities = items.map((i) => i.text);

  const fields: ResponsibilityFields = {
    name: employee.name,
    designation: employee.designation,
    responsibilities,
    date: formatTodayIST(),
  };

  await db.responsibilityLetterRecord.create({
    data: {
      employeeId: employee.id,
      employeeName: employee.name,
      designation: employee.designation,
      responsibilities,
      letterVersion: RESP_LETTER_VERSION,
      generatedById: admin.id,
      generatedByName: admin.name || admin.email || "admin",
    },
  });

  const doc = renderLetter(buildResponsibilityBlocks(fields));
  const buffer = Buffer.from(doc.output("arraybuffer"));
  const safeName = employee.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Responsibilities-${safeName || "employee"}.pdf"`,
    },
  });
}
