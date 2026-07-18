import { useCallback, useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Coffee, Home, MapPin, Plus, ShoppingBag, Ticket, Trophy, User } from "lucide-react-native";
import { Text } from "../components/ui/Text";
import { colors } from "../theme";
import { trackBottomNavClick } from "../lib/analytics";

/** Where the venue is — same pin the Home screen's "Find us" card opens. */
const VENUE_MAPS_URL = "https://maps.google.com/?q=27.509167,77.638917";

const FAB_SIZE = 60;
/** Row height of the icons — the arc's flat edge lands on top of this. */
const BAR_HEIGHT = 62;
/**
 * Two radii, deliberately different. ITEM_RADIUS is where the three
 * icons sit; SHEET_* is the semicircle drawn behind them. The sheet has
 * to be tall enough to contain an icon PLUS its label at the top of the
 * arc — size them independently and the top item pokes out through the
 * curve.
 */
const ITEM_RADIUS = 74;
const ITEM_HEIGHT = 66;
const SHEET_W = 304;
const SHEET_H = 152;
const OPEN_MS = 340;
const CLOSE_MS = 220;

/**
 * The four arc items fan out from the FAB along a semicircle: left,
 * top, right. Angles are measured from the FAB centre, 0° pointing
 * right, growing anticlockwise — so 180° is due left and 90° is
 * straight up.
 */
const ARC_ITEMS = [
  { key: "Cafe", label: "Cafe", angle: 160, Icon: Coffee },
  { key: "Location", label: "Reach us", angle: 90, Icon: MapPin },
  { key: "Shop", label: "Shop", angle: 20, Icon: ShoppingBag },
] as const;

const TABS = [
  { name: "Home", label: "Home", Icon: Home },
  { name: "Sports", label: "Sports", Icon: Trophy },
  { name: "Passes", label: "Passes", Icon: Ticket },
  { name: "Account", label: "Account", Icon: User },
] as const;

/**
 * Bottom navigation: four destinations split two-and-two around a
 * raised action button. The button isn't a destination — it fans open a
 * semicircle of the things you *do* at the venue (order a coffee, find
 * the place, buy merch), which is what keeps the bar at four icons
 * instead of six.
 *
 * Animated (not reanimated) on purpose: reanimated is installed but
 * unused elsewhere in this app, and every transform here is a plain
 * scale/translate/opacity that the native driver already handles.
 */
