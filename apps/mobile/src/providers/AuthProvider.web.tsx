/**
 * The web build of the auth provider — used ONLY by the admin's challenge
 * preview, and never by the app.
 *
 * `.web.tsx` is React Native's own platform-extension convention: Metro
 * resolves `.ios.tsx` / `.native.tsx` / `.tsx` and ignores this file
 * entirely, while the web bundler prefers it. So a phone gets the real
 * provider and the preview gets this one, from the same import, with no
 * alias and nothing to remember.
 *
 * WHY IT EXISTS. The real provider restores a session from the keychain,
 * caches to MMKV and registers for push — so importing it drags
 * react-native-keychain, react-native-mmkv, expo-modules-core and Firebase
 * into a web bundle, none of which can be parsed there. Stubbing each one
 * would work and would be wrong: every stub is a place the preview can
 * quietly differ from the app, and the preview's entire value is that it
 * cannot. One honest file at the boundary beats six pretending to be
 * native modules.
 *
 * WHAT IT COSTS. The screen reads auth for exactly one thing: the name,
 * email and phone it prefills into Razorpay's sheet. The preview never
 * reaches a payment, so a null user changes nothing that is drawn. WHO is
 * being previewed comes from the payload's `viewerId`, which is the
 * server's answer and not this file's.
 *
 * If the challenge screen ever starts RENDERING something from auth, this
 * file is where it will show up as blank — and `tests/preview-parity.test.ts`
 * is what will tell you before a venue does.
 */
"use client";

import { createContext, type PropsWithChildren } from "react";

const previewAuth = {
  state: { user: null, status: "signedOut" as const },
  signIn: async () => undefined,
  signOut: async () => undefined,
  refresh: async () => undefined,
};

export const AuthContext = createContext<typeof previewAuth | null>(previewAuth);

export function AuthProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export function useAuth() {
  return previewAuth;
}
