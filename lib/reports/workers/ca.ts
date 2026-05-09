import { exportMonthlyXlsx } from "@/lib/admin-export";

/**
 * CA monthly report worker.
 *
 * Same column shape as the SALES_MONTHLY workbook — bookings,
 * cafe orders, summary block — built by exportMonthlyXlsx. The
 * only difference is the filename: `…_ca-report.xlsx` instead of
 * `…_revenue.xlsx` so the chartered-accountant-bound copy is
 * filename-tagged for filing.
 *
 * Kept as a separate worker (rather than just renaming the sales
 * file) so the two report types can drift independently later if
 * the CA needs format tweaks (column reordering, additional
 * regulatory fields, etc.).
 */
export async function generateCaMonthlyReport(input: {
  year: number;
  month: number;
}): Promise<{ filename: string; bytes: Buffer }> {
  const out = await exportMonthlyXlsx({
    year: input.year,
    month: input.month,
  });
  const yyyy = String(input.year).padStart(4, "0");
  const mm = String(input.month).padStart(2, "0");
  return {
    filename: `momentum-arena_${yyyy}-${mm}_ca-report.xlsx`,
    bytes: out.buffer,
  };
}
