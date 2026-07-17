import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, type RouteProp } from "@react-navigation/native";
import {
  CalendarDays,
  Crown,
  MessageCircle,
  Ticket,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { BalanceRing } from "../../components/passes/BalanceRing";
import { colors, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import { passesApi, type PassDetail } from "../../lib/passes";
import { trackPassMemberAdded } from "../../lib/analytics";
import type { AccountStackParamList } from "../../navigation/types";

/**
 * Pass detail — mobile mirror of the web /passes/[id] page. Balance
 * ring + validity meta, shared-members roster (owner can add by phone /
 * remove; unregistered numbers get a WhatsApp invite), and the
 * redemption history with who booked each session.
 *
 * Registered in BOTH AccountStack (Account → My Passes → ticket) and
 * PassesStack (Passes tab) — same route name + params in each, so it's
 * typed via the route hook rather than per-navigator screen props.
 */

type Rt = RouteProp<AccountStackParamList, "PassDetail">;

const SPORT_ACCENT: Record<string, string> = {
  CRICKET: "#34d399",
  FOOTBALL: "#60a5fa",
  PICKLEBALL: "#facc15",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  UPCOMING: "Upcoming",
  EXHAUSTED: "Used up",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const fmtH = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const isLive = (s: string) => s === "ACTIVE" || s === "UPCOMING";

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function PassDetailScreen() {
  const route = useRoute<Rt>();
  const { passId } = route.params;
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["pass-detail", passId],
    queryFn: () => passesApi.detail(passId),
  });

  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [invitePhone, setInvitePhone] = useState<string | null>(null);

  const pass: PassDetail | undefined = data?.pass;

  const refreshAll = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["my-passes"] });
  };

  async function addMember() {
    const raw = phone.trim();
    if (!raw) return;
    setAdding(true);
    setMemberError(null);
    setInvitePhone(null);
    try {
      const res = await passesApi.addMember(passId, raw);
      if (res.ok) {
        trackPassMemberAdded();
        setPhone("");
        refreshAll();
      } else {
        setMemberError(res.error);
        if (res.notRegistered && res.phone) setInvitePhone(res.phone);
      }
    } catch {
      setMemberError("Couldn't add the member. Try again.");
    } finally {
      setAdding(false);
    }
  }

  function confirmRemove(userId: string, name: string | null) {
    Alert.alert(
      "Remove member?",
      `${name ?? "This member"} won't be able to book with this pass anymore.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const res = await passesApi
              .removeMember(passId, userId)
              .catch(() => ({ ok: false }) as const);
            if (!res.ok) {
              Alert.alert("Couldn't remove", "Please try again.");
            }
            refreshAll();
          },
        },
      ],
    );
  }

  function openWhatsAppInvite() {
    if (!pass || !invitePhone) return;
    const text = `Hey! I want to share my Momentum Arena "${pass.name}" pass with you 🎟️. Sign up at momentumarena.com using this number, then I'll add you and you can book with my pass hours!`;
    const url = `https://wa.me/${invitePhone}?text=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert("Couldn't open WhatsApp", "Is it installed on this phone?"),
    );
  }

  if (isLoading || !pass) {
    return (
      <Screen>
        <View style={styles.loadingBox}>
          {isLoading ? (
            <ActivityIndicator color={colors.emerald400} />
          ) : (
            <>
              <Ticket size={28} color={colors.zinc600} />
              <Text style={styles.loadingText}>
                This pass isn&apos;t available.
              </Text>
            </>
          )}
        </View>
      </Screen>
    );
  }

  const accent = SPORT_ACCENT[pass.sport] ?? "#34d399";
  const inactive = !isLive(pass.status);
  const isOwner = pass.role === "owner";
  const sharingOn = pass.maxMembers > 0;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refreshAll}
            tintColor={colors.emerald400}
          />
        }
      >
        {/* ── Header card: ring + status + name ── */}
        <View
          style={[
            styles.card,
            !inactive && { borderColor: `${accent}33` },
            inactive && { opacity: 0.75 },
          ]}
        >
          <View style={styles.headerTop}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: inactive ? colors.zinc800 : `${accent}22` },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  { color: inactive ? colors.zinc400 : accent },
                ]}
              >
                {STATUS_LABEL[pass.status] ?? pass.status}
              </Text>
            </View>
            {pass.role === "member" && (
              <Text style={styles.sharedTag}>
                Shared by {pass.owner.name ?? "owner"}
              </Text>
            )}
          </View>
          <Text style={styles.passName}>{pass.name}</Text>
          <Text style={styles.courtLabel}>{pass.courtLabel}</Text>

          <View style={styles.ringRow}>
            <BalanceRing
              total={pass.totalMinutes / 60}
              remaining={pass.remainingMinutes / 60}
              accent={accent}
              dim={inactive}
              size={128}
            />
            <View style={styles.ringSide}>
              <Text style={styles.ringSideBig}>
                {fmtH(pass.remainingMinutes)} left
              </Text>
              <Text style={styles.ringSideMuted}>
                {fmtH(pass.totalMinutes - pass.remainingMinutes)} used of{" "}
                {fmtH(pass.totalMinutes)}
              </Text>
              {pass.bandsSummary ? (
                <Text style={styles.bandsText}>{pass.bandsSummary}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Validity + purchase meta ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <CalendarDays size={15} color={colors.zinc400} />
            <Text style={styles.sectionTitle}>Validity</Text>
          </View>
          <MetaRow label="Starts" value={fmtDate(pass.startsAt)} />
          <MetaRow label="Expires" value={fmtDate(pass.expiresAt)} />
          <MetaRow label="Purchased" value={fmtDate(pass.purchasedAt)} />
          <MetaRow label="Price" value={formatRupees(pass.price)} />
        </View>

        {/* ── Members ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Users size={15} color={colors.zinc400} />
            <Text style={styles.sectionTitle}>
              Members
              {sharingOn
                ? ` · ${pass.members.length} of ${pass.maxMembers}`
                : ""}
            </Text>
          </View>

          {/* Owner row */}
          <View style={styles.memberRow}>
            <View style={styles.memberIcon}>
              <Crown size={14} color="#fbbf24" />
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>
                {pass.owner.name ?? "Pass owner"}
                {isOwner ? " (you)" : ""}
              </Text>
              <Text style={styles.memberMeta}>Owner</Text>
            </View>
          </View>

          {pass.members.map((m) => (
            <View key={m.userId} style={styles.memberRow}>
              <View style={styles.memberIcon}>
                <Users size={14} color={colors.zinc400} />
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{m.name ?? "Member"}</Text>
                <Text style={styles.memberMeta}>
                  {m.phone ? `+${m.phone}` : "—"} · added {fmtDate(m.addedAt)}
                </Text>
              </View>
              {isOwner && (
                <Pressable
                  onPress={() => confirmRemove(m.userId, m.name)}
                  hitSlop={8}
                  style={styles.removeBtn}
                >
                  <Trash2 size={15} color="#f87171" />
                </Pressable>
              )}
            </View>
          ))}

          {!sharingOn ? (
            <Text style={styles.memberHint}>
              Sharing isn&apos;t enabled for this pass.
            </Text>
          ) : isOwner && pass.status !== "CANCELLED" ? (
            <View style={styles.addBlock}>
              <View style={styles.addRow}>
                <TextInput
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t);
                    setMemberError(null);
                    setInvitePhone(null);
                  }}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={colors.zinc600}
                  keyboardType="phone-pad"
                  maxLength={13}
                  style={styles.phoneInput}
                />
                <Pressable
                  onPress={() => void addMember()}
                  disabled={adding || !phone.trim()}
                  style={({ pressed }) => [
                    styles.addBtn,
                    (adding || !phone.trim()) && { opacity: 0.5 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  {adding ? (
                    <ActivityIndicator size="small" color="#022c22" />
                  ) : (
                    <>
                      <UserPlus size={14} color="#022c22" />
                      <Text style={styles.addBtnText}>Add</Text>
                    </>
                  )}
                </Pressable>
              </View>
              {memberError ? (
                <Text style={styles.memberError}>{memberError}</Text>
              ) : null}
              {invitePhone ? (
                <Pressable
                  onPress={openWhatsAppInvite}
                  style={({ pressed }) => [
                    styles.waBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <MessageCircle size={14} color="#25D366" />
                  <Text style={styles.waBtnText}>Invite on WhatsApp</Text>
                </Pressable>
              ) : null}
              <Text style={styles.memberHint}>
                Members book with your pass hours; only you can manage the
                roster.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Redemption history ── */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ticket size={15} color={colors.zinc400} />
            <Text style={styles.sectionTitle}>Bookings with this pass</Text>
          </View>
          {pass.bookings.length === 0 ? (
            <Text style={styles.memberHint}>
              No bookings yet — pick your slots and choose “Book with my
              pass” at checkout.
            </Text>
          ) : (
            pass.bookings.map((b) => (
              <View key={`${b.bookingId}-${b.redeemedAt}`} style={styles.historyRow}>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {fmtDate(b.date)} · {b.timeLabel}
                  </Text>
                  <Text style={styles.memberMeta}>
                    {b.bookedBy ? `by ${b.bookedBy} · ` : ""}
                    {b.bookingStatus}
                    {b.restored ? " · hours restored" : ""}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.historyMinutes,
                    b.restored && styles.historyRestored,
                  ]}
                >
                  −{fmtH(b.minutes)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  loadingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    paddingVertical: 80,
  },
  loadingText: {
    fontSize: 14,
    color: colors.zinc500,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["4"],
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["2"],
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sharedTag: {
    fontSize: 11,
    color: "#7dd3fc",
  },
  passName: {
    marginTop: spacing["2"],
    fontSize: 18,
    fontWeight: "700",
    color: colors.foreground,
  },
  courtLabel: {
    marginTop: 2,
    fontSize: 12,
    color: colors.zinc500,
  },
  ringRow: {
    marginTop: spacing["4"],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["5"],
  },
  ringSide: {
    flex: 1,
    gap: 4,
  },
  ringSideBig: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  ringSideMuted: {
    fontSize: 12,
    color: colors.zinc500,
  },
  bandsText: {
    marginTop: 4,
    fontSize: 11,
    color: colors.zinc400,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing["3"],
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  metaLabel: {
    fontSize: 13,
    color: colors.zinc500,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.foreground,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
  memberIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.foreground,
  },
  memberMeta: {
    marginTop: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
  removeBtn: {
    padding: 6,
  },
  addBlock: {
    marginTop: spacing["2"],
    gap: spacing["2"],
  },
  addRow: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  phoneInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.background,
    paddingHorizontal: spacing["3"],
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    backgroundColor: colors.emerald500,
    paddingHorizontal: spacing["3"],
    justifyContent: "center",
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#022c22",
  },
  memberError: {
    fontSize: 12,
    color: "#fbbf24",
  },
  waBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(37,211,102,0.4)",
    backgroundColor: "rgba(37,211,102,0.08)",
    paddingVertical: 10,
  },
  waBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#25D366",
  },
  memberHint: {
    marginTop: spacing["1"],
    fontSize: 11,
    color: colors.zinc500,
    lineHeight: 16,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
  },
  historyMinutes: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  historyRestored: {
    color: colors.zinc500,
    textDecorationLine: "line-through",
  },
});
