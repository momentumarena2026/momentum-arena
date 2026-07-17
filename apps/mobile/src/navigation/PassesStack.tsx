import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MyPassesScreen } from "../screens/account/MyPassesScreen";
import { PassDetailScreen } from "../screens/account/PassDetailScreen";
import { PassesStoreScreen } from "../screens/account/PassesStoreScreen";
import { colors } from "../theme";
import type { PassesStackParamList } from "./types";

const Stack = createNativeStackNavigator<PassesStackParamList>();

/**
 * Passes bottom tab — wallet-first: lands on My Passes (Active /
 * Inactive tickets, "+ Buy" into the storefront), with detail +
 * storefront pushed on top. The same three screens stay registered in
 * AccountStack for the Account → My Passes tile; route names match so
 * the shared components navigate correctly in either stack.
 */
export function PassesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.foreground },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="MyPasses"
        component={MyPassesScreen}
        options={{ title: "Passes" }}
      />
      <Stack.Screen
        name="PassesStore"
        component={PassesStoreScreen}
        options={{ title: "Buy a pass" }}
      />
      <Stack.Screen
        name="PassDetail"
        component={PassDetailScreen}
        options={{ title: "Pass" }}
      />
    </Stack.Navigator>
  );
}
