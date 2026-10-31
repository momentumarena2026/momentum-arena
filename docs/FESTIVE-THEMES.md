# Festive themes

The seasonal skin the website and the app wear during a festival —
Diwali, Christmas, Holi — plus the admin switch that governs it.

Code: `lib/festive-themes.ts` (and its app mirror), rendered by
`components/festive/festive-backdrop.tsx` on web and
`apps/mobile/src/components/festive/FestiveBackdrop.tsx` in the app.
Admin at **/admin/config/festive-theme**.

---

## What it is, and what it deliberately is not

A festive theme here is a **layer**: a tinted backdrop, two corner glows
and a motif. Navigation, copy, spacing and component colours do not
change underneath it.

That boundary is the feature, not a shortcut. Three things follow from
it, and all three are the reason this is safe to run on a live venue:

- **Contrast is untouched.** `--background` stays black and
  `--foreground` stays white, so every readability decision already made
  in this product still holds during a festival. The alternative —
  redefining the theme variables for a fortnight — makes every page's
  legibility a festival-shaped unknown. A bad palette here can look
  wrong; it cannot make the site unreadable.
- **Off is instant and total.** There is no migration back.
- **It cannot eat a tap.** Both renderers are `pointer-events: none` /
  `pointerEvents="none"` across the full viewport.

Accents are still asserted rather than trusted: `contrastOnBlack` and a
test hold every colour to the 4.5:1 AA floor on the black canvas. The
current palette runs 7.6:1 to 14.6:1.

---

## How a theme is chosen

`resolveFestiveTheme({ mode, override, dayKey })`, with `dayKey` a bare
**IST** calendar date. Three modes, mirroring the rain banner's
AUTO/ON/OFF that the venue already understands:

| Mode | Behaviour |
|---|---|
| `AUTO` | Follow the calendar. The default. |
| `ON` | Force `override` on. With no override, falls back to the calendar — which is what makes "force on" usable for previewing before a window opens. |
| `OFF` | Nothing, whatever the date. The kill switch. |

An unknown mode resolves as AUTO and an unknown override is ignored,
because this runs on the home page of a live venue and a bad settings
row must degrade to the ordinary site, never to a 500.

### Windows are typed out by hand, per year

Diwali and Holi are **lunar** — they move every year, and nothing in
this repo should pretend otherwise. `lib/navratri-2026.ts` and
`lib/diwali-2026.ts` set this precedent: dates are verified against
published panchang and written down. Christmas is fixed but written the
same way so every theme reads identically.

**A year with no entry has no theme.** That is the correct failure: a
missing window shows the ordinary site, where a guessed one would put
diyas on the wrong fortnight.

Currently set: Diwali `2026-11-01 → 2026-11-11` (deliberately the same
bounds as the Diwali Bumper offer, so the skin and the discount start
and stop together), Christmas `2026-12-18 → 2026-12-26`, Holi
`2027-03-20 → 2027-03-23`.

**Adding a year** is an edit to `windows` in *both* copies of
`festive-themes.ts`. The parity test fails if you do one.

---

## How it reaches each surface

Only the **theme ID** crosses the wire. The palette and the motif are
compiled into each platform's bundle, because sending colours would make
the server a second source of truth that could disagree with whatever
build is installed on the phone.

- **Web** — resolved server-side in `app/layout.tsx`, so the first paint
  is already dressed. A client fetch would flash the plain site for a
  frame on every navigation.
- **App** — `GET /api/festive-theme`, ISR-cached 5 minutes, read with
  `auth: false` so it works signed out. `setFestiveTheme` calls
  `revalidatePath("/api/festive-theme")` as well as `"/"` — **gotcha
  26**: purging only `"/"` updates the website instantly and leaves the
  app on the cached route, which reads as "the toggle didn't work".
  The component opts into `refetchOnWindowFocus` so an app left open
  across the end of a festival does not keep the skin.

The admin page states the ~5-minute app lag in plain words, because an
admin who saves and then opens their phone otherwise reports it as
broken — which is exactly what happened with the Information Bar.

---

## Themed app icons — NOT shipped, and why

The venue asked for festive app icons, the way Swiggy and Zepto change
theirs for Raksha Bandhan and Diwali. This is **not implemented**, and
the reason is a platform constraint rather than a decision:

> **The icon assets must be compiled into the binary. Only the
> *selection* can be changed remotely.**

- **iOS** — alternate icons must be declared in `CFBundleAlternateIcons`
  in `Info.plist` and bundled at build time; `setAlternateIconName`
  only switches between ones already present. iOS also shows a system
  alert confirming the change that **cannot be suppressed**.
- **Android** — the standard trick is one `<activity-alias>` per icon in
  the manifest, toggled with `PackageManager.setComponentEnabledSetting`.
  Also bundled at build time. No system alert.

So shipping festive icons means a **native build and a store release**
for each platform — not an OTA. Two consequences worth writing down:

1. **Icons could not have made Diwali 2026.** The theme work was done on
   31 Oct for a festival starting 1 Nov; store review alone exceeds
   that. The earliest realistic festival is Christmas, if a native build
   goes out during November.
2. **Every icon must ship in one build, up front.** The whole year's
   icons (Diwali, Christmas, Holi) should go into the binary together,
   because adding one later needs another store release.

There is a sharp Android gotcha to carry into that work: **you can never
remove an `activity-alias` you have shipped.** If a user still has that
alias enabled and an update deletes it, their launcher icon disappears
entirely. Aliases are append-only, forever. On API ≤ 28 switching also
drops any home-screen shortcut the user had made.

`FestiveTheme.iconKey` already names the asset each theme would use, so
the theme and its icon are declared together in one place when a build
does carry them. The key is inert today and the parity test only checks
the keys are distinct and asset-safe.

---

## Adding a theme

1. Add it to `FESTIVE_THEMES` in `lib/festive-themes.ts` **and** the app
   mirror — identical, including windows.
2. Verify the festival dates against published panchang. Do not compute
   lunar dates.
3. Give it a motif. Web needs a `.festive-motif-<motif>` rule in
   `app/globals.css`; the app branches in `FestiveBackdrop.tsx`.
4. Run `npm test` — the parity suite checks the two copies field for
   field, that windows do not overlap within a year, and that every
   colour clears AA on black.
