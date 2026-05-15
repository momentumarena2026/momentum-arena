import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ShopHomeScreen } from "../screens/shop/ShopHomeScreen";
import { ShopCartScreen } from "../screens/shop/ShopCartScreen";
import { ShopCheckoutScreen } from "../screens/shop/ShopCheckoutScreen";
import { ShopOrderDetailScreen } from "../screens/shop/ShopOrderDetailScreen";
import { colors } from "../theme";
import type { ShopStackParamList } from "./types";

const Stack = createNativeStackNavigator<ShopStackParamList>();

export function ShopStack() {
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
