import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  CommonActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Calendar, Clock, MapPin } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { bookingsApi } from "../../lib/bookings";
import {
  formatDateLong,
  formatHourRange,
  formatRupees,
  sportLabel,
} from "../../lib/format";
import type {
  BookStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "BookingConfirmed">;
type Rt = RouteProp<BookStackParamList, "BookingConfirmed">;

export function BookingConfirmedScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();

  const { data: booking, isLoading } = useQuery({
    queryKey: ["booking", params.bookingId],
    queryFn: () => bookingsApi.detail(params.bookingId),
  });

  // Disable hardware back from navigating back into the (now-invalid) hold.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e) => {
      const action = e.data.action;
      // Allow our own reset() / navigate() calls (POP_TO_TOP, REPLACE, RESET).
      if (action?.type !== "GO_BACK") return;
      e.preventDefault();
    });
    return unsub;
  }, [navigation]);

  function goHome() {
    navigation
      .getParent<NativeStackNavigationProp<MainTabsParamList>>()
      ?.navigate("Home");
  }

  function goToBooking() {
    const root = navigation.getParent<
      NativeStackNavigationProp<RootStackParamList>
    >();
    // Jump across the tab stack to Account → BookingDetail.
    root?.dispatch(
      CommonActions.navigate({
        name: "Main",
        params: {
          screen: "Account",
          params: {
            screen: "BookingDetail",
            params: { bookingId: params.bookingId },
          },
        },
      })
    );
  }

  return (
    <Screen>
      <View style={styles.wrap}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <CheckCircle2 size={48} color={colors.primary} />
          </View>
          <Text variant="title" align="center">
            You're booked!
          </Text>
          <Text
            variant="small"
            color={colors.mutedForeground}
            align="center"
            style={styles.heroSub}
          >
            We've sent confirmation details over SMS. See you on the court.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : booking ? (
          <Card style={styles.details}>
            <View style={styles.row}>
              <Text variant="tiny" color={colors.primary}>
                {sportLabel(booking.courtConfig.sport).toUpperCase()}
              </Text>
              <Text variant="heading">{booking.courtConfig.label}</Text>
            </View>
            <View style={styles.detailRow}>
              <Calendar size={16} color={colors.mutedForeground} />
              <Text variant="small" color={colors.mutedForeground}>
                {formatDateLong(booking.date)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Clock size={16} color={colors.mutedForeground} />
              <Text variant="small" color={colors.mutedForeground}>
                {formatHourRange(booking.slots.map((s) => s.startHour))}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <MapPin size={16} color={colors.mutedForeground} />
              <Text variant="small" color={colors.mutedForeground}>
                Momentum Arena
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.totalRow}>
              <Text variant="small" color={colors.mutedForeground}>
                Paid
              </Text>
              <Text variant="heading" color={colors.primary}>
                {formatRupees(
                  booking.payment?.amount ?? booking.totalAmount
                )}
              </Text>
            </View>
            <Text variant="tiny" color={colors.subtleForeground}>
              Booking ID · {booking.id.slice(-10).toUpperCase()}
            </Text>
          </Card>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          label="View booking"
          onPress={goToBooking}
          size="lg"
          fullWidth
        />
        <Button
          label="Back to home"
          variant="ghost"
          onPress={goHome}
          fullWidth
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: spacing["6"],
  },
  hero: {
    alignItems: "center",
    gap: spacing["2"],
    marginTop: spacing["6"],
  },
  iconWrap: {
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
    marginBottom: spacing["2"],
  },
  heroSub: {
    maxWidth: 300,
  },
  loader: {
    alignItems: "center",
    paddingVertical: spacing["8"],
  },
  details: {
    gap: spacing["2.5"],
  },
  row: {
    gap: spacing["1"],
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing["1"],
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: {
    gap: spacing["2"],
  },
});
