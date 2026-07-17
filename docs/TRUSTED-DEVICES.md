# Trusted Devices (hidden admin entry)

The mobile app's admin shell is reached through a hidden easter egg —
tapping the version label on the Account screen. Trusted Devices gates that
entry so **only allowlisted phones** can open the admin login at all: the
5-tap gesture is inert on every other device.

## How the gesture works (mobile)

`VersionFooter` in `apps/mobile/src/screens/account/AccountScreen.tsx`:

- Every tap on the version label increments a counter (reset after 1.5s of
  inactivity; the timer is cleared on each tap so a deliberate streak
  always lands).
- **Trusted device + 5 taps** → `AdminLogin` (or straight to `AdminShell`
  if an admin session is already live — a live session also bypasses the
  trust check entirely).
- **Untrusted device + 12 taps** → a modal reveals this device's ID
  (selectable, long-press to copy) so it can be registered. Nothing else
  happens — no visual feedback on earlier taps, so idle customers see
  nothing.

Enforcement is **hard**: there is no empty-table grace rule. A fresh
environment must register its first device via the web admin.

## Device identity

`apps/mobile/src/lib/device-id.ts` — a keychain-persisted UUID seeded from
the platform identifier (`ANDROID_ID` / `identifierForVendor`) on first
launch. Survives app restarts; wiped with the app's keychain data.

## Trust check

`GET /api/mobile/device-trust?deviceId=…` — public (no auth), returns
`{ trusted: boolean }`. The app caches it for 5 minutes and **fails
closed** (errors → untrusted). Being merely trusted only reveals the login
form — admin credentials are still required; trust is a visibility gate,
not an authentication factor.

## Registration paths

1. **Manual** — an admin opens *Admin → Trusted Devices* (web
   `/admin/trusted-devices` or the mobile admin screen), pastes the device
   ID from the 12-tap reveal, adds a label.
2. **Self-registration** — a successful admin login from any device
   registers that device automatically (so an admin's own phone never needs
   the manual dance).

## Data model

`TrustedDevice` (prisma): `deviceId @unique`, `label`, `platform`
("ios"/"android", display only), `source` (`"MANUAL"` = added on the admin
page, `"LOGIN"` = auto-trusted on a successful mobile admin login),
`createdAt`, `lastSeenAt`. Rows are plain allow-list entries — deleting one
immediately de-trusts the device (subject to the app's 5-minute cache).

## Permission

`MANAGE_TRUSTED_DEVICES` in `lib/permissions.ts` (label: "Manage Trusted
Devices (5-tap admin entry)"), mirrored in
`apps/mobile/src/lib/admin-permissions.ts`. SUPERADMIN bypasses per the
global permission rule; other admins need the grant to view/edit the list.

## Why it exists

The 5-tap entry used to work on any phone, meaning anyone who learned the
gesture could reach the admin login form. The allowlist keeps the login
surface invisible on customer devices while staying self-service for real
admins (12-tap reveal + self-registration on login).
