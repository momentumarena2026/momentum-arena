import UIKit
internal import Expo
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Reads GoogleService-Info.plist from the bundle and creates the
    // [DEFAULT] FIRApp instance. Must run before React Native starts —
    // @react-native-firebase/messaging's JS module throws
    // "No Firebase App '[DEFAULT]' has been created" the moment it's
    // imported if this hasn't been called.
    FirebaseApp.configure()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "MomentumArena",
      in: window,
      launchOptions: launchOptions
    )

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // MARK: - Links that arrive while the app is ALREADY RUNNING
  //
  // ExpoAppDelegate implements both of these callbacks, but its versions
  // only fan out to ExpoAppDelegateSubscribers — and nothing here
  // subscribes. The two packages that register a subscriber forwarding to
  // RCTLinkingManager (expo-linking, expo-dev-client) are both absent from
  // this bare project, so without these overrides RCTLinkingManager never
  // hears about an incoming URL and the JS `url` event never fires.
  //
  // `Linking.getInitialURL()` kept working the whole time because it reads
  // `launchOptions`, which is exactly why this was easy to miss: deep links
  // worked on a cold launch and silently did nothing whenever the app was
  // already open — the common case for a tapped shared link. That made
  // navigation/linking.ts half-dead: React Navigation's linking `subscribe`
  // was listening to an event that was never emitted.
  //
  // Both halves are dispatched deliberately, with no `||` short-circuit
  // (which is what the upstream Expo template uses): a subscriber claiming
  // the URL must not stop React Navigation from seeing it too.

  /// Custom-scheme links: `momentumarena://…` (pushes, printed QR codes).
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    let handledBySubscribers = super.application(app, open: url, options: options)
    let handledByReactNative = RCTLinkingManager.application(app, open: url, options: options)
    return handledBySubscribers || handledByReactNative
  }

  /// Universal Links: `https://momentumarena.com/…` taps, which reach the
  /// app as an `NSUserActivity` rather than as an openURL call.
  override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let handledBySubscribers = super.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
    let handledByReactNative = RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
    return handledBySubscribers || handledByReactNative
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
