import { GIT_BRANCH } from "./build-config.generated";

/**
 * Base URL the mobile app talks to — picked at bundle time from the
 * git branch the bundle was built from.
 *
 *   `main`               → https://www.momentumarena.com  (production)
 *   anything else        → https://development.momentumarena.com
 *
 * The "anything else" bucket intentionally covers both `development`
 * (the dev environment branch) and feature branches forked off it.
 * Defaulting to the dev backend means an unrecognised or detached-HEAD
 * build can never accidentally write to production data — you only
 * hit prod if you're explicitly bundling from `main`.
 *
 * GIT_BRANCH is captured by `scripts/write-build-config.js`, which is
 * invoked automatically from `metro.config.js` (debug bundles, Xcode
 * Archives, Gradle release builds — every distribution path goes
 * through Metro). See that script for fallback behaviour.
 */
const PROD_API_URL = "https://www.momentumarena.com";
const DEV_API_URL = "https://development.momentumarena.com";

const API_URL = GIT_BRANCH === "main" ? PROD_API_URL : DEV_API_URL;

// Quick visibility in the Metro console so it's obvious which backend
// a dev build is talking to and which branch it claims to be from.
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log(`[env] git branch = ${GIT_BRANCH}, API base = ${API_URL}`);
}

export const env = {
  apiUrl: API_URL,
  gitBranch: GIT_BRANCH,
  isDev: __DEV__,
} as const;
