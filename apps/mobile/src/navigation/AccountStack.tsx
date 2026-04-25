import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AccountScreen } from "../screens/account/AccountScreen";
import { EditNameScreen } from "../screens/account/EditNameScreen";
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
        options={{ headerShown: false }}
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
    </Stack.Navigator>
  );
}
