import { request } from "./admin-api";

export type ReportType =
  | "SALES_MONTHLY"
  | "RAZORPAY_RECON_MONTHLY"
  | "CA_MONTHLY"
  | "EXPENSES_MONTHLY"
  | "EXPENSES_LIFETIME"
  | "REWARD_LIABILITY_MONTHLY"
  | "REWARD_LIABILITY_LIFETIME"
  | "REWARD_ALERTS_MONTHLY"
  | "REWARD_TXN_LEDGER_MONTHLY"
  | "REWARD_TXN_LEDGER_LIFETIME"
  | "CAFE_INVENTORY_MONTHLY"
  | "CAFE_INVENTORY_LIFETIME";

export type ReportStatus =
  | "QUEUED"
  | "GENERATING"
  | "READY"
  | "FAILED"
  | "EXPIRED";

export interface AdminReport {
  id: string;
  type: ReportType;
  status: ReportStatus;
  year: number;
  month: number;
  filename: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  requestedByUsername: string;
}

export const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "SALES_MONTHLY", label: "Sales (monthly)" },
  { value: "RAZORPAY_RECON_MONTHLY", label: "Razorpay recon (monthly)" },
  { value: "CA_MONTHLY", label: "CA report (monthly)" },
  { value: "EXPENSES_MONTHLY", label: "Expenses (monthly)" },
  { value: "EXPENSES_LIFETIME", label: "Expenses (lifetime)" },
  { value: "REWARD_LIABILITY_MONTHLY", label: "Reward liability (monthly)" },
  { value: "REWARD_LIABILITY_LIFETIME", label: "Reward liability (lifetime)" },
  { value: "REWARD_ALERTS_MONTHLY", label: "Reward alerts (monthly)" },
  { value: "REWARD_TXN_LEDGER_MONTHLY", label: "Reward ledger (monthly)" },
  { value: "REWARD_TXN_LEDGER_LIFETIME", label: "Reward ledger (lifetime)" },
  { value: "CAFE_INVENTORY_MONTHLY", label: "Cafe inventory (monthly)" },
  { value: "CAFE_INVENTORY_LIFETIME", label: "Cafe inventory (lifetime)" },
];

export const adminReportsApi = {
  list: () =>
    request<{ reports: AdminReport[] }>("/api/mobile/admin/reports", {
      method: "GET",
    }),
  enqueue: (type: ReportType, year: number, month: number) =>
    request<{ success: true }>("/api/mobile/admin/reports", {
      method: "POST",
      body: { type, year, month },
    }),
};
