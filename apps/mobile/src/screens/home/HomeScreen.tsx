import { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Phone as PhoneIcon,
  Video,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { BookingCard } from "../../components/BookingCard";
import { colors, radius, spacing } from "../../theme";
import { useAuth } from "../../providers/AuthProvider";
import { bookingsApi } from "../../lib/bookings";
import { env } from "../../config/env";
import type {
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Nav = BottomTabNavigationProp<MainTabsParamList, "Home">;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

const ASSETS = `${env.apiUrl}`;

const SPORTS = [
  {
    slug: "CRICKET" as const,
    name: "Cricket",
    image: `${ASSETS}/cricket.png`,
    tagline: "Professional turf & bowling machine",
    tint: "rgba(16, 185, 129, 0.55)",
    border: colors.primary,
  },
  {
    slug: "FOOTBALL" as const,
    name: "Football",
    image: `${ASSETS}/football.jpeg`,
    tagline: "Full-size turf under floodlights",
    tint: "rgba(59, 130, 246, 0.55)",
    border: "#3b82f6",
  },
  {
    slug: "PICKLEBALL" as const,
    name: "Pickleball",
    image: `${ASSETS}/pickleball.png`,
    tagline: "Fast-growing sport, professional court",
    tint: "rgba(234, 179, 8, 0.55)",
    border: "#eab308",
    comingSoon: true,
  },
];

const FACILITIES = [
  { icon: "🏟️", title: "Professional Turf", desc: "High-quality artificial turf for competitive play across all sports." },
  { icon: "💡", title: "Floodlights", desc: "Play day or night with professional-grade floodlighting on every court." },
  { icon: "🪑", title: "Spectator Seating", desc: "Comfortable seating for friends and family to watch matches live." },
  { icon: "☕", title: "Cafeteria", desc: "Snacks, beverages and refreshments to recharge before or after your game." },
  { icon: "🅿️", title: "Ample Parking", desc: "Spacious parking area for hassle-free arrivals." },
  { icon: "🚻", title: "Clean Washrooms", desc: "Separate, well-maintained washrooms for your comfort." },
];

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const rootNav = navigation.getParent<RootNav>();
  const { state } = useAuth();
  const signedIn = state.status === "signedIn";
  const firstName = signedIn ? state.user.name?.split(" ")[0] ?? null : null;

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ["dashboard"],
    queryFn: bookingsApi.dashboard,
    enabled: signedIn,
  });

  const onRefresh = useCallback(() => {
    if (signedIn) void refetch();
  }, [refetch, signedIn]);

  function openSport(slug: (typeof SPORTS)[number]["slug"]) {
    navigation.navigate("Sports", {
      screen: "BookCourt",
      params: { sport: slug },
    });
  }

  function signIn() {
    rootNav?.navigate("Phone");
  }

  return (
    <Screen padded={false} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          signedIn ? (
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      >
        {/* Top nav */}
        <View style={styles.topNav}>
          <Image
            source={{ uri: `${ASSETS}/blackLogo.png` }}
            style={styles.logo}
            resizeMode="contain"
          />
          {signedIn ? (
            <Text variant="small" color={colors.primary} weight="700">
              Hi{firstName ? `, ${firstName}` : ""} 👋
            </Text>
          ) : (
            <Button label="Sign in" variant="secondary" size="sm" onPress={signIn} />
          )}
        </View>

        {/* Promo banner */}
        <View style={styles.promo}>
          <Text variant="small" weight="600" style={styles.promoText}>
            New users: Flat ₹100 OFF on your first booking — applied
            automatically at checkout.
          </Text>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <HeroBackground />
          <View style={styles.heroLogoWrap}>
            {/* Web parity: emerald-500/20 blur-3xl glow at scale-75 behind logo */}
            <HeroLogoGlow />
            <Image
              source={{ uri: `${ASSETS}/blackLogo.png` }}
              style={styles.heroLogo}
              resizeMode="contain"
            />
          </View>
          <Text variant="tiny" color={colors.mutedForeground} style={styles.heroKicker}>
            MATHURA'S PREMIER
          </Text>
          <Text variant="display" style={styles.heroTitle} align="center">
            Multi-sport Arena
          </Text>
          <Text variant="body" color={colors.mutedForeground} align="center" style={styles.heroSub}>
            Cricket • Football • Pickleball
          </Text>
          <Text variant="small" color={colors.subtleForeground} align="center">
            Professional courts • Floodlights • Cafeteria • Open 5 AM – 1 AM
          </Text>
          <View style={styles.heroCtas}>
            <Button
              label="🏟  Book a Court"
              size="lg"
              onPress={() =>
                navigation.navigate("Sports", { screen: "BookSport" })
              }
              fullWidth
              style={styles.heroBtnPrimary}
            />
            <Pressable
              onPress={() => navigation.navigate("Cafe")}
              style={({ pressed }) => [styles.heroBtnAmber, pressed && styles.pressed]}
            >
              <Text variant="bodyStrong" color="#fff">☕  Order Food</Text>
            </Pressable>
          </View>
        </View>

        {/* Signed-in: upcoming bookings */}
        {signedIn && data && data.upcomingBookings.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text variant="heading">Your upcoming bookings</Text>
              <Button
                label="See all"
                variant="ghost"
                size="sm"
                onPress={() =>
                  navigation.navigate("Account", { screen: "BookingsList" })
                }
              />
            </View>
            <View style={styles.bookingsList}>
              {data.upcomingBookings.slice(0, 3).map((b) => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  onPress={() =>
                    navigation.navigate("Account", {
                      // initial:false keeps AccountHome in the stack so the
                      // native-stack header renders a back chevron. Without
                      // it, BookingDetail becomes the root of Account.
                      screen: "BookingDetail",
                      params: { bookingId: b.id },
                      initial: false,
                    })
                  }
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Sports */}
        <View style={styles.section}>
          <SectionHeading
            accent="CHOOSE YOUR SPORT"
            emoji="🏟️"
            sub="Select a sport to book your court instantly"
            accentColor={colors.primary}
          />
          <View style={styles.sportsList}>
            {SPORTS.map((s) => (
              <SportCard
                key={s.slug}
                name={s.name}
                tagline={s.tagline}
                image={s.image}
                tint={s.tint}
                border={s.border}
                comingSoon={s.comingSoon}
                onPress={s.comingSoon ? undefined : () => openSport(s.slug)}
              />
            ))}
          </View>
        </View>

        {/* Cafe */}
        <View style={styles.section}>
          <SectionHeading
            accent="MOMENTUM CAFE"
            emoji="☕"
            sub="Fuel your game with fresh snacks, beverages & meals"
            accentColor="#f59e0b"
          />
          <Pressable
            onPress={() => navigation.navigate("Cafe")}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <ImageBackground
              source={{ uri: `${ASSETS}/cafe.jpg` }}
              style={styles.cafeCard}
              imageStyle={styles.cafeImage}
            >
              <View style={styles.cafeOverlay}>
                <Text style={styles.cafeEmoji}>☕</Text>
                <Text variant="title" color="#fff">Order Now</Text>
                <Text variant="small" color="rgba(255,255,255,0.75)" align="center" style={styles.cafeDesc}>
                  Snacks, fresh beverages, hot meals & combos — served at the
                  arena.
                </Text>
                <View style={styles.cafeTags}>
                  <Badge label="🍿 Snacks" tone="warning" />
                  <Badge label="🥤 Beverages" tone="warning" />
                  <Badge label="🍛 Meals" tone="warning" />
                  <Badge label="🍰 Desserts" tone="warning" />
                </View>
                <View style={styles.cafeBtn}>
                  <Text variant="bodyStrong" color="#000">
                    Browse Menu  →
                  </Text>
                </View>
              </View>
            </ImageBackground>
          </Pressable>
        </View>

        {/* Facilities */}
        <View style={styles.section}>
          <Text variant="title" align="center" style={styles.plainHeading}>
            World-class facilities
          </Text>
          <Text
            variant="small"
            color={colors.mutedForeground}
            align="center"
            style={styles.plainSub}
          >
            Everything you need for the perfect game
          </Text>
          <View style={styles.facilitiesGrid}>
            {FACILITIES.map((f) => (
              <Card key={f.title} style={styles.facilityCard}>
                <View style={styles.facilityIconBox}>
                  <Text style={styles.facilityIcon}>{f.icon}</Text>
                </View>
                <Text variant="bodyStrong" style={styles.facilityTitle}>
                  {f.title}
                </Text>
                <Text variant="small" color={colors.mutedForeground}>
                  {f.desc}
                </Text>
              </Card>
            ))}
          </View>
        </View>

        {/* Location & contact */}
        <View style={styles.section}>
          <Text variant="title" align="center" style={styles.plainHeading}>
            Find us in Mathura
          </Text>
          <Text
            variant="small"
            color={colors.mutedForeground}
            align="center"
            style={styles.plainSub}
          >
            Visit us for the best sporting experience
          </Text>

          <Card style={styles.contactCard}>
            <ContactRow
              icon={<MapPin size={20} color={colors.primary} />}
              label="Address"
              body={`Khasra no. 293/5, Mouja Ganeshra,\nRadhapuram Road, Mathura, UP 281004`}
              onPress={() =>
                Linking.openURL(
                  "https://maps.google.com/?q=27.509167,77.638917"
                )
              }
            />
            <Divider />
            <ContactRow
              icon={<PhoneIcon size={20} color={colors.primary} />}
              label="Phone"
              body="+91 63961 77261"
              onPress={() => Linking.openURL("tel:+916396177261")}
            />
            <Divider />
            <ContactRow
              icon={<Clock size={20} color={colors.primary} />}
              label="Opening hours"
              body="Every day: 5:00 AM – 1:00 AM"
            />
            <Divider />
            <ContactRow
              icon={<Mail size={20} color={colors.primary} />}
              label="Email"
              body="momentumarena2026@gmail.com"
              onPress={() =>
                Linking.openURL("mailto:momentumarena2026@gmail.com")
              }
            />
          </Card>

          <Button
            label="Contact us on WhatsApp"
            onPress={() => Linking.openURL("https://wa.me/916396177261")}
            leadingIcon={<MessageCircle size={18} color="#fff" />}
            style={styles.waBtn}
            fullWidth
          />

          <View style={styles.socials}>
            <SocialPill
              color="#25D366"
              icon={<MessageCircle size={16} color="#fff" />}
              label="WhatsApp"
              onPress={() =>
                Linking.openURL(
                  "https://whatsapp.com/channel/0029VbCQo4S8fewv3rjVp03X"
                )
              }
            />
            <SocialPill
              color="#E1306C"
              icon={<Camera size={16} color="#fff" />}
              label="Instagram"
              onPress={() =>
                Linking.openURL("https://instagram.com/momentumarena_")
              }
            />
            <SocialPill
              color="#FF0000"
              icon={<Video size={16} color="#fff" />}
              label="YouTube"
              onPress={() =>
                Linking.openURL("https://www.youtube.com/@momentum_arena")
              }
            />
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text variant="tiny" color={colors.subtleForeground}>
            © 2026 Momentum Arena · Mathura, UP
          </Text>
          <Pressable
            onPress={() =>
              Linking.openURL(`${env.apiUrl}/policies`)
            }
          >
            <Text variant="tiny" color={colors.mutedForeground} style={styles.footerLink}>
              Terms, Privacy & Refund Policy
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * Animated hero background — mirrors web's hero section (`app/page.tsx`).
 * Two pulsing floating orbs (emerald top-left, amber bottom-right with a
 * 2s phase offset) plus soft radial halo gradients. RN has no backdrop
 * blur, so we use `react-native-svg` RadialGradient fills to produce the
 * soft fall-off that `blur-3xl` would give on web.
 */
function HeroBackground() {
  const emeraldOpacity = useRef(new Animated.Value(1)).current;
  const amberOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // Web's animate-pulse: opacity 1 → 0.5 → 1 over 2s, ease-in-out.
    const makeLoop = (value: Animated.Value, startDelay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 0.5,
            duration: 1000,
            delay: startDelay,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    const emeraldLoop = makeLoop(emeraldOpacity, 0);
    // Second orb starts 2s later — matches `animation-delay: 2s` on web.
    const amberLoop = makeLoop(amberOpacity, 2000);
    emeraldLoop.start();
    amberLoop.start();
    return () => {
      emeraldLoop.stop();
      amberLoop.stop();
    };
  }, [emeraldOpacity, amberOpacity]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Background radial halos — fills the entire hero region with a
       *  soft emerald-from-top + amber-from-bottom-right wash. */}
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
        <Defs>
          <SvgRadialGradient
            id="emeraldHalo"
            cx="25%"
            cy="5%"
            rx="80%"
            ry="70%"
            fx="25%"
            fy="5%"
          >
            <Stop offset="0" stopColor="#064e3b" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#064e3b" stopOpacity="0" />
          </SvgRadialGradient>
          <SvgRadialGradient
            id="amberHalo"
            cx="80%"
            cy="85%"
            rx="70%"
            ry="60%"
            fx="80%"
            fy="85%"
          >
            <Stop offset="0" stopColor="#78350f" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#78350f" stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#emeraldHalo)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#amberHalo)" />
      </Svg>

      {/* Pulsing emerald orb — top-left */}
      <Animated.View
        pointerEvents="none"
        style={[styles.orbEmeraldPos, { opacity: emeraldOpacity }]}
      >
        <Svg width={300} height={300}>
          <Defs>
            <SvgRadialGradient id="orbEmerald" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#10b981" stopOpacity="0.35" />
              <Stop offset="0.5" stopColor="#10b981" stopOpacity="0.12" />
              <Stop offset="1" stopColor="#10b981" stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#orbEmerald)" />
        </Svg>
      </Animated.View>

      {/* Pulsing amber orb — bottom-right */}
      <Animated.View
        pointerEvents="none"
        style={[styles.orbAmberPos, { opacity: amberOpacity }]}
      >
        <Svg width={260} height={260}>
          <Defs>
            <SvgRadialGradient id="orbAmber" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#f59e0b" stopOpacity="0.28" />
              <Stop offset="0.5" stopColor="#f59e0b" stopOpacity="0.09" />
              <Stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
            </SvgRadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#orbAmber)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/**
 * Emerald glow that sits directly behind the hero logo. Mirrors web's
 * `absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full scale-75`.
 */
function HeroLogoGlow() {
  return (
    <Svg width={320} height={320} style={styles.heroLogoGlow}>
      <Defs>
        <SvgRadialGradient id="logoGlow" cx="50%" cy="50%" r="40%">
          <Stop offset="0" stopColor="#10b981" stopOpacity="0.45" />
          <Stop offset="0.6" stopColor="#10b981" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>
      <Circle cx="50%" cy="50%" r="50%" fill="url(#logoGlow)" />
    </Svg>
  );
}

function SectionHeading({
  accent,
  emoji,
  sub,
  accentColor,
}: {
  accent: string;
  emoji: string;
  sub: string;
  accentColor: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="title" align="center">
        <Text variant="title" color={accentColor}>
          {accent}
        </Text>{" "}
        {emoji}
      </Text>
      <Text
        variant="small"
        color={colors.mutedForeground}
        align="center"
        style={styles.plainSub}
      >
        {sub}
      </Text>
    </View>
  );
}

function SportCard({
  name,
  tagline,
  image,
  tint,
  border,
  comingSoon,
  onPress,
}: {
  name: string;
  tagline: string;
  image: string;
  tint: string;
  border: string;
  comingSoon?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.sportCard,
        { borderColor: border },
        pressed && !comingSoon && styles.pressed,
      ]}
    >
      <ImageBackground
        source={{ uri: image }}
        style={styles.sportImage}
        imageStyle={[styles.sportImageInner, comingSoon && { opacity: 0.5 }]}
      >
        <View style={[styles.sportOverlay, { backgroundColor: tint }]} />
        <View style={styles.sportContent}>
          {comingSoon ? (
            <Badge label="Coming soon" tone="warning" style={styles.sportBadge} />
          ) : null}
          <Text variant="title" color="#fff">
            {name}
          </Text>
          <Text variant="small" color="rgba(255,255,255,0.8)" align="center" style={styles.sportTagline}>
            {tagline}
          </Text>
          {!comingSoon ? (
            <View style={styles.sportCta}>
              <Text variant="small" color="#fff" weight="700">
                Book now →
              </Text>
            </View>
          ) : null}
        </View>
      </ImageBackground>
    </Pressable>
  );
}

function ContactRow({
  icon,
  label,
  body,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  body: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.contactRow}>
      <View style={styles.contactIcon}>{icon}</View>
      <View style={styles.contactText}>
        <Text variant="tiny" color={colors.mutedForeground}>
          {label.toUpperCase()}
        </Text>
        <Text variant="body" color={onPress ? colors.foreground : colors.foreground}>
          {body}
        </Text>
      </View>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function SocialPill({
  color,
  icon,
  label,
  onPress,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.social,
        { backgroundColor: color },
        pressed && styles.pressed,
      ]}
    >
      {icon}
      <Text variant="small" color="#fff" weight="700" style={styles.socialLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing["12"],
  },
  pressed: {
    opacity: 0.75,
  },
  topNav: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["2"],
    paddingBottom: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.8)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  logo: {
    width: 120,
    height: 36,
  },
  promo: {
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  promoText: {
    color: "#052e16",
    textAlign: "center",
  },
  hero: {
    paddingHorizontal: spacing["6"],
    paddingVertical: spacing["12"],
    alignItems: "center",
    gap: spacing["2"],
    position: "relative",
    overflow: "hidden",
  },
  // Floating orb positions — roughly top-1/4 left-1/4 and bottom-1/3
  // right-1/4 like the web hero. The SVG inside each one owns its own
  // radial fall-off so edges are genuinely soft.
  orbEmeraldPos: {
    position: "absolute",
    top: "6%",
    left: "-10%",
  },
  orbAmberPos: {
    position: "absolute",
    bottom: "8%",
    right: "-8%",
  },
  // Logo stack: the SVG glow (`HeroLogoGlow`) is absolutely centered
  // behind the logo image. The wrapper is sized to the logo; the glow
  // overflows it on all sides and is clipped only by the hero container.
  heroLogoWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["3"],
    width: 220,
    height: 110,
  },
  heroLogoGlow: {
    position: "absolute",
    // 320x320 glow centered over a 220x110 logo wrapper.
    top: (110 - 320) / 2,
    left: (220 - 320) / 2,
  },
  heroLogo: {
    width: 220,
    height: 110,
  },
  heroKicker: {
    letterSpacing: 2,
    fontWeight: "700",
  },
  heroTitle: {
    fontSize: 40,
    lineHeight: 44,
    color: colors.primary,
    fontWeight: "800",
  },
  heroSub: {
    marginTop: spacing["1"],
    fontSize: 17,
  },
  heroCtas: {
    marginTop: spacing["6"],
    gap: spacing["3"],
    width: "100%",
    alignItems: "center",
  },
  heroBtnPrimary: {
    height: 54,
  },
  heroBtnAmber: {
    alignSelf: "stretch",
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: "#d97706",
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    paddingHorizontal: spacing["6"],
    paddingVertical: spacing["8"],
    gap: spacing["5"],
  },
  sectionHeader: {
    alignItems: "center",
    gap: spacing["1.5"],
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  plainHeading: {
    fontWeight: "800",
  },
  plainSub: {
    marginTop: spacing["1"],
  },
  bookingsList: {
    gap: spacing["3"],
  },
  sportsList: {
    gap: spacing["3"],
  },
  sportCard: {
    height: 220,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
  },
  sportImage: {
    flex: 1,
    justifyContent: "center",
  },
  sportImageInner: {
    borderRadius: radius.xl,
  },
  sportOverlay: {
    ...StyleSheet.absoluteFill,
  },
  sportContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["6"],
    gap: spacing["1.5"],
  },
  sportBadge: {
    position: "absolute",
    top: spacing["3"],
    right: spacing["3"],
  },
  sportTagline: {
    maxWidth: 260,
  },
  sportCta: {
    marginTop: spacing["3"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["1.5"],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.3)",
  },
  cafeCard: {
    height: 280,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  cafeImage: {
    borderRadius: radius.xl,
  },
  cafeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["6"],
    gap: spacing["2"],
  },
  cafeEmoji: {
    fontSize: 40,
    lineHeight: 48,
    textAlign: "center",
    includeFontPadding: false,
  },
  cafeDesc: {
    marginTop: spacing["1"],
    maxWidth: 300,
  },
  cafeTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["1.5"],
    justifyContent: "center",
    marginTop: spacing["2"],
  },
  cafeBtn: {
    marginTop: spacing["4"],
    paddingHorizontal: spacing["6"],
    paddingVertical: spacing["2.5"],
    borderRadius: radius.full,
    backgroundColor: "#f59e0b",
  },
  facilitiesGrid: {
    gap: spacing["3"],
  },
  facilityCard: {
    gap: spacing["1.5"],
  },
  facilityIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["1"],
  },
  facilityIcon: {
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
    includeFontPadding: false,
  },
  facilityTitle: {
    fontSize: 16,
  },
  contactCard: {
    gap: spacing["3"],
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["3"],
    paddingVertical: spacing["2"],
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  contactText: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  waBtn: {
    marginTop: spacing["4"],
    backgroundColor: "#25D366",
  },
  socials: {
    marginTop: spacing["4"],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
  },
  social: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2"],
    borderRadius: radius.full,
  },
  socialLabel: {},
  footer: {
    marginTop: spacing["6"],
    paddingHorizontal: spacing["6"],
    paddingVertical: spacing["6"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: "center",
    gap: spacing["2"],
  },
  footerLink: {
    textDecorationLine: "underline",
  },
});
