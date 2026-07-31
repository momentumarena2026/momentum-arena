import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CafeMenuScreen } from "../screens/cafe/CafeMenuScreen";
import { CafeCartScreen } from "../screens/cafe/CafeCartScreen";
import { CafeCheckoutScreen } from "../screens/cafe/CafeCheckoutScreen";
import { CafeOrderDetailScreen } from "../screens/cafe/CafeOrderDetailScreen";
import type { CafeStackParamList } from "./types";
import { stackHeaderOptions } from "./headerOptions";

const Stack = createNativeStackNavigator<CafeStackParamList>();

/**
 * Cafe tab = "browse menu + cart + checkout". Mirrors ShopStack's
 * shape. Orders LIST lives on AccountStack so the Cafe tab always
 * lands on CafeMenu when tapped from the bottom nav.
 */
export function CafeStack() {
  return (
    <Stack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <Stack.Screen
        name="CafeMenu"
        component={CafeMenuScreen}
        options={{ title: "Cafe" }}
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
