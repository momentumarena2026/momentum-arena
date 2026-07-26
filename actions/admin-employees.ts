"use server";

import { z } from "zod";
import type { Employee } from "@prisma/client";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { encryptAadhaar } from "@/lib/hr-crypto";

async function gate() {
  await requireAdmin("MANAGE_HR");
}

export type EmployeeDTO = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  designation: string | null;
  department: string | null;
  salaryMonthly: number | null;
  dateOfJoining: string | null; // ISO date
  aadhaarLast4: string | null;
  hasAadhaar: boolean;
  status: string;
  createdAt: string;
};

function toDTO(e: Employee): EmployeeDTO {
  return {
    id: e.id,
    name: e.name,
    phone: e.phone,
    email: e.email,
    address: e.address,
    designation: e.designation,
    department: e.department,
    salaryMonthly: e.salaryMonthly,
    dateOfJoining: e.dateOfJoining ? e.dateOfJoining.toISOString() : null,
    aadhaarLast4: e.aadhaarLast4,
    hasAadhaar: !!e.aadhaarEnc,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
  };
}

// Blank ("") means "not provided" on create / "leave unchanged" on update.
const aadhaarField = z
  .string()
  .optional()
  .transform((s) => (s ?? "").replace(/\D/g, ""))
  .refine((s) => s === "" || s.length === 12, "Aadhaar must be 12 digits");

const baseShape = {
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(6, "Phone is required").max(20),
  email: z.string().trim().email("A valid email is required"),
  address: z.string().trim().min(1, "Address is required").max(400),
  designation: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  salaryMonthly: z.number().int().nonnegative().nullable().optional(),
  dateOfJoining: z.string().trim().optional(), // "yyyy-mm-dd" or ""
  aadhaar: aadhaarField,
};

const employeeSchema = z.object(baseShape);

function commonData(d: z.infer<typeof employeeSchema>) {
  return {
    name: d.name,
    phone: d.phone,
    email: d.email,
    address: d.address,
    designation: d.designation ? d.designation : null,
    department: d.department ? d.department : null,
    salaryMonthly: d.salaryMonthly ?? null,
    dateOfJoining: d.dateOfJoining ? new Date(d.dateOfJoining) : null,
  };
}

export async function listEmployees(): Promise<EmployeeDTO[]> {
  await gate();
  const rows = await db.employee.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  return rows.map(toDTO);
}

/** Active employees only — for the NDA / offer-letter select dropdowns. */
export async function listActiveEmployeesForLetters(): Promise<EmployeeDTO[]> {
  await gate();
  const rows = await db.employee.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  return rows.map(toDTO);
}

export async function createEmployee(
  input: unknown
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }
  const d = parsed.data;
  await db.employee.create({
    data: {
      ...commonData(d),
      aadhaarEnc: d.aadhaar ? encryptAadhaar(d.aadhaar) : null,
      aadhaarLast4: d.aadhaar ? d.aadhaar.slice(-4) : null,
    },
  });
  return { success: true };
}

export async function updateEmployee(
  id: string,
  input: unknown
): Promise<{ success: boolean; error?: string }> {
  await gate();
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }
  const d = parsed.data;
  const data: Record<string, unknown> = { ...commonData(d) };
  // Aadhaar: blank leaves the stored value untouched; a full 12-digit entry
  // re-encrypts it.
  if (d.aadhaar && d.aadhaar.length === 12) {
    data.aadhaarEnc = encryptAadhaar(d.aadhaar);
    data.aadhaarLast4 = d.aadhaar.slice(-4);
  }
  try {
    await db.employee.update({ where: { id }, data });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update employee" };
  }
}

export async function setEmployeeStatus(
  id: string,
  status: "ACTIVE" | "INACTIVE"
): Promise<{ success: boolean; error?: string }> {
  await gate();
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    return { success: false, error: "Invalid status" };
  }
  try {
    await db.employee.update({ where: { id }, data: { status } });
    return { success: true };
  } catch {
    return { success: false, error: "Failed to update status" };
  }
}
