import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { formatAadhaar, NDA_VERSION, type NdaFields } from "@/lib/nda-template";
import { renderNdaPdf } from "@/lib/nda-pdf";

// Employee details come from the admin HR form. Aadhaar is validated to 12
// digits; only its last 4 are ever persisted (see below).
const bodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/[^\d+]/g, ""))
    .refine((s) => s.replace(/\D/g, "").length >= 10, "A valid phone number is required"),
  email: z.string().trim().email("A valid email is required"),
  aadhaar: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s.length === 12, "Aadhaar must be exactly 12 digits"),
  address: z.string().trim().min(1, "Address is required").max(400),
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
  // Gate on the HR/Legal permission (superadmin bypasses per requireAdmin).
  let admin;
  try {
    admin = await requireAdmin("MANAGE_HR");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid data" },
      { status: 400 }
    );
  }
  const { name, phone, email, aadhaar, address } = parsed.data;

  const fields: NdaFields = {
    name,
    phone,
    email,
    address,
    aadhaar: formatAadhaar(aadhaar), // full number on the printed NDA (identifies the signatory)
    date: formatTodayIST(),
  };

  // Audit record: who/when + identifying contact, and the LAST 4 of the
  // Aadhaar ONLY. The full number never touches the database or the logs.
  await db.ndaRecord.create({
    data: {
      employeeName: name,
      employeePhone: phone,
      employeeEmail: email,
      employeeAddress: address,
      aadhaarLast4: aadhaar.slice(-4),
      ndaVersion: NDA_VERSION,
      generatedById: admin.id,
      generatedByName: admin.name || admin.email || "admin",
    },
  });

  const doc = renderNdaPdf(fields);
  const buffer = Buffer.from(doc.output("arraybuffer"));
  const safeName = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="NDA-${safeName || "employee"}.pdf"`,
    },
  });
}
