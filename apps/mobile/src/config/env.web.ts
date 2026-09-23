/**
 * The web build of the app's env — for the admin challenge preview only.
 *
 * `.web.ts` is React Native's platform-extension convention: Metro resolves
 * `.ios.ts` / `.native.ts` / `.ts` and never sees this file, so the app on a
 * phone still reads its real branch-derived API base.
 *
 * WHY IT HAS TO EXIST, and this one broke a production deploy rather than a
 * local build: the real `env.ts` imports `./build-config.generated`, which
 * Metro writes at bundle time and `apps/mobile/.gitignore` excludes. It is
 * present on every developer's machine and on no CI checkout, so the web
 * build resolved it locally and could not resolve it on Vercel. A green
 * local build proved nothing about the one that matters.
 *
 * The preview never makes a network call — its query cache is pre-seeded
 * and fetching is switched off — so the base URL below is only ever the
 * string the app's api client interpolates into a request it does not send.
 * It points at production because that is what the admin is looking at; if
 * a preview ever DOES fetch, that is a bug this comment should help find.
 */
const API_URL = "https://www.momentumarena.com";

export const env = {
  apiUrl: API_URL,
  gitBranch: "web-preview",
  isDev: false,
} as const;
