import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";

interface Props {
  title: string;
  body: string;
  /** Routes to the relevant screen (same routing as a real push tap). */
  onPress: () => void;
  /** Called once the slide-out animation finishes. */
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;
const HIDDEN_Y = -240;

/**
 * Banner shown when a push arrives while the app is in the FOREGROUND.
 * iOS does not show a system banner in that state — FCM hands the
 * message to onMessage instead (see lib/push.ts) — so we surface it
 * here. Slides in from the top, auto-dismisses after a few seconds,
 * and routes on tap. The parent remounts this (via a changing `key`)
 * for each new push, so the mount-only animation + timer restart.
 */
export function InAppNotificationBanner({ title, body, onPress, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(HIDDEN_Y)).current;
  const dismissed = useRef(false);

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 14,
    }).start();
    const timer = setTimeout(hide, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Mount-only on purpose — see the component doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function hide() {
    if (dismissed.current) return;
    dismissed.current = true;
    Animated.timing(translateY, {
      toValue: HIDDEN_Y,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDismiss();
    });
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingTop: insets.top + 8, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        onPress={() => {
          onPress();
          hide();
        }}
      >
        <View style={styles.dot} />
        <View style={styles.textCol}>
          {!!title && (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          )}
          {!!body && (
            <Text style={styles.body} numberOfLines={2}>
              {body}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  textCol: { flex: 1 },
  title: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  body: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
  },
});
