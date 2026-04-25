import { Pressable, StyleSheet, View } from "react-native";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  XCircle,
} from "lucide-react-native";
import { Text } from "./ui/Text";
import { colors, spacing } from "../theme";
import {
  formatHoursAsRanges,
  formatRupees,
  sportEmoji,
  sportLabel,
} from "../lib/format";
import type { Booking, BookingStatus, Sport } from "../lib/types";

/**
 * Rich booking card for the My Bookings list — mirrors web's `BookingCard`
 * in `app/(protected)/bookings/page.tsx`.
 *
 * Layout (web: `rounded-2xl border border-zinc-800 bg-gradient-to-br
 * from-zinc-900 to-zinc-950 p-4`):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  [DateChip]   🏏 Cricket · Full Field               ₹1,600  │
 *   │               [Clock 11 AM – 12 PM] [✓ Confirmed]      >    │
 *   │               Booked on 22 Apr, 2026, 9:42 PM               │
 *   │                                                             │
 *   │  [PENDING warning banner if status === PENDING]             │
 *   └─────────────────────────────────────────────────────────────┘
 */

// Per-sport palette — mirrors `SPORT_THEME` in app/(protected)/bookings/page.tsx.
// CRICKET → emerald, FOOTBALL → sky, PICKLEBALL → amber.
const SPORT_THEME: Record<
  Sport,
  { chipBg: string; chipBorder: string; chipText: string; edgeTint: string }
> = {
  CRICKET: {
    // Web: bg-emerald-500/10
    chipBg: "rgba(16, 185, 129, 0.10)",
    // Web: border-emerald-500/30
    chipBorder: "rgba(16, 185, 129, 0.30)",
    // Web: text-emerald-300
    chipText: "#6ee7b7",
    edgeTint: "rgba(16, 185, 129, 0.10)",
  },
  FOOTBALL: {
    // Web: bg-sky-500/10
    chipBg: "rgba(14, 165, 233, 0.10)",
    // Web: border-sky-500/30
    chipBorder: "rgba(14, 165, 233, 0.30)",
    // Web: text-sky-300
    chipText: "#7dd3fc",
    edgeTint: "rgba(14, 165, 233, 0.10)",
  },
  PICKLEBALL: {
    // Web: bg-amber-500/10
    chipBg: "rgba(245, 158, 11, 0.10)",
    // Web: border-amber-500/30
    chipBorder: "rgba(245, 158, 11, 0.30)",
    // Web: text-amber-300
    chipText: "#fcd34d",
    edgeTint: "rgba(245, 158, 11, 0.10)",
  },
};

// Mirror of STATUS_TOKEN on web — used for the small status pill on the card.
const STATUS_TOKEN: Record<
  BookingStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    pillBg: string;
    pillBorder: string;
    pillText: string;
  }
