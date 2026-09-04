import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BookSportScreen } from "../screens/book/BookSportScreen";
import { BookingBotScreen } from "../screens/book/BookingBotScreen";
import { BookCourtScreen } from "../screens/book/BookCourtScreen";
import { BookSlotsScreen } from "../screens/book/BookSlotsScreen";
import { BookBowlingSlotsScreen } from "../screens/book/BookBowlingSlotsScreen";
import { CheckoutScreen } from "../screens/book/CheckoutScreen";
import { BookingConfirmedScreen } from "../screens/book/BookingConfirmedScreen";
import { sportLabel } from "../lib/format";
import type { BookStackParamList } from "./types";
import { stackHeaderOptions } from "./headerOptions";

const Stack = createNativeStackNavigator<BookStackParamList>();

export function BookStack() {
  return (
    <Stack.Navigator
      screenOptions={stackHeaderOptions}
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
        name="BookBowlingSlots"
        component={BookBowlingSlotsScreen}
        options={({ route }) => ({ title: route.params.courtLabel })}
      />
      <Stack.Screen
        name="BookingBot"
        component={BookingBotScreen}
        options={{ title: "Quick book" }}
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
