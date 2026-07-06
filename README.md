# Momentum Arena

Multi-sport venue platform for **Momentum Arena, Mathura** — court booking
(cricket, football, pickleball + bowling machine), cafe ordering, a pickup
shop, rewards, and a full admin console. One backend, three surfaces:

| Surface | What | Where |
|---|---|---|
| **Web** | Customer site + full admin console | `www.momentumarena.com` (prod) · `development.momentumarena.com` (staging) |
| **iOS app** | Customer + full admin console | TestFlight / App Store (`com.momentumarena`) |
| **Android app** | Customer + full admin console | Play internal / production (`com.momentumarena`) |

The repo is a monorepo by convention: the Next.js web app at the root, the
React Native app under `apps/mobile/`. They share HTTP contracts
(`/api/mobile/*`), not code.

## Quick start (web)

```bash
npm install
npm run dev          # http://localhost:3000
npx tsc --noEmit     # typecheck
```

Copy `.env.example` → `.env` and fill in at least `DATABASE_URL` and
`AUTH_SECRET`. `npm run build` locally skips the DB-sync steps (they only run
on Vercel).

## Quick start (mobile)

```bash
cd apps/mobile
npm install          # also writes src/config/build-config.generated.ts
npm run ios          # or: npm run android
```

The app picks its backend from the current **git branch** at bundle time:
`main` → production API, anything else → staging. iOS pods:
`pod install --project-directory=ios` (CocoaPods 1.16.x).

## Deploying

Everything ships from two branches — push to `development` (staging), then
promote to `main` (production). Schema sync, seeds, mobile OTA publishing and
native store builds are all automated; read
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** before your first deploy.

## Documentation

- [PROJECT-ARCHITECTURE.md](PROJECT-ARCHITECTURE.md) — codebase map: routing, auth systems, domain model, mobile app
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — the deployment runbook (web, DB, OTA, native builds)
- [docs/GO-LIVE.md](docs/GO-LIVE.md) — production launch checklist & current status
- [Momentum-Arena-Feature-Guide.pdf](Momentum-Arena-Feature-Guide.pdf) — product feature catalog with flowcharts (regenerate via `python3 generate-feature-guide.py`)
- [docs/phonepe-dqr-onboarding.md](docs/phonepe-dqr-onboarding.md) — PhonePe Dynamic QR reference
- [SEO-GUIDE.md](SEO-GUIDE.md) / [LOCAL-SEO-GUIDE.md](LOCAL-SEO-GUIDE.md) — search/discovery playbooks
- [CLAUDE.md](CLAUDE.md) — repo-wide rules for AI-assisted sessions
