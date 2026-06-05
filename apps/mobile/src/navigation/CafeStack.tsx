import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CafeMenuScreen } from "../screens/cafe/CafeMenuScreen";
import { CafeCartScreen } from "../screens/cafe/CafeCartScreen";
import { CafeCheckoutScreen } from "../screens/cafe/CafeCheckoutScreen";
import { CafeOrderDetailScreen } from "../screens/cafe/CafeOrderDetailScreen";
import { colors } from "../theme";
import type { CafeStackParamList } from "./types";

const Stack = createNativeStackNavigator<CafeStackParamList>();

/**
 * Cafe tab = "browse menu + cart + checkout". Mirrors ShopStack's
 * shape. Orders LIST lives on AccountStack so the Cafe tab always
 * lands on CafeMenu when tapped from the bottom nav.
 */
export function CafeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.foreground },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="CafeMenu"
        component={CafeMenuScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CafeCart"
        component={CafeCartScreen}
        options={{ title: "Your Cart" }}
      />
      <Stack.Screen
        name="CafeCheckout"
        component={CafeCheckoutScreen}
        options={{ title: "Checkout" }}
      />
      <Stack.Screen
        name="CafeOrderDetail"
        component={CafeOrderDetailScreen}
        options={{ title: "Order" }}
      />
    </Stack.Navigator>
  );
}
