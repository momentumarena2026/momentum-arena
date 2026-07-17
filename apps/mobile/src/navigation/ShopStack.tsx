import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ShopHomeScreen } from "../screens/shop/ShopHomeScreen";
import { ShopCartScreen } from "../screens/shop/ShopCartScreen";
import { ShopCheckoutScreen } from "../screens/shop/ShopCheckoutScreen";
import { ShopOrderDetailScreen } from "../screens/shop/ShopOrderDetailScreen";
import type { ShopStackParamList } from "./types";
import { stackHeaderOptions } from "./headerOptions";

const Stack = createNativeStackNavigator<ShopStackParamList>();

/**
 * Shop tab = "browse products + checkout". The orders LIST and the
 * orders DETAIL when reached from that list live under AccountStack
 * (see AccountStack.tsx) — the only entry to the orders list is the
 * Account screen tile, and keeping it out of this stack means tapping
 * the Shop tab in the bottom nav always lands on ShopHome (never gets
 * stuck on "My orders" after a cross-tab jump from Account).
 *
 * ShopOrderDetail is registered HERE too because ShopCheckoutScreen
 * pushes to it after a successful purchase — that's a Shop-tab flow.
 * Same screen component, two registrations across two stacks; works
 * fine because the screen only calls `navigation.goBack()` and
 * doesn't introspect its parent navigator.
 */
export function ShopStack() {
  return (
    <Stack.Navigator
      screenOptions={stackHeaderOptions}
    >
      <Stack.Screen
        name="ShopHome"
        component={ShopHomeScreen}
        options={{ title: "Shop" }}
      />
      <Stack.Screen
        name="ShopCart"
        component={ShopCartScreen}
        options={{ title: "Cart" }}
      />
      <Stack.Screen
        name="ShopCheckout"
        component={ShopCheckoutScreen}
        options={{ title: "Checkout" }}
      />
      <Stack.Screen
        name="ShopOrderDetail"
        component={ShopOrderDetailScreen}
        options={{ title: "Order" }}
      />
    </Stack.Navigator>
  );
}
