/**
 * Shared API response types for the mobile app. Mirrors Prisma shapes with
 * dates serialized as ISO strings (what `NextResponse.json` emits).
 */

export type Sport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export type ConfigSize =
  | "XS"
  | "SMALL"
  | "MEDIUM"
  | "LARGE"
  | "XL"
  | "FULL"
  | "SHARED";

export type CourtZone =
  | "LEATHER_1"
  | "BOX_A"
  | "BOX_B"
  | "LEATHER_2"
  | "SHARED_COURT";

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export type PaymentMethod =
  | "RAZORPAY"
  | "PHONEPE"
  | "UPI_QR"
  | "CASH"
  | "FREE";

export type PaymentStatus =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETED"
  | "REFUNDED"
  | "FAILED";

export type CafeItemCategory =
  | "SNACKS"
  | "BEVERAGES"
  | "MEALS"
  | "DESSERTS"
  | "COMBOS";

// Sub-category within CRICKET. Mirror of the Prisma BookingCategory
// enum — used to distinguish the bowling-machine flow from regular
// box-cricket configs without growing the Sport union.
export type BookingCategory = "BOX_CRICKET" | "BOWLING_MACHINE";

export interface CourtConfig {
  id: string;
  sport: Sport;
  size: ConfigSize;
  label: string;
  position: string;
  widthFt: number;
  lengthFt: number;
  zones: CourtZone[];
  isActive: boolean;
  // BOWLING_MACHINE for the half-hour court, BOX_CRICKET for the
  // regular cricket configs, null for football / pickleball.
  category?: BookingCategory | null;
  // 30 for the bowling-machine court, 60 otherwise. Lets the slot
  // picker show consecutive 30-min tiles vs hourly without an
  // additional round-trip.
  slotDurationMinutes?: number;
}

export interface BookingSlot {
  id: string;
  bookingId: string;
  startHour: number;
  price: number;
}

export interface Payment {
  id: string;
  bookingId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  isPartialPayment: boolean;
  advanceAmount: number | null;
  remainingAmount: number | null;
  utrNumber: string | null;
}

export interface Booking {
  id: string;
  userId: string;
  courtConfigId: string;
  date: string; // ISO
  status: BookingStatus;
  totalAmount: number;
  originalAmount: number | null;
  discountAmount: number;
  wasBookedAsHalfCourt: boolean;
  qrToken: string | null;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
  courtConfig: CourtConfig;
  slots: BookingSlot[];
  payment: Payment | null;
}

export interface DashboardResponse {
  upcomingCount: number;
  totalBookings: number;
  upcomingBookings: Booking[];
}

export interface BookingsListSummary {
  total: number;
  upcoming: number;
  confirmed: number;
  totalSpent: number;
}

export interface BookingsListResponse {
  bookings: Booking[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
  /** Present only on page 1 — hero stats for the list header. */
  summary?: BookingsListSummary;
}

export type RecurringStatus = "ACTIVE" | "PAUSED" | "CANCELLED";

export interface RecurringSeries {
  id: string;
  status: RecurringStatus;
  /** 0=Sun … 6=Sat — matches Prisma. */
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  courtConfig: {
    sport: Sport;
    size: ConfigSize;
    label: string;
  };
  /** Next up to 3 upcoming confirmed instances. ISO date strings. */
  bookings: Array<{
    id: string;
    date: string;
    totalAmount: number;
  }>;
}

export interface RecurringListResponse {
  recurring: RecurringSeries[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
}

export interface CafeItem {
  id: string;
  name: string;
  description: string | null;
  category: CafeItemCategory;
  price: number;
  // Stock counter. null = unlimited / kitchen-prepared (no decrement
  // on order); integer = on-hand units tracked for procured items.
  // Drives Ready vs Kitchen routing for COMPLETED vs PENDING orders.
  quantity: number | null;
  image: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  sortOrder: number;
  tags: string[];
}
