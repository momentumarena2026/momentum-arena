import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BookSportScreen } from "../screens/book/BookSportScreen";
import { BookCourtScreen } from "../screens/book/BookCourtScreen";
import { BookSlotsScreen } from "../screens/book/BookSlotsScreen";
import { CheckoutScreen } from "../screens/book/CheckoutScreen";
import { BookingConfirmedScreen } from "../screens/book/BookingConfirmedScreen";
import { colors } from "../theme";
import { sportLabel } from "../lib/format";
import type { BookStackParamList } from "./types";

const Stack = createNativeStackNavigator<BookStackParamList>();

export function BookStack() {
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
        name="BookSport"
        component={BookSportScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BookCourt"
        component={BookCourtScreen}
        options={({ route }) => ({ title: sportLabel(route.params.sport) })}
      />
      <Stack.Screen
        name="BookSlots"
        component={BookSlotsScreen}
        options={({ route }) => ({ title: route.params.courtLabel })}
      />
      <Stack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{ title: "Checkout" }}
      />
      <Stack.Screen
        name="BookingConfirmed"
        component={BookingConfirmedScreen}
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}
