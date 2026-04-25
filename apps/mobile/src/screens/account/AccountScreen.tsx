import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  ChevronRight,
  Clock,
  History,
  LogIn,
  LogOut,
  Phone,
  Plus,
  RefreshCw,
  Shield,
  User as UserIcon,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, spacing } from "../../theme";
import { useAuth } from "../../providers/AuthProvider";
import { bookingsApi } from "../../lib/bookings";
import {
  formatHoursAsRanges,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import type { Booking } from "../../lib/types";
import type {
  AccountStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "AccountHome">;
type TabNav = BottomTabNavigationProp<MainTabsParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

/**
 * My Profile — mirrors the web profile layout (bg-zinc-900 cards, emerald
 * avatar, blue USER role pill) but trimmed for the phone-OTP-only mobile
 * app:
 *
 *   1. Title block "My Profile" + subtitle
 *   2. Profile Header card — emerald-500/20 avatar + name + USER role pill
 *   3. Account Info card — Full Name + Phone only (no email, no edit flow
 *      since the mobile backend only allows name changes via /me)
 *   4. Quick action tiles — Booking History + Recurring (mirrors the web
 *      home's two-up tile grid so bookings are one tap away)
 *   5. Sign out button + version footer
 */
export function AccountScreen() {
  const { state, signOut } = useAuth();
  const navigation = useNavigation<Nav>();
  const user = state.status === "signedIn" ? state.user : null;

  // Dashboard gives us the upcoming sessions list that web renders in the
  // same layout (empty-state card ↔ list of mini booking cards). Enabled
  // only when signed in — no-op hook call is harmless when signed out.
  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => bookingsApi.dashboard(),
    enabled: !!user,
  });

  if (!user) {
    return <SignedOutAccount />;
  }

  const upcomingBookings = dashboard?.upcomingBookings ?? [];
  const goToBook = () =>
    navigation
      .getParent<BottomTabNavigationProp<MainTabsParamList>>()
      ?.navigate("Book", { screen: "BookSport" });

  function confirmSignOut() {
    Alert.alert(
      "Sign out?",
      "You'll need to verify OTP again to sign back in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => void signOut(),
        },
      ],
    );
  }

  const initial = user.name?.charAt(0)?.toUpperCase() ?? "?";

  return (
    <Screen scrollable>
      {/* ─── Title block ─────────────────────────────────────────────── */}
      <View style={styles.titleBlock}>
        <Text style={styles.title}>My Profile</Text>
        <Text style={styles.subtitle}>Manage your account information</Text>
      </View>

      {/* ─── Profile Header card ─────────────────────────────────────── */}
      <View style={styles.profileHeaderCard}>
        <View style={styles.profileHeaderRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.profileHeaderBody}>
            <Text style={styles.profileName}>{user.name ?? "Player"}</Text>
            <View style={styles.profilePillRow}>
              {/* USER role pill — mobile users are always regular so we
                  hard-code USER without needing the server to return a role. */}
              <View style={[styles.rolePill, styles.rolePillUser]}>
                <Shield size={12} color="#60a5fa" />
                <Text style={[styles.rolePillText, styles.rolePillUserText]}>
                  USER
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* ─── Account Info ────────────────────────────────────────────── */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionHeader}>Account Info</Text>
        <View style={styles.infoList}>
          <InfoRow
            icon={<UserIcon size={16} color={colors.zinc400} />}
            label="Name"
            value={user.name ?? "Not set"}
          />
          <InfoRow
            icon={<Phone size={16} color={colors.zinc400} />}
            label="Phone"
            value={user.phone ? `+91 ${user.phone}` : "Not set"}
          />
        </View>
      </View>

      {/* ─── Quick action tiles (full-width, stacked) ────────────────── */}
      <View style={styles.tilesStack}>
        <ActionTile
          icon={<History size={20} color={colors.zinc400} />}
          title="Booking History"
          subtitle="View past sessions"
          onPress={() => navigation.navigate("BookingsList")}
        />
        <ActionTile
          icon={<RefreshCw size={20} color={colors.zinc400} />}
          title="Recurring Bookings"
          subtitle="Weekly series"
          onPress={() => navigation.navigate("RecurringBookings")}
        />
      </View>

      {/* ─── Upcoming Sessions ───────────────────────────────────────── */}
      <View style={styles.upcomingSection}>
        <View style={styles.upcomingHeader}>
          <Text style={styles.sectionHeader}>Upcoming Sessions</Text>
          {upcomingBookings.length > 0 && (
            <Pressable
              onPress={() => navigation.navigate("BookingsList")}
              hitSlop={8}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>View all</Text>
              <ArrowRight size={12} color={colors.emerald500} />
            </Pressable>
          )}
        </View>

        {upcomingBookings.length > 0 ? (
          <View style={styles.upcomingList}>
            {upcomingBookings.map((b, i) => (
              <UpcomingCard
                key={b.id}
                booking={b}
                isNext={i === 0}
                onPress={() =>
                  navigation.navigate("BookingDetail", { bookingId: b.id })
                }
              />
            ))}
          </View>
        ) : (
          <UpcomingEmpty onBook={goToBook} />
        )}
      </View>

      {/* ─── Footer: sign out + version ──────────────────────────────── */}
      <Button
        label="Sign out"
        variant="secondary"
        onPress={confirmSignOut}
        leadingIcon={<LogOut size={18} color={colors.foreground} />}
        fullWidth
        style={styles.signOut}
      />
      <Text style={styles.version}>Momentum Arena · v0.1.0</Text>
    </Screen>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Upcoming Sessions sub-components
