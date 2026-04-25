import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { CourtDiagram } from "../../components/CourtDiagram";
import { colors, spacing } from "../../theme";
import { bookingsApi } from "../../lib/bookings";
import { ApiError } from "../../lib/api";
import { sportLabel } from "../../lib/format";
import type { CourtConfig } from "../../lib/types";
import type { BookStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "BookCourt">;
type Rt = RouteProp<BookStackParamList, "BookCourt">;

function sizeLabel(size: string): string {
  switch (size) {
    case "XS":
      return "Box · XS";
    case "SMALL":
      return "Box · S";
    case "MEDIUM":
      return "Half Court · 40×90";
    case "LARGE":
      return "Court · L";
    case "XL":
      return "Court · XL";
    case "FULL":
      return "Full Court · 80×90";
    case "SHARED":
      return "Shared Court";
    default:
      return size;
  }
}

// Collapse MEDIUM Left + MEDIUM Right into a single synthetic "Half Field"
// tile — same treatment the web book page uses. The customer never picks a
// side; the venue assigns one at game time via the /lock?mode=medium path.
type Tile =
  | { kind: "config"; config: CourtConfig }
  | { kind: "medium"; representative: CourtConfig };

function buildTiles(configs: CourtConfig[]): Tile[] {
  const medium = configs.filter((c) => c.size === "MEDIUM");
  const rest = configs.filter((c) => c.size !== "MEDIUM");
  const tiles: Tile[] = rest.map((config) => ({ kind: "config", config }));
  if (medium.length > 0) {
    tiles.push({ kind: "medium", representative: medium[0] });
  }
  return tiles;
}

export function BookCourtScreen() {
  const { params } = useRoute<Rt>();
  const navigation = useNavigation<Nav>();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["courts", params.sport],
    queryFn: () => bookingsApi.courts(params.sport),
    retry: false,
  });

  // Auto-skip the size picker when there's only one tile — matches the web
  // behaviour in `app/book/[sport]/page.tsx` (lines 66-74), where sports like
  // football/pickleball that have a single CourtConfig redirect straight to
  // slot selection. We use `replace` so the user's back-chevron returns to
  // the sport list instead of a blanked-out court picker.
  const autoSkippedRef = useRef(false);
  useEffect(() => {
    if (!data || autoSkippedRef.current) return;
    const tiles = buildTiles(data);
    if (tiles.length !== 1) return;
    autoSkippedRef.current = true;
    const tile = tiles[0];
    if (tile.kind === "medium") {
      navigation.replace("BookSlots", {
        mode: "medium",
        courtLabel: "Half Field",
        sport: params.sport,
      });
    } else {
      navigation.replace("BookSlots", {
        courtConfigId: tile.config.id,
        courtLabel: tile.config.label,
        sport: params.sport,
      });
    }
  }, [data, navigation, params.sport]);

  const errorDetail =
    error instanceof ApiError
      ? `${error.status} · ${error.message}`
      : error instanceof Error
      ? error.message
      : null;

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <Text variant="tiny" color={colors.primary} style={styles.kicker}>
          {sportLabel(params.sport).toUpperCase()}
        </Text>
        <Text variant="title">Choose a court</Text>
        <Text variant="body" color={colors.mutedForeground}>
          Sizes and courts available for this sport.
        </Text>
      </View>

      {isLoading ||
      // Data loaded but we're about to `navigation.replace` because there's
      // only one tile — keep the loader on-screen for that single frame so
      // the user never glimpses a redundant one-tile picker.
      (data && buildTiles(data).length === 1) ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError || !data ? (
        <Card style={styles.state}>
          <Text variant="body" color={colors.mutedForeground}>
            Couldn't load courts. Try again in a moment.
          </Text>
          {errorDetail ? (
            <Text variant="small" color={colors.destructive} style={styles.errorDetail}>
              {errorDetail}
            </Text>
          ) : null}
        </Card>
      ) : data.length === 0 ? (
        <Card style={styles.state}>
          <Text variant="bodyStrong">No courts configured</Text>
          <Text variant="small" color={colors.mutedForeground}>
            Check back soon — courts for this sport will appear here.
          </Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {buildTiles(data).map((tile) => {
            if (tile.kind === "medium") {
              const rep = tile.representative;
              return (
                <Pressable
                  key="medium"
                  onPress={() =>
                    navigation.navigate("BookSlots", {
                      mode: "medium",
                      courtLabel: "Half Field",
                      sport: params.sport,
                    })
                  }
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Card>
                    <View style={styles.headerRow}>
                      <View style={styles.headerText}>
                        <Text variant="heading">Half Field</Text>
                        <Text variant="small" color={colors.mutedForeground}>
                          {sizeLabel(rep.size)} · {rep.widthFt}×{rep.lengthFt} ft
                        </Text>
                      </View>
                      <ChevronRight size={20} color={colors.subtleForeground} />
                    </View>
                    <View style={styles.diagramWrap}>
                      <CourtDiagram highlightedZones={rep.zones} size="sm" />
                    </View>
                    <Text variant="tiny" color={colors.subtleForeground}>
                      Venue assigns a side at game time.
                    </Text>
                  </Card>
                </Pressable>
              );
            }
            const c = tile.config;
            return (
              <Pressable
                key={c.id}
                onPress={() =>
                  navigation.navigate("BookSlots", {
                    courtConfigId: c.id,
                    courtLabel: c.label,
                    sport: params.sport,
                  })
                }
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Card>
                  <View style={styles.headerRow}>
                    <View style={styles.headerText}>
                      <Text variant="heading">{c.label}</Text>
                      <Text variant="small" color={colors.mutedForeground}>
                        {sizeLabel(c.size)} · {c.widthFt}×{c.lengthFt} ft
                      </Text>
                    </View>
                    <ChevronRight size={20} color={colors.subtleForeground} />
                  </View>
                  <View style={styles.diagramWrap}>
                    <CourtDiagram highlightedZones={c.zones} size="sm" />
                  </View>
                  {c.zones.length > 0 ? (
                    <View style={styles.zonesRow}>
                      {c.zones.slice(0, 3).map((z) => (
                        <Badge
                          key={z}
                          label={z.replace("_", " ")}
                          tone="neutral"
                        />
                      ))}
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing["2"],
    gap: spacing["1.5"],
  },
  kicker: {
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  loader: {
    paddingVertical: spacing["10"],
    alignItems: "center",
  },
  state: {
    marginTop: spacing["6"],
    gap: spacing["2"],
  },
  errorDetail: {
    marginTop: spacing["1"],
  },
  list: {
    marginTop: spacing["6"],
    gap: spacing["3"],
  },
  pressed: {
    opacity: 0.75,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  diagramWrap: {
    marginTop: spacing["3"],
    marginBottom: spacing["1"],
    alignItems: "center",
  },
  zonesRow: {
    marginTop: spacing["1.5"],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["1.5"],
  },
});
