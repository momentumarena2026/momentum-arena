/**
 * Base URL the mobile app talks to.
 *
 * Dev builds hit the Vercel `development` environment
 * (https://development.momentumarena.com) which auto-deploys from the
 * `development` branch. This lets physical devices, simulators, and
 * emulators all work without anyone having to run the Next server locally.
 *
 * Production / release builds (`__DEV__ === false`) point at the live site.
 */
const PROD_API_URL = "https://www.momentumarena.com";
const DEV_API_URL = "https://development.momentumarena.com";

const API_URL = __DEV__ ? DEV_API_URL : PROD_API_URL;

// Quick visibility in the Metro console so it's obvious which backend a
// dev build is talking to.
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log(`[env] API base = ${API_URL}`);
}

export const env = {
  apiUrl: API_URL,
  isDev: __DEV__,
} as const;
