# Momentum Arena — React Native App (Bare CLI)

## Overview
Build a customer-facing React Native app using bare React Native CLI (no Expo). The app consumes the existing Next.js API at `localhost:3000` (dev) / `momentumarena.com` (prod).

## Tech Stack
- **React Native CLI** (bare workflow)
- **React Navigation** (stack + tab navigation)
- **React Native Paper** (Material Design UI components)
- **AsyncStorage** (local token/session storage)
- **Axios** (API client with interceptors for auth)
- **react-native-razorpay** (payment integration)
- **@react-native-google-signin/google-signin** (Google OAuth)
- **react-native-pdf** + **rn-fetch-blob** (invoice download/view)
- **react-native-vector-icons** (icons)
- **TypeScript** throughout

## Project Location
`/Users/nakulvarshney/Workspace/momentum-arena-app/` (separate from web project)

## API Endpoints to Consume
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/[...nextauth]` | POST | Login (credentials, Google) |
| `/api/availability` | GET | Fetch available slots |
| `/api/booking/lock` | POST | Lock selected slots |
| `/api/razorpay/create-order` | POST | Create payment order |
| `/api/razorpay/verify` | POST | Verify payment |
| `/api/invoice?bookingId=X` | GET | Download invoice PDF |

**Note:** NextAuth is web-focused. We'll need to add a few mobile-friendly API routes:
- `POST /api/mobile/login` — email+password or email+OTP login returning JWT
- `POST /api/mobile/google-login` — accept Google ID token, return JWT
- `POST /api/mobile/send-otp` — send email OTP
- `POST /api/mobile/verify-otp` — verify OTP
- `POST /api/mobile/set-password` — set/change password
- `GET /api/mobile/me` — get current user profile
- `GET /api/mobile/bookings` — get user's bookings

## Screens (10 total)

### Phase 1 — Auth & Navigation Shell
1. **SplashScreen** — Logo animation, check stored JWT
2. **LoginScreen** — Google sign-in button, Email OTP tab, Email+Password tab
3. **SetPasswordScreen** — Optional password setup after first login
4. **ForgotPasswordScreen** — Request OTP → verify → set new password

### Phase 2 — Booking Flow
5. **HomeScreen** — Dashboard with upcoming bookings, "Book a Court" CTA, stats
6. **SportSelectionScreen** — Grid of sports (Cricket, Football, Pickleball, Badminton)
7. **CourtSelectionScreen** — List court sizes/configs for selected sport
8. **SlotSelectionScreen** — 30-day scrollable date picker + hourly slot grid + pay button

### Phase 3 — Post-Booking
9. **BookingConfirmationScreen** — Success state, booking details, download invoice
10. **MyBookingsScreen** — List of all bookings with filters (Upcoming/Past/Cancelled)
11. **ProfileScreen** — User info, change password, sign out

## Implementation Steps

### Step 1: Project Setup
- `npx @react-native-community/cli init MomentumArena --template react-native-template-typescript`
- Install dependencies: react-navigation, react-native-paper, axios, async-storage, react-native-razorpay, google-signin, vector-icons
- Configure Android/iOS projects (Google Sign-In, Razorpay)
- Set up folder structure:
  ```
  src/
    api/          — Axios client, endpoint functions
    components/   — Shared UI components
    screens/      — All screens
    navigation/   — Stack/Tab navigators
    context/      — Auth context
    utils/        — Helpers, constants
    types/        — TypeScript types
  ```

### Step 2: Add Mobile API Routes (Web Backend)
- Create `/api/mobile/` routes in the Next.js app
- JWT-based auth (not cookie-based like NextAuth)
- These routes wrap existing business logic (same Prisma queries)

### Step 3: Auth Context & API Client
- Axios instance with base URL + JWT interceptor
- AuthContext: login, logout, token refresh
- Persist JWT in AsyncStorage
- Auto-redirect to login on 401

### Step 4: Auth Screens
- LoginScreen with 3 methods: Google, Email OTP, Email+Password
- Google Sign-In native flow → send idToken to backend
- OTP flow: enter email → receive OTP → verify → logged in
- Password flow: enter email + password → logged in
- SetPasswordScreen shown after first login if no password set

### Step 5: Home & Dashboard
- Fetch upcoming bookings, stats
- "Book a Court" prominent button
- Pull-to-refresh

### Step 6: Booking Flow
- Sport selection → Court selection → Slot selection
- 30-day horizontal scrollable date picker
- Slot grid showing available/booked/blocked hours
- Price display, lock slot on selection
- Razorpay native checkout

### Step 7: Post-Booking
- Confirmation screen with booking details
- Invoice download as PDF
- My Bookings list with status filters

### Step 8: Profile
- View/edit profile info
- Change password
- Sign out (clear JWT + AsyncStorage)

## Key Differences from Web App
1. **Auth**: JWT tokens instead of NextAuth cookies
2. **Navigation**: React Navigation stack instead of Next.js routing
3. **Payments**: react-native-razorpay SDK instead of web checkout.js
4. **Invoice**: Download PDF to device instead of browser download
5. **No cart**: Single booking flow only (cart was removed from web)
6. **No admin**: Admin panel stays web-only
