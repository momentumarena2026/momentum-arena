/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';

// Required by @react-native-firebase/messaging: a top-level background/
// quit-state handler. Our pushes carry a `notification` block (the OS
// renders them) and tap-routing happens in-app, so there's nothing to do
// here — but registering it silences the RN-Firebase warning and
// future-proofs any data-only background push.
messaging().setBackgroundMessageHandler(async () => {});

AppRegistry.registerComponent(appName, () => App);
