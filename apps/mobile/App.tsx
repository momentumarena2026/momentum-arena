import "react-native-gesture-handler";
import { useEffect, useState } from "react";
import { AppProviders } from "./src/providers/AppProviders";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { SplashScreen } from "./src/screens/splash/SplashScreen";
import { initAnalytics } from "./src/lib/analytics";

export default function App() {
  // Wire AppState + foreground-flush listeners exactly once. Safe
  // even if the user never grants notification perms or never signs
  // in — the queue is MMKV-backed and only fires network requests
  // when there are events to flush.
  useEffect(() => {
    initAnalytics();
  }, []);

  // Show the animated splash on every cold start. The native
  // LaunchScreen.storyboard is a plain black background, so the JS
  // splash takes over invisibly the moment the bundle is ready.
  // Setting `splashDone` to true permanently swaps in RootNavigator;
  // there's no way to re-show the splash without a fresh launch,
  // which is what we want.
  const [splashDone, setSplashDone] = useState(false);

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
