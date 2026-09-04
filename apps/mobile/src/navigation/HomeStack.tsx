import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/home/HomeScreen";
import { NotificationsScreen } from "../screens/account/NotificationsScreen";
import { TournamentsListScreen } from "../screens/tournaments/TournamentsListScreen";
import { TournamentDetailScreen } from "../screens/tournaments/TournamentDetailScreen";
import { TournamentRegisterScreen } from "../screens/tournaments/TournamentRegisterScreen";
import { TournamentLiveScreen } from "../screens/tournaments/TournamentLiveScreen";
import { MatchCentreScreen } from "../screens/tournaments/MatchCentreScreen";
import { CampsScreen } from "../screens/camps/CampsScreen";
import { stackHeaderOptions } from "./headerOptions";
import type { HomeStackParamList } from "./types";

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * The Home tab, as a stack.
 *
 * Home used to be a bare screen, so its Tournaments and Camps tiles had
 * nowhere to push and instead did navigate("Account", { screen: ... }).
 * That switched the ACTIVE TAB to Account, so backing out of a tournament
 * landed the user on the Account screen they'd never asked for. (The same
 * shape had already caused a second bug: tournaments left sitting on top
 * of the Account stack made the Account tab itself unreachable, which
 * MomentumTabBar works around by force-resetting to AccountHome.)
 *
 * Registering those destinations here means a journey that starts on Home
 * stays in the Home tab and backs out to Home. The screens stay registered
 * in AccountStack too, so entry points that genuinely live under Account
 * keep working — same approach the passes screens already use, and the
 * reason the route NAMES must match in both stacks: a screen pushing
 * `TournamentDetail` resolves it in whichever stack it happens to be
 * mounted in, without knowing which one that is.
 */
export function HomeStack() {
  return (
    <Stack.Navigator screenOptions={stackHeaderOptions}>
      <Stack.Screen
        name="HomeMain"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: "My Notifications" }}
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
      <Stack.Screen
        name="Camps"
        component={CampsScreen}
        options={{ title: "Camps" }}
      />
    </Stack.Navigator>
  );
}
