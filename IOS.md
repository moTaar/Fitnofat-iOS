# Fitnofat for iPhone

The iOS app is the same Fitnofat app you already have — every screen, the AI
coach, nutrition, the medical desk, the rep counter, history and analytics —
running as a native iPhone app. Three things are different from the web
version:

1. **It talks to Supabase directly.** Signing in, loading your data, saving a
   workout, editing a routine, the health record: all of it goes phone ⇄
   Supabase. The hosted API is no longer in the middle of every tap.
2. **Your data lives on the phone.** The whole training archive, routines,
   programs, nutrition plan and today's checklist are kept in files inside the
   app (no 5 MB browser limit, not evictable), so the app opens and works fully
   offline and only syncs changes.
3. **Notifications.** Rest-timer alerts, training-day reminders and a weekly
   health check-in — scheduled on the phone itself, no push server needed.

```
                   ┌───────────────────────────────┐
                   │  iPhone app                    │
                   │  • all training data on device │
                   │  • local notifications         │
                   └──┬─────────────┬────────────┬──┘
     auth + all your  │             │ AI only    │ sign-up, billing,
     own rows (RLS)   │             │            │ email/password, delete
                      ▼             ▼            ▼
               ┌───────────┐  ┌───────────┐  ┌────────────┐
               │ Supabase  │◀─│ server/   │  │ accounts/  │──▶ Stripe
               │ Postgres  │  │ Gemini,   │  │            │
               │ + Auth    │◀─┤ YouTube   │  └────────────┘
               └───────────┘  └───────────┘
```

## What still needs hosting, and why

| Piece | Still needed? | Why it can't live on the phone |
| --- | --- | --- |
| Supabase | **Yes** — it's the database | Source of truth + sync between devices |
| `server/` (data API) | **Only for AI features** | Holds the Gemini and YouTube keys, the shared AI caches and the per-user AI quota. A key in the app can be pulled out of it by anyone who has the app. |
| `accounts/` | **Only for sign-up, billing, email/password change, account deletion** | These need the Supabase service-role key or the Stripe secret key. |
| `web/` static site | Optional | Only needed if you also use the browser version. Render static sites are free. |

With the app, the two services only wake up for AI requests and the rare
account action, so they can stay on Render's free plan. When they're asleep
or unreachable the app still signs in, shows everything, logs workouts and
syncs — only the AI features wait.

## What stays off the phone

**Your health record is never saved on the device.** The Medical tab loads it
from Supabase each session and forgets it when you sign out, exactly as the
web app does. Your medical history has no business in a file that outlives a
sign-out, and the notification for the weekly check-in never names a
condition (lock screens are public).

The medical AI rules are unchanged: nothing reaches the model until you turn
on AI health analysis, the check is done by the server, and the model only
ever gets the privacy layer's brief — never the record.

---

## One-time setup

### 1. Supabase

In the Supabase **SQL editor**, run
[`supabase/migrations/native_client_access.sql`](supabase/migrations/native_client_access.sql).

This is required, not optional. Before, only the services could reach the
database, so the table policies were a second line of defence. Now the app
connects directly, so they are the access control. The migration:

- makes `subscriptions` **read-only** for users (the old policy would have let
  anyone set their own plan to `pro`);
- moves the health-record rules into the database: editing a do & don't rule
  always marks it as yours (so the AI never rewrites it), and resolving or
  reopening an issue always stamps the date and logs it on the timeline.

`web/src/lib/rls.test.ts` runs the whole schema in an embedded Postgres and
checks all of this.

Then, in **Authentication → URL Configuration → Redirect URLs**, add:

```
fitnofat://reset-password
```

That's what makes the "forgot password" email open the app.

> **Setting up a brand-new Supabase project?** Run `supabase/schema.sql`, then
> the files in `supabase/migrations/` in filename order — except run
> `add_medical.sql` *before* `add_health_rules.sql` (the rules table
> references the issues table).

### 2. The services

If `server/` and `accounts/` are already deployed (Render, Railway…), nothing
to change: the app's origin (`capacitor://localhost`) is allowed by CORS in
code. Redeploy `server/` from this repo when convenient — it adds
`GET /api/health/ai`, which the app uses to show which model answers the
medical desk (older servers still work; the app falls back).

### 3. The app's settings

```bash
cp web/.env.example web/.env
```

and fill in:

| Variable | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `VITE_API_URL` | Your deployed `server/`, e.g. `https://fitnofat-api.onrender.com` |
| `VITE_ACCOUNTS_URL` | Your deployed `accounts/`, e.g. `https://fitnofat-accounts.onrender.com` |

The anon key is designed to be public — it can only do what row-level
security allows a signed-in user to do to their own rows. **Never** put the
`service_role` key, the Gemini key or the Stripe key in `web/.env`.

---

## Installing on your iPhone

Apple only lets apps onto an iPhone through Xcode (which needs a Mac) or
TestFlight/the App Store (which needs a paid developer account). Pick one:

### Option A — with a Mac (free)

You need a Mac with **Xcode 26 or newer** (free, Mac App Store) and
**Node.js 22** (`brew install node@22` or nodejs.org).

