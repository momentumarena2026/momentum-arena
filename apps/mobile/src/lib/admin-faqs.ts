import { request } from "./admin-api";

export interface AdminFaq {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  category: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaqInput {
  question: string;
  answer: string;
  keywords?: string[];
  category: string;
  sortOrder?: number;
}

export type UpdateFaqInput = Partial<CreateFaqInput & { isActive: boolean }>;

export const adminFaqsApi = {
  list: () =>
    request<{ faqs: AdminFaq[] }>("/api/mobile/admin/faqs", { method: "GET" }),
  create: (body: CreateFaqInput) =>
    request<{ ok: true }>("/api/mobile/admin/faqs", { method: "POST", body }),
  update: (id: string, body: UpdateFaqInput) =>
    request<{ ok: true }>(`/api/mobile/admin/faqs/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/faqs/${id}`, { method: "DELETE" }),
};
