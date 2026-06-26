import {
  Image,
  Linking,
  StatusBar,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/ui/Button";
import { Text } from "../../components/ui/Text";
import { colors, spacing } from "../../theme";

// Same brand mark the splash uses.
const LOGO: ImageSourcePropType = require("../../assets/momentum-icon.png");

const FALLBACK_MESSAGE =
  "A new version of Momentum Arena is required to continue. Please update to the latest version to keep playing.";

interface Props {
  /** Store deep-link to send the user to (App Store / Play Store). */
  storeUrl: string;
  /** Server-supplied copy explaining why the update is required. */
  message?: string | null;
}

/**
 * Full-screen, NON-DISMISSIBLE "Update Required" gate.
 *
 * App.tsx renders this INSTEAD of the normal app tree when the backend
 * reports `native.forced` — so there is intentionally no back button, no
 * "Later", and no way out except updating. It owns the whole screen
 * (its own SafeAreaView), blocking every other surface beneath it.
 */
export function ForceUpdateScreen({ storeUrl, message }: Props) {
  const openStore = () => {
    if (!storeUrl) return;
    // Fire-and-forget — if the store URL can't be opened there's nothing
    // useful to recover to (this screen is the whole app right now).
    void Linking.openURL(storeUrl).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </View>

        <Text variant="title" align="center" style={styles.headline}>
          Update Required
        </Text>

        <Text
          variant="body"
          color={colors.mutedForeground}
          align="center"
          style={styles.message}
        >
          {message?.trim() ? message : FALLBACK_MESSAGE}
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          label="Update now"
          onPress={openStore}
          fullWidth
          size="lg"
          disabled={!storeUrl}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["8"],
    gap: spacing["4"],
  },
  logoWrap: {
    marginBottom: spacing["4"],
  },
  logo: {
    width: 96,
    height: 96,
  },
  headline: {
    marginTop: spacing["2"],
  },
  message: {
    maxWidth: 340,
  },
  footer: {
    paddingHorizontal: spacing["6"],
    paddingBottom: spacing["8"],
    paddingTop: spacing["4"],
  },
});