```bash
git clone <this repo>
cd <repo>
npm ci                      # installs everything (npm workspaces)
cd web
cp .env.example .env        # then fill it in — see step 3 above
npm run ios:sync            # builds the app and copies it into the Xcode project
npm run ios:open            # opens Xcode
```

In Xcode:

1. Select the **App** project in the left sidebar → **App** target →
   **Signing & Capabilities**.
2. **Team**: choose your Apple ID (Xcode → Settings → Accounts → **+** to add it
   first). A free Apple ID works.
3. If Xcode says the bundle identifier `com.fitnofat.app` isn't available,
   change it to something unique, e.g. `com.yourname.fitnofat` (and change
   `appId` in `web/capacitor.config.ts` to match).
4. Plug in your iPhone, pick it at the top of the Xcode window, press **▶ Run**.

First time only, on the iPhone:

- **Settings → Privacy & Security → Developer Mode → On** (it restarts).
- After the first install: **Settings → General → VPN & Device Management** →
  your Apple ID → **Trust**.

With a **free** Apple ID the app stops opening after **7 days** — plug in and
press Run again (your data is kept; it's on the phone and in Supabase). A paid
Apple Developer account ($99/year) extends that to a year.

### Option B — without a Mac (TestFlight, paid account)

GitHub builds, signs and uploads the app for you; you install it with the
TestFlight app. Needs an **Apple Developer Program** membership ($99/year).

One-time:

1. [developer.apple.com](https://developer.apple.com/account) → **Identifiers**
   → **+** → App IDs → App → bundle ID `com.fitnofat.app` (or your own — then
   also set the `APP_BUNDLE_ID` variable below). No extra capabilities are
   needed: the app only uses local notifications, not push.
2. [App Store Connect](https://appstoreconnect.apple.com) → **Apps → +** → New
   App → iOS, pick that bundle ID, any name/SKU.
3. App Store Connect → **Users and Access → Integrations → App Store Connect
   API** → **+** → role **Admin** → download the `AuthKey_XXXX.p8` (only
   downloadable once). Note the **Key ID** and the **Issuer ID**.
4. In this GitHub repo → **Settings → Secrets and variables → Actions**:
   - Secrets: `APPLE_TEAM_ID` (developer.apple.com → Membership),
     `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` (the output of
     `openssl base64 -A -in AuthKey_XXXX.p8`, run on any computer — don't
     paste the key into a website to encode it).
   - Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`,
     `VITE_ACCOUNTS_URL` (same values as step 3 above), and optionally
     `APP_BUNDLE_ID`.

Each time you want a new build: **Actions → iOS → TestFlight → Run workflow**.
After ~15 minutes (plus Apple's processing) it appears in the **TestFlight**
app on your iPhone. TestFlight builds last 90 days.

---

## Updating the app

After changing code (or pulling changes):

```bash
cd web
npm run ios:sync     # rebuild + copy into Xcode
```

then **Run** again in Xcode (Option A) or re-run the workflow (Option B). The
app has no service worker and no "new version" banner — updates arrive as new
builds.

Changes you'd rather get from the original web repo can be merged in: this
repo shares its history (`git remote add upstream <original repo>`,
`git fetch upstream`, `git merge upstream/main`).

## Notifications

**Settings → Notifications** in the app:

| | What it does |
| --- | --- |
| **Training reminders** | On the weekdays and time you pick (defaults to your training days per week, at 18:00). Names the session that's up next. Skipped automatically on days you've already trained. |
| **Rest timer alert** | When a rest period ends while the app isn't on screen — so the phone can stay in your pocket between sets. |
| **Weekly health check-in** | Sundays at your reminder time. Deliberately generic wording. |

Everything is scheduled on the phone (no server, nothing to host). iOS asks
for permission the first time you turn one on; if you tapped "Don't Allow",
turn it back on in the iPhone's **Settings → Notifications → Fitnofat**.

## Other iPhone specifics

- **Payments** (Pro): Stripe Checkout and the billing portal open in an in-app
  Safari sheet; close it when you're done and the app picks up the new plan.
  (Fine for your own use/TestFlight. The App Store itself would require
  Apple's in-app purchase for subscriptions.)
- **Exercise videos** open in a Safari sheet rather than an embedded player —
  YouTube won't play embeds inside an app's web view.
- **Photos for the AI coach**: the attach button offers the camera or your
  library.
- **Rep counter** uses the motion sensors, as on the web.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Stuck on the login screen with "This build isn't connected to a Supabase project" | `web/.env` is missing `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — fill it in and `npm run ios:sync` again. |
| Signed in but everything is empty | The migration hasn't been run, or you're pointing at a different Supabase project than the services use. |
| AI features say they can't reach the server | `VITE_API_URL` is wrong, or the free Render instance is waking up (give it ~30 s and retry). |
| Password-reset email opens a web page instead of the app | Add `fitnofat://reset-password` to Supabase's Redirect URLs. |
| Xcode: "No such module 'Capacitor'" / package errors | Run `npm ci` at the repo root, then `npm run ios:sync` in `web/`, then **File → Packages → Reset Package Caches**. |
| Xcode: "Failed to register bundle identifier" | Choose a unique bundle ID (step 3 of Option A). |
| App won't open after a week | Free Apple ID signing expired — Run from Xcode again. |
