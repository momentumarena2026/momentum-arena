import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AccountScreen } from "../screens/account/AccountScreen";
import { EditNameScreen } from "../screens/account/EditNameScreen";
import { WaitlistScreen } from "../screens/account/WaitlistScreen";
import { BookingsListScreen } from "../screens/bookings/BookingsListScreen";
import { RecurringBookingsScreen } from "../screens/bookings/RecurringBookingsScreen";
import { BookingDetailScreen } from "../screens/bookings/BookingDetailScreen";
import { colors } from "../theme";
import type { AccountStackParamList } from "./types";

const Stack = createNativeStackNavigator<AccountStackParamList>();

export function AccountStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.foreground },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="AccountHome"
        component={AccountScreen}
        // The header itself is hidden on the Account home screen, but the
        // title is still used as the back-button label on descendant
        // screens (BookingsList, RecurringBookings, BookingDetail). Without
        // an explicit title the route name "AccountHome" leaks through.
        options={{ headerShown: false, title: "Account" }}
      />
      <Stack.Screen
        name="EditName"
        component={EditNameScreen}
        options={{ title: "Edit name" }}
      />
      <Stack.Screen
        name="BookingsList"
        component={BookingsListScreen}
        options={{ title: "My bookings" }}
      />
      <Stack.Screen
        name="RecurringBookings"
        component={RecurringBookingsScreen}
        options={{ title: "Recurring bookings" }}
      />
      <Stack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
        options={{ title: "Booking" }}
      />
      <Stack.Screen
        name="Waitlist"
        component={WaitlistScreen}
        options={{ title: "My waitlist" }}
      />
    </Stack.Navigator>
  );
}
