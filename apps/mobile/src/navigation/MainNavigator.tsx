import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { HomeStack } from "./HomeStack";
import { AccountStack } from "./AccountStack";
import { BookStack } from "./BookStack";
import { CafeStack } from "./CafeStack";
import { PassesStack } from "./PassesStack";
import { ShopStack } from "./ShopStack";
import { MomentumTabBar } from "./MomentumTabBar";
import { trackBottomNavClick } from "../lib/analytics";
import type { MainTabsParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <MomentumTabBar {...props} />}
      screenListeners={({ route }) => ({
        tabPress: () => trackBottomNavClick(route.name),
      })}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Sports" component={BookStack} />
      <Tab.Screen name="Passes" component={PassesStack} />
      <Tab.Screen name="Account" component={AccountStack} />
      {/* Reachable from the centre button's arc and from deep links —
          registered here so navigation.navigate("Cafe") still resolves,
          just not rendered as a bar icon. MomentumTabBar draws only the
          four it knows about. */}
      <Tab.Screen name="Cafe" component={CafeStack} />
      <Tab.Screen name="Shop" component={ShopStack} />
    </Tab.Navigator>
  );
}
