import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff, RotateCw } from "lucide-react-native";
import { Text } from "./ui/Text";
import { colors, radius, spacing } from "../theme";
import { isOnline, subscribeConnectivity } from "../lib/api";

/**
 * "No internet" bar, pinned under the status bar.
 *
 * Connectivity comes from request outcomes rather than a native
 * reachability module — see the note in lib/api.ts. That keeps this
 * shippable over OTA, at the cost of being reactive: we surface the
 * banner once something has actually failed to reach the server.
 *
 * Retry refetches whatever the current screen is showing, so the user
 * doesn't have to guess which pull-to-refresh brings the app back.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [offline, setOffline] = useState(!isOnline());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => subscribeConnectivity((v) => setOffline(!v)), []);

  if (!offline) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + spacing["2"] }]} pointerEvents="box-none">
      <View style={styles.bar}>
        <WifiOff size={15} color="#fca5a5" />
        <View style={{ flex: 1 }}>
          <Text variant="small" weight="700" color="#fecaca">
            No internet connection
          </Text>
          <Text variant="tiny" color="#fca5a5">
            Check your network — we&apos;ll reconnect automatically.
          </Text>
        </View>
        <Pressable
          disabled={retrying}
          onPress={async () => {
            setRetrying(true);
            try {
              // Refetching an active query re-probes the network; a
              // success flips the flag back through the api client.
              await qc.refetchQueries({ type: "active" });
            } finally {
              setRetrying(false);
            }
          }}
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
        >
          <RotateCw size={13} color="#fecaca" />
          <Text variant="tiny" weight="700" color="#fecaca">
            {retrying ? "…" : "Retry"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: spacing["4"],
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    backgroundColor: "rgba(69,10,10,0.96)",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2"],
  },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
  },
});
