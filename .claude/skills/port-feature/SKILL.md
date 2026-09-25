---
name: port-feature
description: Port a change between the web app (web/) and the iOS app (ios/Fitnofat) so the two clients stay in step, and keep parity.json honest. Use when the user asks to bring a feature, commit, PR or fix to the other platform, asks to "sync" or "catch up" iOS or web, or when the parity Stop hook or `npm run parity` flags a one-sided change.
---

# Port a change to the other client

web/ (React PWA) and ios/Fitnofat (SwiftUI) are two clients of the same API and
share no code. `parity.json` records every known gap; `npm run parity`
(scripts/parity.mjs) fails on any gap that isn't recorded. Porting means making
the other client do the same thing *in its own idiom*, not transliterating.

## 1. Find what changed

- A commit or range: `git show --stat <sha>` / `git diff <base>..<head> -- web/src ios server accounts`
- A feature by name: find its entry in `parity.json` (`ios.pending` / `web.pending`)
  and the web/iOS files that implement it.
- Run `npm run parity -- --backlog` for the full list of known gaps.

Classify each change before writing code:

| Kind | Port it? |
|---|---|
| New/changed API call, request or response shape | Yes — both clients must speak it. iOS decoding is strict (see step 3) |
| New enum value, entitlement, plan feature | Yes, and all mirrors (CLAUDE.md lists them) |
| User-visible feature or behaviour | Yes, unless it's recorded as `skip` |
| Shared logic (calories, analytics, formatting) | Yes — same inputs must give the same numbers on both |
| Styling, layout tweak, copy on one platform | No — say so |
| Platform plumbing (service worker, install prompt, haptics, keychain) | No — record as `skip` if it's user-visible |

## 2. File map

| web/src | ios/Fitnofat/Sources |
|---|---|
| `lib/types.ts` | `Models/Types.swift` |
| `lib/api.ts` | `Services/APIClient.swift` (session: `Services/AuthService.swift`) |
| `lib/store.ts` | `Stores/AppStore.swift`, offline queue in `Utilities/Persistence.swift` |
| `lib/entitlements.ts` | `Services/EntitlementService.swift` |
| `lib/calories.ts` | `Utilities/Calories.swift` |
| `lib/analytics.ts` | `Utilities/Analytics.swift` |
| `lib/utils.ts` (formatters) | `Utilities/Formatters.swift` |
| `lib/exercises.ts` | `Models/SeedExercises.swift` |
| `pages/Dashboard.tsx` | `Views/DashboardView.swift`, `Views/AnalyticsView.swift` |
| `pages/ActiveWorkout.tsx` | `Views/ActiveWorkoutView.swift`, `Views/Components/SetRowView.swift`, `RestTimerView.swift` |
| `pages/History.tsx` | `Views/HistoryView.swift` |
| `pages/Routines.tsx`, `RoutineEditor.tsx` | `Views/ProgramView.swift` |
| `pages/Nutrition.tsx`, `components/MacroRing.tsx` | `Views/NutritionView.swift`, `Views/Components/MacroCardView.swift` |
| `pages/AiCoach.tsx` | `Views/AICoachView.swift` |
| `pages/Onboarding.tsx` | `Views/OnboardingView.swift` |
| `pages/Login.tsx` | `Views/AuthView.swift` |
| `pages/Billing.tsx` | `Views/BillingView.swift`, `Views/Components/ProUpgradeView.swift` |
| `pages/Settings.tsx` | `Views/SettingsView.swift` |
| `components/ExerciseDetail.tsx`, `ExercisePicker.tsx`, `RepCounter.tsx` | `Views/Components/ExerciseDetailView.swift`, `ExercisePickerView.swift`, `RepCounterView.swift` |
| `pages/HealthDashboard.tsx`, `Library.tsx`, `ResetPassword.tsx` | not built yet — see `ios.pending` |

If a file has no counterpart, create one following the neighbouring files'
style rather than bolting the feature onto an unrelated view.

## 3. Rules that bite on iOS

- **Decoding is all-or-nothing.** Swift's synthesized `Decodable` throws on a
  missing key or an unknown enum value, and that fails the *whole* response
  (a bad field in one workout fails `/bootstrap`). So:
  - A field the API may omit or send as `null` must be optional (`T?`) in Swift.
    `var x: T = default` does **not** make it optional — it is still required.
  - An enum for a field the server doesn't fully control (Stripe statuses, anything
    web types as plain `string`) needs an `init(from:)` that falls back to an
    `.unknown` case. The parity check accepts such an enum as tolerant.
- **Server rules still apply.** The medical consent gate, the `model` and
  `disclosure` fields on health replies, and the "no health data in local
  storage" rule in CLAUDE.md apply to iOS exactly as to web (on iOS: nothing
  medical in `LocalStore`/`UserDefaults`).
- **Swift can't be compiled on this Windows machine.** Keep Swift edits
  conservative: match existing patterns, update every `switch` over an enum you
  extend, and say plainly in your summary that the Swift is uncompiled and needs
  an Xcode build (or iOS CI) before it's trusted.

## 4. Record it

- Ported something recorded in `parity.json`? Delete its entry. `npm run parity`
  fails on stale entries, so it tells you which ones.
- Deliberately not porting? Add it under `<platform>.skip` with the reason, or
  under `<platform>.pending` if it should be done later. Detected gaps use the id
  the check prints (`GET /api/x`, `enum Feature: x`, `field Struct.key`); for
  anything else use `ui: …` or `logic: …`.

## 5. Verify

```bash
npm run parity
npm test --workspace=web
```

Then summarise: what was ported, what was recorded instead (and why), and what
still needs an Xcode build.
