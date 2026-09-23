import type { NextConfig } from "next";

/**
 * The two packages sharp needs on Vercel's linux-x64 runtime: the native
 * addon, and the libvips shared object the addon dlopen()s. See the
 * outputFileTracingIncludes note below for why these must be listed by hand.
 */
const SHARP_NATIVE = [
  "./node_modules/@img/sharp-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/**",
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
    /**
     * The admin's challenge PREVIEW renders the app's own
     * `ChallengeDetailScreen` — the real component, not a copy — so the
     * venue can see exactly what each captain is looking at. That means the
     * web bundle has to resolve React Native.
     *
     * `react-native` maps to `react-native-web`, and the handful of modules
     * that are pure native bridges map to stubs under
     * `lib/rn-web-stubs/`. Those stubs exist so the import graph resolves;
     * the preview never runs a payment, spins a wheel or reads a keychain.
     *
     * A NEW native import in that screen will fail this build rather than
     * the preview page at runtime, which is the failure we want — and
     * `tests/preview-parity.test.ts` names every stub so the next person
     * can see at a glance what has been faked and why.
     */
    /**
     * React Native's platform extensions, which are how a package ships one
     * build for phones and another for browsers. Metro applies these; a web
     * bundler does not, so without them `react-native-svg` resolves its
     * NATIVE elements — Fabric components that deep-import React Native's
     * Flow source, which cannot be parsed here at all.
     *
     * Aliasing the package entry is not enough: its own internal `./elements`
     * import resolves the same wrong way one level down. The extension order
     * is the only fix that reaches every level.
     *
     * Nothing else in this app ships a `.web.*` file, so this is inert
     * outside the preview's import graph.
     */
    resolveExtensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".mjs",
      ".json",
    ],
    resolveAlias: {
      "react-native": "react-native-web",
      "@react-navigation/native": "./lib/rn-web-stubs/react-navigation.tsx",
      // The two app modules the preview mounts. Typed opaquely in
      // types/preview-modules.d.ts so React Native's global types never
      // enter the web program; resolved to the REAL files here so what
      // renders is the app's own screen.
      "@preview/challenge-screen":
        "./apps/mobile/src/screens/challenges/ChallengeDetailScreen.tsx",
      "@preview/safe-area": "./lib/rn-web-stubs/safe-area.tsx",
      "react-native-safe-area-context": "./lib/rn-web-stubs/safe-area.tsx",
      // Straight at the WEB elements, not the package entry. The entry's
      // own `export * from "./elements"` relies on React Native's platform
      // extensions to reach `elements.web.js`, and a web bundler does not
      // apply those — so the entry alias alone still dragged in the native
      // Fabric components, which are Flow source and unparseable here.
      "react-native-svg":
        "./node_modules/react-native-svg/lib/module/elements.web.js",
      "react-native-razorpay": "./lib/rn-web-stubs/razorpay.ts",
      "@react-native-firebase/messaging": "./lib/rn-web-stubs/noop.ts",
      "@react-native-firebase/analytics": "./lib/rn-web-stubs/noop.ts",
      "@react-native-firebase/app": "./lib/rn-web-stubs/noop.ts",
      "react-native-keychain": "./lib/rn-web-stubs/noop.ts",
      "@react-native-async-storage/async-storage": "./lib/rn-web-stubs/async-storage.ts",
      "@react-native/assets-registry/registry": "./lib/rn-web-stubs/assets-registry.ts",
      // ONE copy, or two React contexts. `apps/mobile` has its own
      // node_modules, so the screen resolved its react-query there while the
      // preview resolved the root one — two module instances, two providers,
      // and the screen reporting "No QueryClient set" from inside a provider
      // that was right there in the tree. The same trap applies to React
      // itself and to anything else that holds context.
      "@tanstack/react-query": "./node_modules/@tanstack/react-query",
      react: "./node_modules/react",
      "react-dom": "./node_modules/react-dom",
    },
  },
  // The letter generators (NDA / offer) read the authorised-signatory
  // signature + company stamp at render time via fs. They live OUTSIDE
  // /public on purpose — a signature/stamp must never be publicly
  // downloadable — so they aren't auto-bundled into the serverless
  // functions. Trace them in explicitly.
  //
  // sharp's native addon (@img/sharp-linux-x64/lib/*.node) dlopen()s libvips
  // (@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.3) at RUNTIME.
  // File tracing follows static requires, so it ships the addon and leaves
  // the shared object behind, and every route importing sharp then dies at
  // module load with:
  //
  //   Could not load the "sharp" module using the linux-x64 runtime
  //   ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file
  //
  // That happens BEFORE any handler code, so the route cannot report it —
  // Next returns its own HTML 500 and the caller gets a non-JSON body. It
  // was broken from the day sharp arrived (2026-07-17, promo banners) and
  // stayed invisible for six weeks because the upload clients called
  // res.json() on that HTML and surfaced a parse error instead.
  //
  // The globs only resolve on Linux, so they match nothing on a local macOS
  // build and everything on Vercel. Add a route here whenever it imports sharp.
  outputFileTracingIncludes: {
    "/api/admin/nda/generate": ["./assets/letter-assets/**"],
    "/api/admin/offer-letter/generate": ["./assets/letter-assets/**"],
    "/api/admin/tournaments/banner-upload": SHARP_NATIVE,
    "/api/admin/camps/banner-upload": SHARP_NATIVE,
    "/api/admin/promo-banners/upload": SHARP_NATIVE,
    "/api/tournaments/logo-upload": SHARP_NATIVE,
    "/api/cafe-menu-pdf": SHARP_NATIVE,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        // Vercel Blob — every image WE store (camp banners, team logos,
        // promo banners) lives here. Without this next/image refuses the
        // URL and renders a broken image, while local fallbacks like
        // /cricket.png still work, which makes it look like the upload
        // failed when it actually succeeded.
        protocol: "https",
        hostname: "**.blob.vercel-storage.com",
      },
    ],
  },
  // Keep these as Node-only externals. @neondatabase/serverless pulls in
  // node:net / ws internals; @prisma/* include the Rust query engine and
  // driver adapters — none of this can run in the browser, so Turbopack
  // shouldn't try to bundle them for the client.
  serverExternalPackages: [
    "bcryptjs",
    "@prisma/client",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
    // Keep sharp out of the bundle too. Turbopack already externalises it,
    // so this is belt-and-braces rather than the fix — see the tracing
    // block above for the actual cause.
    "sharp",
  ],
  // Disable HTTP/3 (QUIC) advertisement. Indian mobile carriers (Jio, Airtel,
  // VI) intermittently mangle UDP/443, which causes Chrome/Safari to fail
  // reaching the site with "ERR_CONNECTION_*" until the OS network stack is
  // reset. Browsers cache the Alt-Svc hint for ~24h, so the problem persists
  // even after the carrier path recovers. Shipping `Alt-Svc: clear` on every
  // response tells the browser to forget any cached HTTP/3 upgrade for our
  // origin and stick with HTTP/2 over TCP.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Alt-Svc", value: "clear" }],
      },
    ];
  },
  // Apex -> www, for everything EXCEPT /.well-known/.
  //
  // This redirect used to live in Vercel's domain settings, which applies it
  // to every path. That broke Android App Links: the verifier fetches
  // https://momentumarena.com/.well-known/assetlinks.json and does NOT follow
  // redirects, so it saw a 307 and failed the domain ("Domain non-redirect
  // failed" in Play Console). Same rule applies to iOS Universal Links and
  // apple-app-site-association, which is why the whole directory is excluded
  // rather than the one file.
  //
  // The apex is now connected to Production in Vercel so it can serve those
  // files directly, and this brings the redirect back for human traffic. That
  // matters because session cookies are host-scoped: without it, signing in on
  // www leaves you signed out on the apex — two separate sessions on what
  // looks like one site. Scoping the cookie to .momentumarena.com would also
  // "fix" it, but that would hand production session cookies to
  // development.momentumarena.com, so redirecting is the safer of the two.
  //
  // Keeping people on www also keeps the GA4 host check in lib/analytics.ts
  // honest and leaves search consolidated on a single host.
  async redirects() {
    return [
      {
        source: "/:path((?!\\.well-known\\/).*)",
        has: [{ type: "host", value: "momentumarena.com" }],
        destination: "https://www.momentumarena.com/:path",
        // Temporary, matching the 307 Vercel was serving. Worth revisiting as
        // permanent once this is proven, but a cached permanent redirect is
        // painful to undo if the host choice ever changes.
        permanent: false,
      },
    ];
  },
};

export default nextConfig;