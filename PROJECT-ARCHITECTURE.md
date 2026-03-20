# Momentum Arena — Project Architecture

## Overview

Momentum Arena is a multi-sport facility booking platform built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS v4**, and **PostgreSQL (Neon)**. It supports OTP-based authentication via **MSG91** and uses **NextAuth.js** for session management.

---

## Project Structure

```
momentum-arena/
│
├── app/
│   ├── layout.tsx              ← Root layout (SessionProvider wraps everything)
│   ├── page.tsx                ← Landing page (+ Login button)
│   ├── globals.css             ← Tailwind v4 + shadcn theme + Arial font
│   ├── sitemap.ts              ← Dynamic sitemap for SEO
│   │
│   ├── (auth)/                 ← 🔓 AUTH ROUTE GROUP
│   │   ├── layout.tsx          ← Centered layout with logo
│   │   └── login/
│   │       └── page.tsx        ← OTP login form (send → verify → redirect)
│   │
│   ├── (protected)/            ← 🔒 CUSTOMER ROUTE GROUP
│   │   ├── layout.tsx          ← Checks session, shows nav + sign out
│   │   └── dashboard/
│   │       └── page.tsx        ← Customer dashboard (bookings, history)
│   │
│   ├── (admin)/                ← 🔐 ADMIN ROUTE GROUP
│   │   ├── layout.tsx          ← Checks session + role === ADMIN
│   │   └── admin/
│   │       └── page.tsx        ← Admin dashboard
│   │
│   └── api/
│       └── auth/
│           └── [...nextauth]/
│               └── route.ts    ← NextAuth API handler (GET + POST)
│
├── actions/
│   └── auth.ts                 ← Server Actions (sendOtp, verifyOtp, resendOtp)
│
├── lib/
│   ├── auth.ts                 ← NextAuth config (JWT, Credentials provider)
│   ├── auth.config.ts          ← Route protection rules (middleware)
│   ├── db.ts                   ← Prisma client singleton
│   ├── otp.ts                  ← OTP logic (send, verify, rate limit, lockout)
│   └── utils.ts                ← Utility helpers (cn for classnames)
│
├── prisma/
│   └── schema.prisma           ← Database models (User, VerificationToken, RateLimit)
│
├── components/ui/              ← shadcn/ui components
│   ├── button.tsx
│   ├── card.tsx
│   ├── input.tsx
│   └── label.tsx
│
├── types/
│   └── next-auth.d.ts          ← TypeScript types for session (role, phone)
│
├── middleware.ts                ← Protects routes before they load
├── .env                        ← Secrets (DB URL, Auth, MSG91)
├── next.config.ts              ← Next.js + Turbopack config
└── package.json                ← Dependencies
```

---

## How Everything Works

### 1. User visits `/` (Landing Page)

```
Landing Page (page.tsx)
  → Static page, no auth needed
  → "Login" button in top-right → links to /login
```

### 2. User clicks Login → `/login`

```
middleware.ts
  → Checks: is user already logged in?
  → YES → redirect to /dashboard
  → NO  → show login page

login/page.tsx (Client Component)
  ┌─────────────────────────────┐
  │  Enter email                │
  │  [y12.nakul@gmail.com    ]  │
  │  [Send OTP]                 │
  └─────────────────────────────┘
```

### 3. User enters email → clicks "Send OTP"

```
Client (login/page.tsx)
  → calls Server Action: actions/auth.ts → sendOtp()

actions/auth.ts → sendOtp()
  → Validates email with Zod
  → calls lib/otp.ts → sendOtp()

lib/otp.ts → sendOtp()
  ├── checkLockout() → Is user locked out? (30 min ban)
  ├── checkRateLimit() → Too many sends? (5 per 15 min)
  ├── generateOtp() → Random 6-digit code
  ├── storeOtp() → Save to Neon DB (VerificationToken table)
  └── sendEmailOtp() → MSG91 Email API
        → POST https://control.msg91.com/api/v5/email/send
        → From: noreply@momentumarena.com
        → Template: global_otp with OTP variable
        → Email delivered to user's inbox
```

### 4. User enters OTP → clicks "Verify & Login"

```
Client (login/page.tsx)
  → calls Server Action: actions/auth.ts → verifyOtpAndLogin()

actions/auth.ts → verifyOtpAndLogin()
  ├── Validate: is it 6 digits?
  ├── lib/otp.ts → verifyOtp()
  │     ├── Check lockout
  │     ├── Find token in DB where identifier + not expired
  │     ├── WRONG → increment attempts (max 3, then lockout)
  │     └── CORRECT → delete token, clear lockout ✅
  │
  ├── Find or create user in DB
  │     └── db.user.findUnique / db.user.create
  │
  └── signIn("otp", { identifier, redirectTo: "/dashboard" })
        → NextAuth creates JWT session
        → Redirect to /dashboard
```

