import "react-native-gesture-handler";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { useUpdates } from "expo-updates";
import { AppProviders } from "./src/providers/AppProviders";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { SplashScreen } from "./src/screens/splash/SplashScreen";
import { ForceUpdateScreen } from "./src/screens/update/ForceUpdateScreen";
import { initAnalytics } from "./src/lib/analytics";
import { ensureOtaRolloutBucket } from "./src/lib/ota";
import {
  checkAppVersion,
  type VersionCheckResult,
} from "./src/lib/appVersion";

export default function App() {
  // Wire AppState + foreground-flush listeners exactly once. Safe
  // even if the user never grants notification perms or never signs
  // in — the queue is MMKV-backed and only fires network requests
  // when there are events to flush.
  useEffect(() => {
    initAnalytics();
    // Assign a sticky OTA rollout bucket once, for staged % rollouts.
    ensureOtaRolloutBucket();
  }, []);

  // Show the animated splash on every cold start. The native
  // LaunchScreen.storyboard is a plain black background, so the JS
  // splash takes over invisibly the moment the bundle is ready.
  // Setting `splashDone` to true permanently swaps in RootNavigator;
  // there's no way to re-show the splash without a fresh launch,
  // which is what we want.
  const [splashDone, setSplashDone] = useState(false);

  // Auto-apply OTA updates, but ONLY while the splash is still up. On a slow
  // connection the background download can land minutes into the session, and
  // reloadAsync() tears the JS context down: a live Razorpay sheet dies before
  // verifyOrder/settledByWebhook can run (a captured cafe payment has no
  // webhook branch, so it orphans), and DqrCheckout's txnRef/doneRef are
  // in-memory only, so an in-flight PhonePe poll loses its transaction id.
  // Before RootNavigator mounts none of that can be in flight. If the update
  // arrives later we simply leave it pending — expo-updates launches it on the
  // next cold start by itself, so nothing is lost, just deferred one launch.
  const { isUpdatePending } = useUpdates();
  useEffect(() => {
    if (splashDone) return;
    if (isUpdatePending && Updates.isEnabled) {
      Updates.reloadAsync().catch(() => {
        /* best-effort — if the reload fails the current bundle keeps running */
      });
    }
  }, [isUpdatePending, splashDone]);

  // ── In-app version / update gate ───────────────────────────────
  // Result of the most recent backend version-check. `null` means we
  // either haven't checked yet or the check failed — in both cases we
  // render the app normally (NEVER hard-block on a network error).
  const [versionInfo, setVersionInfo] = useState<VersionCheckResult | null>(
    null,
  );
  // Whether we've already shown the (dismissible) soft-update prompt this
  // session. Ref, not state — flipping it must not trigger a re-render and
  // it should survive every foreground without re-prompting.
  const softPromptShownRef = useRef(false);

  const runVersionCheck = useCallback(async () => {
    const result = await checkAppVersion();
    if (!result) return; // unknown — leave prior state, render normally
    setVersionInfo(result);

    const { native } = result;
    // Soft (optional) update: a newer build exists but isn't mandatory.
    // Nag at most once per app session via a dismissible alert; the
    // forced case is handled declaratively in the render tree below.
    if (native.updateAvailable && !native.forced && !softPromptShownRef.current) {
      softPromptShownRef.current = true;
      Alert.alert(
        "Update available",
        native.message?.trim()
          ? native.message
          : "A new version of Momentum Arena is available.",
        [
          { text: "Later", style: "cancel" },
          {
            text: "Update",
            onPress: () => {
              if (native.storeUrl) {
                void Linking.openURL(native.storeUrl).catch(() => {});
              }
            },
          },
        ],
      );
    }
  }, []);

  // Check on mount, and again whenever the app returns to the
  // foreground — that's when a user most likely just came back from the
  // store, or enough time passed that a forced cutoff took effect.
  useEffect(() => {
    void runVersionCheck();

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        void runVersionCheck();
      }
    });
    return () => sub.remove();
  }, [runVersionCheck]);

  // Hard gate: a forced update blocks the ENTIRE app tree. Rendered even
  // over the splash so a too-old build can't slip a session through.
  if (versionInfo?.native.forced) {
    return (
      <AppProviders>
        <ForceUpdateScreen
          storeUrl={versionInfo.native.storeUrl}
          message={versionInfo.native.message}
        />
      </AppProviders>
    );
  }

  return (
    <AppProviders>
      {splashDone ? (
        <RootNavigator />
      ) : (
        <SplashScreen onComplete={() => setSplashDone(true)} />
      )}
    </AppProviders>
  );
}