// ────────────────────────────────────────────────────────────────────────────

// Per-sport accent for the "next" (index 0) booking card. For non-next cards
// we fall back to a neutral zinc theme. Mirrors web's SPORT_COLORS.
const SPORT_ACCENT: Record<
  Booking["courtConfig"]["sport"],
  { border: string; bg: string; tileBg: string; text: string }
> = {
  CRICKET: {
    border: "rgba(16, 185, 129, 0.30)",
    bg: "rgba(16, 185, 129, 0.08)",
    tileBg: "rgba(16, 185, 129, 0.15)",
    text: "#6ee7b7", // emerald-300
  },
  FOOTBALL: {
    border: "rgba(14, 165, 233, 0.30)",
    bg: "rgba(14, 165, 233, 0.08)",
    tileBg: "rgba(14, 165, 233, 0.15)",
    text: "#7dd3fc", // sky-300
  },
  PICKLEBALL: {
    border: "rgba(245, 158, 11, 0.30)",
    bg: "rgba(245, 158, 11, 0.08)",
    tileBg: "rgba(245, 158, 11, 0.15)",
    text: "#fcd34d", // amber-300
  },
};

const MONTHS_SHORT = [
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
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${
    MONTHS_SHORT[d.getUTCMonth()]
  }`;
}

interface UpcomingCardProps {
  booking: Booking;
  isNext: boolean;
  onPress: () => void;
}

/**
 * Compact upcoming-session row — web: `/app/(protected)/dashboard/page.tsx`
 *
 *   - `isNext` (index 0): sport-tinted border + gradient bg + "NEXT" pill
 *   - otherwise: neutral `border-zinc-800 bg-zinc-900/60`
 *   - Two-line layout: sport icon tile + name/label/price on top,
 *     date + time chips on the bottom
 */
function UpcomingCard({ booking, isNext, onPress }: UpcomingCardProps) {
  const accent = SPORT_ACCENT[booking.courtConfig.sport];
  const courtLabel = booking.wasBookedAsHalfCourt
    ? "Half Court (40×90)"
    : booking.courtConfig.label;
  const timeRange = formatHoursAsRanges(
    booking.slots.map((s) => s.startHour),
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.upcomingCard,
        isNext
          ? {
              borderColor: accent.border,
              backgroundColor: accent.bg,
            }
          : styles.upcomingCardMuted,
        pressed && styles.upcomingCardPressed,
      ]}
    >
      <View style={styles.upcomingTopRow}>
        <View
          style={[
            styles.upcomingIconTile,
            isNext
              ? { backgroundColor: accent.tileBg }
              : { backgroundColor: colors.zinc800 },
          ]}
        >
          <Calendar
            size={16}
            color={isNext ? accent.text : colors.zinc400}
          />
        </View>
        <View style={styles.upcomingBody}>
          <View style={styles.upcomingTitleRow}>
            <Text
              style={styles.upcomingSportName}
              numberOfLines={1}
            >
              {sportLabel(booking.courtConfig.sport)}
            </Text>
            {isNext && (
              <View style={styles.nextPill}>
                <Text style={styles.nextPillText}>NEXT</Text>
              </View>
            )}
          </View>
          <Text style={styles.upcomingCourtLabel} numberOfLines={1}>
            {courtLabel}
          </Text>
        </View>
        <View style={styles.upcomingRightCol}>
          <Text
            style={[
              styles.upcomingPrice,
              { color: isNext ? accent.text : colors.foreground },
            ]}
          >
            {formatRupees(booking.totalAmount)}
          </Text>
          <ChevronRight size={16} color={colors.zinc600} />
        </View>
      </View>

      {/* Bottom meta — web: ml-[44px] date + time chips */}
      <View style={styles.upcomingMetaRow}>
        <View style={styles.upcomingMetaChip}>
          <Calendar size={12} color={colors.zinc500} />
          <Text style={styles.upcomingMetaText}>
            {formatShortDate(booking.date)}
          </Text>
        </View>
        <View style={styles.upcomingMetaChip}>
          <Clock size={12} color={colors.zinc500} />
          <Text style={styles.upcomingMetaText}>{timeRange}</Text>
        </View>
      </View>
    </Pressable>
  );
}

interface UpcomingEmptyProps {
  onBook: () => void;
}

/**
 * Dashed-border empty card — web: `border-dashed border-zinc-800
 * bg-zinc-900/30 py-12 px-6 text-center` with calendar circle, two text
 * lines, and a rounded-full emerald-600 "Book Now" button.
 */
function UpcomingEmpty({ onBook }: UpcomingEmptyProps) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconCircle}>
        <Calendar size={32} color={colors.zinc600} />
      </View>
      <Text style={styles.emptyTitle}>No upcoming sessions</Text>
      <Text style={styles.emptySubtitle}>
        Book your first court and get playing!
      </Text>
      <Pressable
        onPress={onBook}
        style={({ pressed }) => [
          styles.emptyCta,
          pressed && styles.emptyCtaPressed,
        ]}
      >
        <Plus size={16} color={colors.foreground} />
        <Text style={styles.emptyCtaText}>Book Now</Text>
      </Pressable>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Signed-out hero
// ────────────────────────────────────────────────────────────────────────────

function SignedOutAccount() {
  const navigation = useNavigation<Nav>();
  const tabNav = navigation.getParent<TabNav>();
  const rootNav = tabNav?.getParent<RootNav>();

  return (
    <Screen scrollable>
      <View style={styles.signedOutHero}>
        <View style={styles.signedOutIcon}>
          <UserIcon size={36} color={colors.primary} />
        </View>
        <Text variant="title" align="center" style={styles.signedOutTitle}>
          Sign in to Momentum Arena
        </Text>
        <Text
          variant="body"
          color={colors.mutedForeground}
          align="center"
          style={styles.signedOutSub}
        >
          View your bookings, speed up checkout, and earn your first-booking
          discount.
        </Text>

        <Button
          label="Sign in"
          onPress={() => rootNav?.navigate("Phone")}
          leadingIcon={<LogIn size={18} color={colors.primaryForeground} />}
          fullWidth
          size="lg"
          style={styles.signInBtn}
        />
      </View>

      <Card style={styles.perksCard}>
        <Perk
          emoji="📅"
          title="Track your bookings"
          body="See upcoming slots, booking IDs, and check-in details."
        />
        <Divider />
        <Perk
          emoji="⚡"
          title="Faster checkout"
          body="We'll remember your phone and preferences."
        />
        <Divider />
        <Perk
          emoji="🎁"
          title="First booking offer"
          body="Flat ₹100 off is applied automatically at checkout."
        />
      </Card>

      <Text style={styles.version}>Momentum Arena · v0.1.0</Text>
    </Screen>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabel}>
        {icon}
        <Text style={styles.infoLabelText}>{label}</Text>
      </View>
      <Text style={styles.infoValueText} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

interface ActionTileProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}

/**
 * Web home page has a 2-up tile grid (Booking History / Recurring) in
 * rounded-xl cards with a muted icon tile on the left, stacked text in
 * the middle, and a small chevron on the right. We mirror that layout.
 */
function ActionTile({ icon, title, subtitle, onPress }: ActionTileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={styles.tileIcon}>{icon}</View>
      <View style={styles.tileBody}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={16} color={colors.zinc600} />
    </Pressable>
  );
}

function Perk({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.perkRow}>
      <Text style={styles.perkEmoji}>{emoji}</Text>
      <View style={styles.perkBody}>
        <Text variant="bodyStrong">{title}</Text>
        <Text
          variant="small"
          color={colors.mutedForeground}
          style={styles.perkSub}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Title block ────────────────────────────────────────────────────
  titleBlock: {
    marginBottom: spacing["6"],
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: colors.zinc400,
  },

  // ── Profile Header card (web: rounded-2xl border-zinc-800 bg-zinc-900 p-6)
  profileHeaderCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["6"],
    marginBottom: spacing["6"],
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["4"],
  },
  // Web: h-16 w-16 rounded-full bg-emerald-500/20 text-emerald-400
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.emerald500_20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.emerald400,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  profileHeaderBody: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    color: colors.foreground,
  },
  profilePillRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    flexWrap: "wrap",
  },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
  },
  // Web: border-blue-500/30 bg-blue-500/10 text-blue-400 for USER
  rolePillUser: {
    borderColor: "rgba(59, 130, 246, 0.30)",
    backgroundColor: "rgba(59, 130, 246, 0.10)",
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  rolePillUserText: {
    color: "#60a5fa",
  },

  // ── Section card (web: rounded-xl border-zinc-800 bg-zinc-900 p-5)
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: 20,
    marginBottom: spacing["6"],
    gap: spacing["3"],
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 1,
    color: colors.zinc500,
    textTransform: "uppercase",
  },
  infoList: {
    gap: spacing["2"],
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
  },
  infoLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  infoLabelText: {
    fontSize: 14,
    color: colors.zinc400,
  },
  infoValueText: {
    fontSize: 14,
    color: colors.foreground,
    flexShrink: 1,
    textAlign: "right",
  },

  // ── Action tiles stack — full-width rows (web home's Booking History
  //     + Recurring tiles, but stacked vertically on mobile so each fills
  //     the row).
  tilesStack: {
    gap: spacing["3"],
    marginBottom: spacing["6"],
  },
  // Each tile: rounded-xl border-zinc-800 bg-zinc-900 p-4 with icon + text.
  // No `flex: 1` now — the tile takes full width from its parent container.
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  tilePressed: {
    opacity: 0.85,
  },
  // Web: bg-zinc-800 rounded-lg p-2 icon tile
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  tileBody: {
    flex: 1,
    minWidth: 0,
  },
  tileTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  tileSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.zinc500,
  },

  // ── Upcoming Sessions section (web dashboard parity)
  upcomingSection: {
    marginBottom: spacing["6"],
  },
  // Web: mb-3 flex items-center justify-between
  upcomingHeader: {
    marginBottom: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  // Web: text-xs text-emerald-500 + ArrowRight
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAllText: {
    fontSize: 12,
    color: colors.emerald500,
    fontWeight: "500",
  },
  upcomingList: {
    gap: spacing["2"],
  },
  // Web: rounded-xl border p-4, with per-sport accent for the "next" booking
  upcomingCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing["4"],
  },
  // Web: border-zinc-800/80 bg-zinc-900/60 for non-next cards
  upcomingCardMuted: {
    borderColor: "rgba(39, 39, 42, 0.80)",
    backgroundColor: "rgba(24, 24, 27, 0.60)",
  },
  upcomingCardPressed: {
    opacity: 0.85,
  },
  // Web: flex items-center gap-3
  upcomingTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  // Web: shrink-0 rounded-lg p-2 (28x28)
  upcomingIconTile: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  upcomingBody: {
    flex: 1,
    minWidth: 0,
  },
  upcomingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  // Web: font-medium text-white truncate
  upcomingSportName: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
    flexShrink: 1,
  },
  // Web: rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold
  //      uppercase tracking-wider text-emerald-400
  nextPill: {
    borderRadius: 999,
    backgroundColor: colors.emerald500_20,
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
  },
  nextPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.emerald400,
  },
  // Web: text-xs text-zinc-500 truncate
  upcomingCourtLabel: {
    marginTop: 2,
    fontSize: 12,
    color: colors.zinc500,
  },
  upcomingRightCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  // Web: text-sm font-bold (color inherits the sport accent)
  upcomingPrice: {
    fontSize: 14,
    fontWeight: "700",
  },
  // Web: mt-2 ml-[44px] flex items-center gap-4 text-xs text-zinc-400
  upcomingMetaRow: {
    marginTop: spacing["2"],
    marginLeft: 40, // roughly aligns with the body column after the icon
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["4"],
  },
  upcomingMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  upcomingMetaText: {
    fontSize: 12,
    color: colors.zinc400,
  },

  // Empty card — web: border-dashed border-zinc-800 bg-zinc-900/30
  //               py-12 px-6 text-center
  emptyCard: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderStyle: "dashed",
    backgroundColor: "rgba(24, 24, 27, 0.30)",
    paddingVertical: 48,
    paddingHorizontal: spacing["6"],
  },
  // Web: rounded-full bg-zinc-800/80 p-4
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(39, 39, 42, 0.80)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["4"],
  },
  // Web: text-base font-medium text-zinc-400
  emptyTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: colors.zinc400,
  },
  // Web: mt-1 text-sm text-zinc-600
  emptySubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: colors.zinc600,
    textAlign: "center",
  },
  // Web: mt-5 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium
  emptyCta: {
    marginTop: spacing["5"],
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669", // emerald-600
    paddingHorizontal: spacing["5"],
    paddingVertical: 10,
    borderRadius: 999,
  },
  emptyCtaPressed: {
    backgroundColor: "#10b981", // emerald-500
  },
  emptyCtaText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },

  // ── Footer
  signOut: {
    marginTop: spacing["2"],
  },
  version: {
    textAlign: "center",
    marginTop: spacing["6"],
    fontSize: 11,
    color: colors.subtleForeground,
    letterSpacing: 0.4,
  },

  // ── Signed-out state
  signedOutHero: {
    alignItems: "center",
    paddingTop: spacing["10"],
    paddingBottom: spacing["8"],
    gap: spacing["2"],
  },
  signedOutIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primarySoft,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["3"],
  },
  signedOutTitle: {
    marginTop: spacing["2"],
  },
  signedOutSub: {
    marginTop: spacing["1"],
    maxWidth: 320,
  },
  signInBtn: {
    marginTop: spacing["6"],
  },
  perksCard: {
    gap: spacing["2"],
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
  perkEmoji: {
    fontSize: 24,
    width: 36,
    textAlign: "center",
  },
  perkBody: {
    flex: 1,
  },
  perkSub: {
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});
