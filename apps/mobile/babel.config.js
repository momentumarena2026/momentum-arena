module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Reanimated 4.x uses the worklets plugin (replaces the old
    // `react-native-reanimated/plugin`). Must be last.
    'react-native-worklets/plugin',
  ],
};
