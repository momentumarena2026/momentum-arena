import { exportMonthlyXlsx } from "@/lib/admin-export";

/**
 * Sales report worker — wraps the existing exportMonthlyXlsx
 * builder so the queue and the (since-removed) direct-download
 * route both produced identical files. Just an adapter to the
 * Buffer/filename shape the queue expects.
 */
export async function generateSalesReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const out = await exportMonthlyXlsx({
    year: input.year,
    month: input.month,
  });
  return { filename: out.filename, bytes: out.buffer };
}
