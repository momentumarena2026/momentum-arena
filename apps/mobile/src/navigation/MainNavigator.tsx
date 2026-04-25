import { StyleSheet } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { CalendarPlus, Coffee, Home, User } from "lucide-react-native";
import { HomeScreen } from "../screens/home/HomeScreen";
import { CafeMenuScreen } from "../screens/cafe/CafeMenuScreen";
import { AccountStack } from "./AccountStack";
import { BookStack } from "./BookStack";
import { colors } from "../theme";
import type { MainTabsParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabsParamList>();

export function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 72,
          paddingTop: 6,
          paddingBottom: 12,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtleForeground,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ color, size }) => {
          const props = { color, size: size ?? 20, strokeWidth: 2 } as const;
          switch (route.name) {
            case "Home":
              return <Home {...props} />;
            case "Book":
              return <CalendarPlus {...props} />;
            case "Cafe":
              return <Coffee {...props} />;
            case "Account":
              return <User {...props} />;
            default:
              return null;
          }
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Book"
        component={BookStack}
        options={{ tabBarLabel: "Book" }}
      />
      <Tab.Screen name="Cafe" component={CafeMenuScreen} />
      <Tab.Screen name="Account" component={AccountStack} />
    </Tab.Navigator>
  );
}
