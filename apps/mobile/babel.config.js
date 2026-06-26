module.exports = {
  presets: ['babel-preset-expo'],
  plugins: [
    // Reanimated 4.x uses the worklets plugin (replaces the old
    // `react-native-reanimated/plugin`). Must be last.
    'react-native-worklets/plugin',
  ],
};
