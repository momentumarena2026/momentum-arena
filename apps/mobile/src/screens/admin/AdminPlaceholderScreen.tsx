import { useRoute } from "@react-navigation/native";
import { StyleSheet, View } from "react-native";
import { Hammer } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";

const COPY: Record<string, { title: string; subtitle: string }> = {
  AdminCafe: {
    title: "Cafe",
    subtitle: "Menu management + live orders kanban land in the next phase.",
  },
  AdminExpenses: {
    title: "Expenses",
    subtitle: "Spend tracker and analytics land in the next phase.",
  },
};

/**
 * Stand-in for admin tabs that aren't built yet (Cafe, Expenses). The
 * real screens land in subsequent phases — this exists so the bottom-
 * tab bar feels real while the user previews the shell.
 */
export function AdminPlaceholderScreen() {
  const route = useRoute();
  const copy = COPY[route.name] ?? {
    title: "Coming soon",
    subtitle: "This admin section will land in the next phase.",
  };
  return (
    <Screen>
      <View style={styles.wrap}>
        <View style={styles.icon}>
          <Hammer size={28} color={colors.yellow400} />
        </View>
        <Text variant="title" style={styles.title}>
          {copy.title}
        </Text>
        <Text
          variant="small"
          color={colors.mutedForeground}
          align="center"
          style={styles.subtitle}
        >
          {copy.subtitle}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["6"],
    gap: spacing["3"],
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.30)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
    marginBottom: spacing["1"],
  },
  title: { textAlign: "center" },
  subtitle: { maxWidth: 280 },
});
