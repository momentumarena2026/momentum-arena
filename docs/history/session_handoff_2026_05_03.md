---
name: Session handoff 2026-05-03 — 5-tap easter-egg false-trigger fix in flight
description: Prior session crashed mid-fix on Account-screen drag-down accidentally triggering admin-mode 5-tap. Pick up here.
type: project
originSessionId: aa339a16-76d9-4c1d-9a57-2ba0429802ad
---
Prior session (`Analyze full project web and mobile code (fork 9)`, branch `claude/infallible-banzai-8537f4`) crashed on an "image dimension limit (2000px) exceeded" API error before completing an in-progress fix.

**Bug to fix** (user's exact report):
> "once i have gone to admin screens after that i came back to customer screen and navigate to account screen. I tried to drag down the account screen fastly, It happens that admin screen comes up after that action in mobile app"

**Root cause hypothesis** (assistant's reasoning before crash):
- The 5-tap easter-egg on the "Momentum Arena · v0.1.0" footer of `AccountScreen.tsx` triggers admin mode (`/godmode` → AdminShell)
- After visiting admin and returning to customer, fast drag/scroll gestures on the Account screen are being misregistered as 5 rapid taps → admin shell loads unintentionally
- Fix direction: make the tap detection stricter (e.g. require taps to be on the static footer text only, debounce against scroll/pan responders, or reset the counter on scroll)

**Where to start in code**:
- `apps/mobile/src/screens/account/AccountScreen.tsx` — look around line 548 (offset the prior session was reading)
- The 5-tap handler is likely a simple `onPress` counter without scroll-state guard

**Note about worktree paths**: prior session was thrashing because it kept Read'ing paths under `worktrees/kind-proskuriakova-74f330/` while CWD was a different worktree. The current session is in `worktrees/bold-germain-0a1959/` and the file is confirmed to exist there — use this worktree's paths.

**Why:** User wants a fix, not a rebuild — they've already tested the easter egg and confirmed it works; just needs to be less trigger-happy.

**How to apply:** When user says "continue" or asks about the drag-down bug, this is the fix to implement. Don't re-architect the easter egg; tighten the existing handler.
