import { Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { ChevronLeft } from "lucide-react-native";
import { ShopHomeScreen } from "../screens/shop/ShopHomeScreen";
import { ShopCartScreen } from "../screens/shop/ShopCartScreen";
import { ShopCheckoutScreen } from "../screens/shop/ShopCheckoutScreen";
import { ShopOrdersListScreen } from "../screens/shop/ShopOrdersListScreen";
import { ShopOrderDetailScreen } from "../screens/shop/ShopOrderDetailScreen";
import { colors } from "../theme";
import type { MainTabsParamList, ShopStackParamList } from "./types";

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
        name="ShopOrders"
        component={ShopOrdersListScreen}
        options={({ navigation, route }) => ({
          title: "My orders",
          // Customers most often reach this screen via a cross-tab
          // jump from the Account tile, which resets the Shop stack
          // so RN doesn't auto-show its back chevron. Inject an
          // explicit one — and pick the right destination:
          //   1. `canGoBack()` (came from elsewhere in the Shop stack
          //      e.g. ShopOrderDetail → pop normally)
          //   2. `route.params?.from === "Account"` → jump back to
          //      the Account tab so the user lands where they
          //      started (the bottom-tab navigator's default
          //      backBehavior is "firstRoute" → dumps them on Home,
          //      which is the bug this branch fixes)
          //   3. Fall back to ShopHome for any future cross-tab
          //      entry that doesn't carry a `from` hint.
          headerLeft: () => (
            <Pressable
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                  return;
                }
                if (route.params?.from === "Account") {
                  // jumpTo is the canonical tab-navigator method for
                  // switching tabs without pushing onto a stack; matches
                  // the user's mental model of "pop back to Account".
                  navigation
                    .getParent<BottomTabNavigationProp<MainTabsParamList>>()
                    ?.jumpTo("Account", { screen: "AccountHome" });
                  return;
                }
                navigation.navigate("ShopHome", undefined);
              }}
              hitSlop={12}
              style={{ paddingLeft: 8, paddingRight: 4 }}
            >
              <ChevronLeft size={24} color={colors.primary} />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="ShopOrderDetail"
        component={ShopOrderDetailScreen}
        options={{ title: "Order" }}
      />
    </Stack.Navigator>
  );
}