export function MomentumTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // Kept mounted through the closing animation so the arc can animate
  // out instead of vanishing.
  const [arcMounted, setArcMounted] = useState(false);
  // useState-initialiser, not useRef().current — reading a ref during
  // render trips the compiler rule, and this is the pattern the rest of
  // the app already uses (see PassClock).
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? OPEN_MS : CLOSE_MS,
      // Slight overshoot on the way out, plain ease on the way back —
      // opening should feel like it springs, closing like it's dismissed.
      easing: open ? Easing.out(Easing.back(1.3)) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setArcMounted(false);
    });
  }, [open, progress]);

  /**
   * Standard custom-tab-bar dispatch: emit `tabPress` and respect a
   * prevented default. Navigating directly would skip the event, and
   * with it the behaviour people expect from re-tapping the tab you're
   * already on (pop the stack back to its first screen). It's also what
   * the navigator's screenListeners use to fire the analytics event —
   * so tracking stays in one place instead of being counted twice.
   */
  // Mounting happens here rather than in the effect: setting state
  // inside an effect just to mount the layer causes a cascading render.
  const openArc = useCallback(() => {
    setArcMounted(true);
    setOpen(true);
  }, []);
  const closeArc = useCallback(() => setOpen(false), []);

  const go = useCallback(
    (name: string) => {
      const target = state.routes.find((r) => r.name === name);
      const isFocused = state.routes[state.index]?.name === name;
      const event = navigation.emit({
        type: "tabPress",
        target: target?.key,
        canPreventDefault: true,
      });
      if (!event.defaultPrevented) {
        navigation.navigate(name as never);
      } else if (isFocused) {
        // Focused + prevented is the pop-to-top case the navigator
        // handles internally; nothing more to do here.
      }
    },
    [navigation, state],
  );

  const onArcPress = useCallback(
    (key: string) => {
      closeArc();
      if (key === "Location") {
        trackBottomNavClick("VenueLocation");
        Linking.openURL(VENUE_MAPS_URL).catch(() => {});
        return;
      }
      go(key);
    },
    [go, closeArc],
  );

  const activeName = state.routes[state.index]?.name;
  // Distance from the screen bottom to the bar's TOP border. The arc is
  // anchored here rather than to the safe-area inset, so its flat edge
  // rests exactly on the border instead of overlapping the icons.
  const barTop = BAR_HEIGHT + Math.max(insets.bottom, 10);

  return (
    <View
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
      pointerEvents="box-none"
    >
      {/* The arc lives in a Modal, not inside the bar. A tab bar clips
          children that overflow it on Android, which would eat both the
          raised button and the whole semicircle. The Modal renders at
          the native root — nothing to clip against — and gives us the
          hardware Back button for free. */}
      <Modal
        visible={arcMounted}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeArc}
      >
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeArc}
              accessibilityLabel="Close quick actions"
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.arcSheet,
              {
                bottom: barTop,
                opacity: progress,
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.3, 1],
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["-38deg", "0deg"],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="none"
          />

          {ARC_ITEMS.map((item, i) => {
            const rad = (item.angle * Math.PI) / 180;
            const dx = Math.cos(rad) * ITEM_RADIUS;
            const dy = -Math.sin(rad) * ITEM_RADIUS;
            return (
              <Animated.View
                key={item.key}
                style={[
                  styles.arcItem,
                  {
                    bottom: barTop + 6,
                    opacity: progress.interpolate({
                      inputRange: [0, 0.25 + i * 0.12, 1],
                      outputRange: [0, 0, 1],
                    }),
                    transform: [
                      {
                        translateX: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, dx],
                        }),
                      },
                      {
                        translateY: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, dy],
                        }),
                      },
                      {
                        scale: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.4, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Pressable
                  onPress={() => onArcPress(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [
                    styles.arcButton,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <item.Icon size={22} color={colors.primary} strokeWidth={2} />
                </Pressable>
                <Text variant="tiny" align="center" color={colors.zinc300}>
                  {item.label}
                </Text>
              </Animated.View>
            );
          })}

          {/* The button is redrawn here at the same coordinates so it
              stays above the scrim and keeps rotating into the ×. */}
          <Fab
            progress={progress}
            bottom={insets.bottom + 26}
            open
            onPress={closeArc}
          />
        </View>
      </Modal>

      <View style={styles.bar}>
        {TABS.slice(0, 2).map((t) => (
          <TabButton
            key={t.name}
            {...t}
            active={activeName === t.name}
            onPress={() => go(t.name)}
          />
        ))}

        <View style={styles.fabSlot} />

        {TABS.slice(2).map((t) => (
          <TabButton
            key={t.name}
            {...t}
            active={activeName === t.name}
            onPress={() => go(t.name)}
          />
        ))}
      </View>

      <Fab
        progress={progress}
        bottom={insets.bottom + 26}
        open={open}
        onPress={open ? closeArc : openArc}
      />
    </View>
  );
}

function Fab({
  progress,
  bottom,
  open,
  onPress,
}: {
  progress: Animated.Value;
  bottom: number;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <Animated.View
      style={[
        styles.fabWrap,
        {
          bottom,
          transform: [
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "135deg"],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={open ? "Close quick actions" : "Quick actions"}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
      >
        <Plus size={28} color={colors.primaryForeground} strokeWidth={2.5} />
      </Pressable>
    </Animated.View>
  );
}

function TabButton({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon: typeof Home;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={styles.tab}
    >
      <Icon
        size={22}
        color={active ? colors.primary : colors.subtleForeground}
        strokeWidth={2}
      />
      <Text
        variant="tiny"
        color={active ? colors.primary : colors.subtleForeground}
        weight={active ? "600" : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 62,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  fabSlot: { width: FAB_SIZE + 16 },
  fabWrap: {
    position: "absolute",
    alignSelf: "center",
    // Above the scrim so the button stays tappable while open.
    zIndex: 3,
    elevation: 12,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: colors.primary,
        shadowOpacity: 0.45,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 12 },
    }),
  },
  scrim: { backgroundColor: "rgba(0,0,0,0.55)" },
  arcSheet: {
    position: "absolute",
    alignSelf: "center",
    width: SHEET_W,
    height: SHEET_H,
    borderTopLeftRadius: SHEET_W / 2,
    borderTopRightRadius: SHEET_W / 2,
    backgroundColor: colors.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
    zIndex: 2,
  },
  arcItem: {
    position: "absolute",
    alignSelf: "center",
    alignItems: "center",
    // Floor, not a fixed height: SHEET_H is sized to contain an item of
    // this height at the top of the arc. A user with large accessibility
    // text will grow the label past it — better that it overflows the
    // curve slightly than gets clipped.
    minHeight: ITEM_HEIGHT,
    gap: 4,
    zIndex: 2,
  },
  arcButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.emerald500_30,
    alignItems: "center",
    justifyContent: "center",
  },
});
