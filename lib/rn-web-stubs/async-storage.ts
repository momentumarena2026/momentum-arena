/**
 * AsyncStorage, backed by nothing.
 *
 * The app reads cached state through this on mount. In the preview every
 * screen is handed its data directly, so an empty store is the correct
 * answer rather than a missing one — and unlike the other stubs these
 * resolve instead of throwing, because reading an empty cache is a normal
 * thing for the screen to do.
 */
const AsyncStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
  multiGet: async () => [],
  multiSet: async () => undefined,
  clear: async () => undefined,
};
export default AsyncStorage;
