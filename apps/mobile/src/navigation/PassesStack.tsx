import { Pressable, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ticket } from "lucide-react-native";
import { MyPassesScreen } from "../screens/account/MyPassesScreen";
import { PassDetailScreen } from "../screens/account/PassDetailScreen";
import { PassesStoreScreen } from "../screens/account/PassesStoreScreen";
import { Text } from "../components/ui/Text";
import { colors } from "../theme";
import type { PassesStackParamList } from "./types";
import { stackHeaderOptions } from "./headerOptions";

const Stack = createNativeStackNavigator<PassesStackParamList>();

/**
 * Passes bottom tab — storefront-first: lands on Explore Passes (buy),
 * with "My passes" one tap away in the header and the pass detail
 * pushed on top. The same screens stay registered in AccountStack for
 * the Account → My Passes tile; route names match so the shared
 * components navigate correctly in either stack.
 */
export function PassesStack() {
  return (
    <Stack.Navigator screenOptions={stackHeaderOptions}>
      <Stack.Screen
        name="PassesStore"
        component={PassesStoreScreen}
        options={({ navigation }) => ({
          title: "Passes",
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate("MyPasses")}
              hitSlop={8}
              style={({ pressed }) => [
                styles.myPassesBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ticket size={15} color={colors.emerald400} />
              <Text style={styles.myPassesText}>My passes</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="MyPasses"
        component={MyPassesScreen}
        options={{ title: "My passes" }}
      />
      <Stack.Screen
        name="PassDetail"
        component={PassDetailScreen}
        options={{ title: "Pass" }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  myPassesBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
    backgroundColor: "rgba(16,185,129,0.10)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  myPassesText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6ee7b7",
  },
});