> = {
  CONFIRMED: {
    label: "Confirmed",
    icon: CheckCircle2,
    pillBg: "rgba(16, 185, 129, 0.10)",
    pillBorder: "rgba(16, 185, 129, 0.30)",
    pillText: "#6ee7b7", // emerald-300
  },
  PENDING: {
    label: "Awaiting confirmation",
    icon: AlertCircle,
    pillBg: "rgba(234, 179, 8, 0.10)",
    pillBorder: "rgba(234, 179, 8, 0.30)",
    pillText: "#fde047", // yellow-300
  },
  CANCELLED: {
    label: "Cancelled",
    icon: XCircle,
    pillBg: "rgba(239, 68, 68, 0.10)",
    pillBorder: "rgba(239, 68, 68, 0.30)",
    pillText: "#fca5a5", // red-300
  },
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ────────────────────────────────────────────────────────────────────────────
// DateChip — web: h-16 w-16 rounded-2xl border + sport-tinted bg (muted if
// the booking is past + cancelled). Shows [MONTH] / [Day] / [Weekday].
// ────────────────────────────────────────────────────────────────────────────

interface DateChipProps {
  iso: string;
  theme: (typeof SPORT_THEME)[Sport];
  muted?: boolean;
}

function DateChip({ iso, theme, muted }: DateChipProps) {
  const d = new Date(iso);
  // Booking dates are stored at midnight UTC — displaying by UTC matches the
  // web's `formatBookingDate` output (which uses the IST timezone but for
  // midnight-UTC DATE values this produces the same calendar day).
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()].toUpperCase();
  const weekday = WEEKDAYS[d.getUTCDay()];

  return (
    <View
      style={[
        styles.dateChip,
        muted
          ? styles.dateChipMuted
          : {
              borderColor: theme.chipBorder,
              backgroundColor: theme.chipBg,
            },
      ]}
    >
      <Text
        style={[
          styles.dateChipMonth,
          { color: muted ? colors.zinc500 : theme.chipText },
        ]}
      >
        {month}
      </Text>
      <Text
        style={[
          styles.dateChipDay,
          { color: muted ? colors.zinc400 : colors.foreground },
        ]}
      >
        {day}
      </Text>
      <Text style={styles.dateChipWeekday}>{weekday.toUpperCase()}</Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BookingCard
// ────────────────────────────────────────────────────────────────────────────

interface BookingCardProps {
  booking: Booking;
  past?: boolean;
  onPress?: () => void;
}

export function BookingCard({ booking, past = false, onPress }: BookingCardProps) {
  const theme = SPORT_THEME[booking.courtConfig.sport];
  const status = STATUS_TOKEN[booking.status];
  const StatusIcon = status.icon;
  const muted = past && booking.status === "CANCELLED";
  const isPending = booking.status === "PENDING";

  const courtLabel = booking.wasBookedAsHalfCourt
    ? "Half Court (40×90)"
    : booking.courtConfig.label;

  const timeRange = formatHoursAsRanges(
    booking.slots.map((s) => s.startHour),
  );

  const bookedOn = formatBookedOn(booking.createdAt);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        muted && styles.cardMuted,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.row}>
        <DateChip iso={booking.date} theme={theme} muted={muted} />

        <View style={styles.body}>
          {/* Title row: emoji + sport name + court label */}
          <View style={styles.titleRow}>
            <Text style={styles.emoji}>
              {sportEmoji(booking.courtConfig.sport)}
            </Text>
            <Text
              variant="bodyStrong"
              color={colors.foreground}
              numberOfLines={1}
              style={styles.titleText}
            >
              {sportLabel(booking.courtConfig.sport)}
            </Text>
            <Text
              variant="small"
              color={muted ? colors.zinc600 : colors.zinc500}
              numberOfLines={1}
              style={styles.courtLabel}
            >
              {courtLabel}
            </Text>
          </View>

          {/* Meta row: time chip + status pill */}
          <View style={styles.metaRow}>
            <View style={styles.timeChip}>
              <Clock size={12} color={colors.zinc500} />
              <Text variant="small" color={colors.zinc300} weight="500">
                {timeRange}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: status.pillBg,
                  borderColor: status.pillBorder,
                },
              ]}
            >
              <StatusIcon size={12} color={status.pillText} />
              <Text
                style={[styles.statusPillText, { color: status.pillText }]}
              >
                {status.label}
              </Text>
            </View>
          </View>

          {/* Booked on line */}
          <View style={styles.bookedOnRow}>
            <CalendarDays size={12} color={colors.zinc500} />
            <Text variant="tiny" color={colors.zinc500}>
              Booked on {bookedOn}
            </Text>
          </View>
        </View>

        {/* Right column: price + chevron */}
        <View style={styles.rightCol}>
          <Text
            variant="bodyStrong"
            color={muted ? colors.zinc400 : colors.foreground}
          >
            {formatRupees(booking.totalAmount)}
          </Text>
          <ChevronRight size={16} color={colors.zinc600} />
        </View>
      </View>

      {/* PENDING warning banner */}
      {isPending && (
        <View style={styles.pendingBanner}>
          <AlertCircle size={14} color="#facc15" style={styles.pendingIcon} />
          <Text style={styles.pendingText}>
            Your slot is reserved. Our team will verify your payment and
            confirm this booking shortly — usually within 30 minutes.
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Web: formatBookingDate(b.createdAt, { day, month, year, hour, minute, hour12 })
// Produces e.g. "22 Apr, 2026, 9:42 PM" in IST.
function formatBookedOn(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  let h = d.getHours();
  const mins = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${month}, ${year}, ${h}:${String(mins).padStart(2, "0")} ${period}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Web: rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900
  //      to-zinc-950 p-4. RN can't easily do a subtle top-left→bottom-right
  //      gradient here, but zinc-900 is a visually close solid fallback.
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  // Web: opacity-70 for past + cancelled bookings
  cardMuted: {
    opacity: 0.7,
  },
  cardPressed: {
    opacity: 0.85,
  },
  // Web: flex items-center gap-4
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["4"],
  },

  // DateChip (web: h-16 w-16 rounded-2xl border). Slightly taller on native
  // with vertical padding so the [MONTH][Day][Weekday] stack breathes.
  dateChip: {
    width: 64,
    height: 72,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["1"],
  },
  dateChipMuted: {
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.60)", // zinc-900/60
  },
  // Web: text-[10px] font-bold uppercase tracking-widest leading-none
  dateChipMonth: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  // Web: mt-0.5 text-2xl font-bold leading-none
  dateChipDay: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "700",
  },
  // Web: mt-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500
  dateChipWeekday: {
    marginTop: 4,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "500",
    letterSpacing: 0.5,
    color: colors.zinc500,
  },

  // Content column
  body: {
    flex: 1,
    minWidth: 0,
  },
  // Web: flex flex-wrap items-center gap-2
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  // Web: text-base leading-none. Bumped slightly on native so the emoji
  // glyph reads clearly next to the sport name — Apple's emoji renderer
  // trims a lot of vertical space so we allow a little more line-height.
  emoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  titleText: {
    flexShrink: 1,
  },
  courtLabel: {
    flexShrink: 1,
  },

  // Web: mt-2 flex flex-wrap items-center gap-2
  metaRow: {
    marginTop: spacing["2"],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    flexWrap: "wrap",
  },
  // Web: inline-flex items-center gap-1 rounded-lg bg-zinc-800/70 px-2 py-1
  //      text-xs font-medium text-zinc-300
  timeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(39, 39, 42, 0.70)", // zinc-800/70
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
    borderRadius: 8,
  },
  // Web: inline-flex items-center gap-1 rounded-full border px-2 py-0.5
  //      text-[11px] font-semibold
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "600",
  },

  // Web: mt-2 flex items-center gap-1 text-[11px] text-zinc-500
  bookedOnRow: {
    marginTop: spacing["2"],
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  // Web: right-side price column
  rightCol: {
    alignItems: "flex-end",
    gap: 4,
  },

  // Web: PENDING banner — mt-3 rounded-xl border-yellow-500/20 bg-yellow-500/5
  //      px-3 py-2
  pendingBanner: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.20)",
    backgroundColor: "rgba(234, 179, 8, 0.05)",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  pendingIcon: {
    marginTop: 2,
  },
  // Web: text-[11px] leading-snug text-yellow-200/80
  pendingText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: "rgba(254, 240, 138, 0.80)", // yellow-200/80
  },
});
