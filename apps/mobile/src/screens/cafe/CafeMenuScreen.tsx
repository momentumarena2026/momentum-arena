import { StyleSheet, View } from "react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, spacing } from "../../theme";

/**
 * Mirror of web's `/cafe` page — a single amber "Coming Soon" card.
 * The web version is a placeholder while cafe ordering is under
 * construction; the native tab shows exactly the same surface so the
 * two stay in lockstep (same copy, same amber tint, same layout).
 *
 * Reference: app/cafe/page.tsx
 *   <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5
 *                  p-12 text-center">
 *     <h2 className="text-2xl font-bold text-white">Momentum Cafe</h2>
 *     <p className="mt-2 text-amber-400 font-semibold">Coming Soon</p>
 *     <p className="mt-3 text-sm text-zinc-400"> … </p>
 *   </div>
 */
export function CafeMenuScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text variant="title" weight="700" color={colors.foreground} align="center">
            Momentum Cafe
          </Text>
          <Text
            variant="body"
            weight="600"
            color={AMBER_400}
            align="center"
            style={styles.coming}
          >
            Coming Soon
          </Text>
          <Text
            variant="small"
            color={colors.zinc400}
            align="center"
            style={styles.description}
          >
            The cafe is currently under construction. We'll be serving up
            something delicious very soon.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

// Tailwind amber-400 — used on web for the "Coming Soon" accent text.
const AMBER_400 = "#fbbf24";

const styles = StyleSheet.create({
  // Web: mx-auto max-w-2xl space-y-6 p-4 — centered column, max width
  // enforced on large screens. On mobile we just center vertically so
  // the card sits visually weighted like the web page.
  container: {
    flex: 1,
    justifyContent: "center",
    maxWidth: 672, // Tailwind max-w-2xl = 42rem = 672px
    width: "100%",
    alignSelf: "center",
  },
  // Web: rounded-2xl border border-amber-500/30 bg-amber-500/5 p-12 text-center
  //   rounded-2xl → 16px (matches web literally; mobile's radius tokens
  //                       only go up to 20, so we hard-code 16 for parity)
  //   amber-500/30 → rgba(245, 158, 11, 0.30) border
  //   amber-500/5  → rgba(245, 158, 11, 0.05) bg
  //   p-12 → 48px padding
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.05)",
    padding: 48,
    alignItems: "center",
  },
  // Web uses `mt-2` (8px) between "Momentum Cafe" and "Coming Soon".
  coming: {
    marginTop: spacing["2"],
  },
  // Web uses `mt-3` (12px) between "Coming Soon" and the description.
  description: {
    marginTop: spacing["3"],
  },
});
