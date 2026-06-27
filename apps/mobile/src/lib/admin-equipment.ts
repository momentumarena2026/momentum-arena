import { request } from "./admin-api";

export interface AdminEquipment {
  id: string;
  name: string;
  sport: string | null;
  category: string | null;
  pricePerHour: number;
  totalUnits: number;
  availableUnits: number;
  isActive: boolean;
  isCustomerSelectable: boolean;
  displayOrder: number;
  imageUrl: string | null;
  _count: { rentals: number };
}

export interface CreateEquipmentInput {
  name: string;
  sport?: string | null;
  pricePerHour: number;
  totalUnits: number;
  isCustomerSelectable?: boolean;
}

export type UpdateEquipmentInput = Partial<
  CreateEquipmentInput & { isActive: boolean; availableUnits: number }
>;

export const adminEquipmentApi = {
  list: (showInactive = false) =>
    request<{ equipment: AdminEquipment[] }>(
      `/api/mobile/admin/equipment${showInactive ? "?showInactive=1" : ""}`,
      { method: "GET" },
    ),
  create: (body: CreateEquipmentInput) =>
    request<{ ok: true }>("/api/mobile/admin/equipment", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateEquipmentInput) =>
    request<{ ok: true }>(`/api/mobile/admin/equipment/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/equipment/${id}`, {
      method: "DELETE",
    }),
};