### 5. User lands on `/dashboard`

```
middleware.ts
  → Checks: is user logged in?
  → NO  → redirect to /login
  → YES → allow

(protected)/layout.tsx
  → Reads session via auth()
  → Shows nav bar with email + "Sign Out" button
  → Renders dashboard/page.tsx

dashboard/page.tsx
  → Shows: My Bookings, Book a Court, Booking History
```

### 6. Admin visits `/admin`

```
middleware.ts
  → Checks: is user logged in?
  → NO → redirect to /login

auth.config.ts (authorized callback)
  → Checks: user.role === "ADMIN"?
  → NO  → redirect to /dashboard
  → YES → allow

(admin)/layout.tsx + admin/page.tsx
  → Admin dashboard
```

---

## Database Schema (Neon PostgreSQL)

```
┌─────────────────────────────────────────┐
│ User                                    │
├─────────────────────────────────────────┤
│ id          String   (cuid, PK)         │
│ name        String?                     │
│ email       String?  (unique)           │
│ phone       String?  (unique)           │
│ emailVerified DateTime?                 │
│ phoneVerified DateTime?                 │
│ image       String?                     │
│ role        UserRole (CUSTOMER | ADMIN) │
│ createdAt   DateTime                    │
│ updatedAt   DateTime                    │
├─────────────────────────────────────────┤
│                                         │
│ VerificationToken                       │
├─────────────────────────────────────────┤
│ identifier  String   (email/phone)      │
│ token       String   (6-digit OTP)      │
│ expires     DateTime (5 min TTL)        │
│ attempts    Int      (max 3)            │
├─────────────────────────────────────────┤
│                                         │
│ RateLimit                               │
├─────────────────────────────────────────┤
│ id          String   (cuid, PK)         │
│ identifier  String   (email/phone)      │
│ action      String   (otp_send/lockout) │
│ count       Int                         │
│ windowStart DateTime                    │
├─────────────────────────────────────────┤
│                                         │
│ Account (for future OAuth)              │
├─────────────────────────────────────────┤
│ id, userId, type, provider, tokens...   │
├─────────────────────────────────────────┤
│                                         │
│ Session                                 │
├─────────────────────────────────────────┤
│ id, sessionToken, userId, expires       │
└─────────────────────────────────────────┘
```

---

## Security Layers

```
Request → middleware.ts (route protection)
  → auth.config.ts (role-based access)
    → lib/otp.ts (rate limit + lockout)
      → Neon DB (OTP storage + attempts)
        → MSG91 (email delivery)
```

| Protection | What it does |
|-----------|-------------|
| **middleware.ts** | Blocks unauthenticated users from /dashboard, /admin |
| **auth.config.ts** | Blocks non-admins from /admin |
| **Rate limiting** | Max 5 OTP sends per 15 minutes |
| **Attempt limit** | Max 3 wrong OTPs, then 30-min lockout |
| **JWT session** | Stateless auth, no session DB lookups |
| **OTP expiry** | Each OTP expires in 5 minutes |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v4 + shadcn/ui |
| **Auth** | NextAuth.js v5 (JWT strategy) |
| **Database** | PostgreSQL (Neon, serverless) |
| **ORM** | Prisma |
| **OTP Provider** | MSG91 (Email API) |
| **Validation** | Zod |
| **Icons** | react-icons |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `AUTH_SECRET` | NextAuth JWT signing secret |
| `MSG91_AUTH_KEY` | MSG91 API authentication key |
| `AUTH_URL` | Production URL (for NextAuth callbacks) |

---

## Route Groups Explained

Next.js **route groups** use parentheses `(name)` to organize routes without affecting the URL:

| Folder | URL | Purpose |
|--------|-----|---------|
| `(auth)/login` | `/login` | Public — OTP login page |
| `(protected)/dashboard` | `/dashboard` | Requires login |
| `(admin)/admin` | `/admin` | Requires login + ADMIN role |

Each group has its own `layout.tsx` that adds group-specific UI (nav bars, sidebars) and access checks.

---

## What's Not Built Yet

- [ ] Booking system (courts, time slots, payments)
- [ ] SMS OTP (needs DLT registration, 2-7 days)
- [ ] WhatsApp OTP (needs Meta Business verification)
- [ ] User profile page
- [ ] Admin analytics/reports
- [ ] Payment integration (Razorpay)
- [ ] Vercel deployment
