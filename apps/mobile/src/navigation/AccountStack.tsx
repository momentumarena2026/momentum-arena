import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AccountScreen } from "../screens/account/AccountScreen";
import { EditNameScreen } from "../screens/account/EditNameScreen";
import { MyPassesScreen } from "../screens/account/MyPassesScreen";
import { NotificationsScreen } from "../screens/account/NotificationsScreen";
import { PassDetailScreen } from "../screens/account/PassDetailScreen";
import { PassesStoreScreen } from "../screens/account/PassesStoreScreen";
import { WaitlistScreen } from "../screens/account/WaitlistScreen";
import { CouponsScreen } from "../screens/account/CouponsScreen";
import { RewardsScreen } from "../screens/account/RewardsScreen";
import { BookingsListScreen } from "../screens/bookings/BookingsListScreen";
import { RecurringBookingsScreen } from "../screens/bookings/RecurringBookingsScreen";
import { BookingDetailScreen } from "../screens/bookings/BookingDetailScreen";
import { ShopOrdersListScreen } from "../screens/shop/ShopOrdersListScreen";
import { ShopOrderDetailScreen } from "../screens/shop/ShopOrderDetailScreen";
import { CafeOrdersListScreen } from "../screens/cafe/CafeOrdersListScreen";
import { CafeOrderDetailScreen } from "../screens/cafe/CafeOrderDetailScreen";
import { RewardsHowItWorksScreen } from "../screens/account/RewardsHowItWorksScreen";
import { TournamentsListScreen } from "../screens/tournaments/TournamentsListScreen";
import { CampsScreen } from "../screens/camps/CampsScreen";
import { TournamentDetailScreen } from "../screens/tournaments/TournamentDetailScreen";
import { TournamentRegisterScreen } from "../screens/tournaments/TournamentRegisterScreen";
import { TournamentLiveScreen } from "../screens/tournaments/TournamentLiveScreen";
import { MatchCentreScreen } from "../screens/tournaments/MatchCentreScreen";
import type { AccountStackParamList } from "./types";
import { stackHeaderOptions } from "./headerOptions";

const Stack = createNativeStackNavigator<AccountStackParamList>();

export function AccountStack() {
  return (
    <Stack.Navigator
      screenOptions={stackHeaderOptions}
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
        name="MyPasses"
        component={MyPassesScreen}
        options={{ title: "My passes" }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: "My Notifications" }}
      />
      <Stack.Screen
        name="PassDetail"
        component={PassDetailScreen}
        options={{ title: "Pass" }}
      />
      <Stack.Screen
        name="PassesStore"
        component={PassesStoreScreen}
        options={{ title: "Buy a pass" }}
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
      <Stack.Screen
        name="Coupons"
        component={CouponsScreen}
        options={{ title: "Coupons & Offers" }}
      />
      <Stack.Screen
        name="Rewards"
        component={RewardsScreen}
        options={{ title: "Momentum Points" }}
      />
      <Stack.Screen
        name="RewardsHowItWorks"
        component={RewardsHowItWorksScreen}
        options={{ title: "How it works" }}
      />
      {/* Shop-order screens belong to the Account flow even though
          their screen files live under screens/shop/ for proximity to
          the rest of the shop UI. Registering them here means back
          from ShopOrders pops to AccountHome naturally, and the Shop
          tab in the bottom nav always reflects "browse products"
          (ShopHome) state — never gets stuck on the orders list. */}
      <Stack.Screen
        name="ShopOrders"
        component={ShopOrdersListScreen}
        options={{ title: "My orders" }}
      />
      <Stack.Screen
        name="ShopOrderDetail"
        component={ShopOrderDetailScreen}
        options={{ title: "Order" }}
      />
      {/* Cafe orders mirror the shop pattern — entry from the
          AccountHome tile, registered here so back from the list
          pops to AccountHome and the Cafe tab in the bottom nav
          never gets stuck on the orders view. */}
      <Stack.Screen
        name="CafeOrders"
        component={CafeOrdersListScreen}
        options={{ title: "My cafe orders" }}
      />
      <Stack.Screen
        name="CafeOrderDetail"
        component={CafeOrderDetailScreen}
        options={{ title: "Cafe order" }}
      />
      <Stack.Screen
        name="Camps"
        component={CampsScreen}
        options={{ title: "Camps" }}
      />
      <Stack.Screen
        name="TournamentsList"
        component={TournamentsListScreen}
        options={{ title: "Tournaments" }}
      />
      <Stack.Screen
        name="TournamentDetail"
        component={TournamentDetailScreen}
        options={{ title: "Tournament" }}
      />
      <Stack.Screen
        name="TournamentRegister"
        component={TournamentRegisterScreen}
        options={{ title: "Register team" }}
      />
      <Stack.Screen
        name="TournamentLive"
        component={TournamentLiveScreen}
        options={{ title: "Live match" }}
      />
      <Stack.Screen
        name="TournamentMatch"
        component={MatchCentreScreen}
        options={{ title: "Match centre" }}
      />
    </Stack.Navigator>
  );
}
