import { Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ChevronLeft } from "lucide-react-native";
import { ShopHomeScreen } from "../screens/shop/ShopHomeScreen";
import { ShopCartScreen } from "../screens/shop/ShopCartScreen";
import { ShopCheckoutScreen } from "../screens/shop/ShopCheckoutScreen";
import { ShopOrdersListScreen } from "../screens/shop/ShopOrdersListScreen";
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
        name="ShopOrders"
        component={ShopOrdersListScreen}
        options={({ navigation }) => ({
          title: "My orders",
          // Customers most often reach this screen via a cross-tab
          // jump from the Account tile, which resets the stack so
          // RN doesn't auto-show its back chevron. Inject an
          // explicit one — pop within the stack if possible (e.g.
          // came from ShopHome), otherwise rewind to ShopHome.
          headerLeft: () => (
            <Pressable
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.navigate("ShopHome");
                }
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
