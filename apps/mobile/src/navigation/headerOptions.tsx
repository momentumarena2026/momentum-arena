import { Pressable, StyleSheet } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { colors } from "../theme";

/**
 * Shared compact stack-header styling for every native-stack navigator
 * (customer tabs + admin).
 *
 * Why a custom headerLeft: iOS 26 renders the DEFAULT native back
 * control as a large "liquid glass" pill that reads oversized and
 * washed-out against our black headers (and inflates the perceived
 * header height). Supplying headerLeft replaces it with a borderless
 * chevron, consistent on both platforms; headerBackVisible: false
 * keeps the native control from ever rendering next to it.
 *
 * Screens may still override any of this per-screen (e.g. a custom
 * headerRight) — per-screen options win over screenOptions.
 */
export function stackHeaderOptions({
  navigation,
}: {
  navigation: { canGoBack: () => boolean; goBack: () => void };
}): NativeStackNavigationOptions {
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTitleStyle: {
      color: colors.foreground,
      fontSize: 17,
      fontWeight: "600",
    },
    headerTintColor: colors.primary,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.background },
    headerBackVisible: false,
    headerLeft: () =>
      navigation.canGoBack() ? (
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ChevronLeft size={26} color={colors.foreground} strokeWidth={2.5} />
        </Pressable>
      ) : null,
  };
}

const styles = StyleSheet.create({
  backBtn: {
    // Chevron only — no pill, no label. Nudged left so the glyph
    // optically aligns with the screen's content edge.
    marginLeft: -6,
    padding: 4,
  },
});
