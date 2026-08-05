import { api } from "./api";

/**
 * Coaching camps — the app's read + register surface.
 *
 * Every route is the SAME one the web uses (unified auth: cookie on web,
 * bearer here), so pricing, capacity and the waitlist can't drift between
 * platforms. The server prices a registration; the app never sends an
 * amount.
 */

export type CampSummary = {
  id: string;
  slug: string;
  name: string;
  sport: string;
  status: string;
  description: string | null;
  bannerImageUrl: string | null;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
  ageMin: number | null;
  ageMax: number | null;
  coachName: string | null;
  capacity: number;
  fee: number;
  feeMode: string;
  advancePct: number;
  waitlistEnabled: boolean;
  seatsTaken: number;
  seatsLeft: number;
};

export type CampDetail = CampSummary & {
  rules: string | null;
  venueNote: string | null;
  regOpenAt: string | null;
  regCloseAt: string | null;
  allowCoupons: boolean;
  allowRewardPoints: boolean;
};

export type MyCampRegistration = {
  id: string;
  status: string;
  participantName: string;
  paidAmount: number;
  dueAmount: number;
  createdAt: string;
  camp: {
    slug: string;
    name: string;
    sport: string;
    startDate: string;
    endDate: string;
    startHour: number;
    endHour: number;
    daysOfWeek: number[];
  };
};

export type CampsHub = { enabled: boolean; camps: CampSummary[] };

/** Module switch + list in one call. The tab bar reads `enabled` to
 *  decide whether a Camps entry belongs in the arc at all. */
export async function fetchCampsHub(): Promise<CampsHub> {
  return api.get<CampsHub>("/api/mobile/camps?hub=1", { auth: false });
}

export async function fetchCamps(): Promise<CampSummary[]> {
  const res = await api.get<{ camps: CampSummary[] }>("/api/mobile/camps");
  return res.camps;
}

export async function fetchCamp(slug: string): Promise<CampDetail> {
  const res = await api.get<{ camp: CampDetail }>(
    `/api/mobile/camps?slug=${encodeURIComponent(slug)}`,
  );
  return res.camp;
}

export async function fetchMyCampRegistrations(): Promise<MyCampRegistration[]> {
  const res = await api.get<{ registrations: MyCampRegistration[] }>(
    "/api/mobile/camps?mine=1",
  );
  return res.registrations;
}

export interface CampRegisterResponse {
  registrationId: string;
  /** 0 for a free camp or a waitlist entry — nothing to pay. */
  payableNow: number;
  waitlisted?: boolean;
  orderId?: string;
  keyId?: string;
  campName?: string;
  error?: string;
}

export async function registerForCamp(input: {
  campId: string;
  participantName: string;
  participantAge?: string;
  guardianName?: string;
  phone: string;
  email?: string;
  couponCode?: string;
}): Promise<CampRegisterResponse> {
  return api.post("/api/camps/register", input);
}

export async function verifyCampPayment(args: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<{ success?: boolean; error?: string }> {
  return api.post("/api/camps/verify", args);
}
