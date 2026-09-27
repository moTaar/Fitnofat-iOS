# From GitHub to the App Store — step by step

This is the complete path for the iPhone edition: from this repository on
GitHub, to a build running in Xcode, to TestFlight, to a public App Store
listing. [`IOS.md`](../IOS.md) covers only the "get it on my own phone" part.
This guide goes all the way.

Time and cost, roughly:

| Stage | Time | Cost |
| --- | --- | --- |
| 0–3: repo, backend, Mac setup | 1–2 h | free |
| 4–5: first run in Xcode / on your phone | 30 min | free (Apple ID) |
| 6: Apple Developer Program | 1–2 days for approval | **$99 / year** |
| 7–9: App Store Connect, build upload, TestFlight | 2–3 h | included |
| 10–12: App Store compliance work, listing, review | a few days (review is usually 24–48 h) | included |

> ⚠️ **Read stage 10 before you start.** Fitnofat sells Pro through
> Stripe. That's fine for your own install and for TestFlight, but the App
> Store does not allow it for digital subscriptions: Apple will reject the
> app until Pro goes through Apple's in-app purchase, or until the Pro
> purchase is removed from the iOS app. That is real code work. Plan for it.

---

## Stage 0 — Get the code into its own GitHub repository

1. On GitHub: **New repository** → name `Fitnofat-iOS` → **Private** → do
   **not** add a README, .gitignore or license (the repo must be empty).
2. On your computer:
   ```bash
   git clone https://github.com/moTaar/Fitness.git Fitnofat-iOS
   cd Fitnofat-iOS
   git pull /path/to/Fitnofat-iOS.bundle main        # the bundle from Claude
   git remote set-url origin https://github.com/moTaar/Fitnofat-iOS.git
   git remote add upstream https://github.com/moTaar/Fitness.git
   git push -u origin main
   ```
   (If the repo was already pushed for you, just `git clone` it instead.)
3. Check on GitHub → **Actions**: `CI` should go green. `iOS build` also runs
   and compiles the Xcode project on a Mac runner. That's your first proof
   the native project builds, even before you own a Mac.

Later, to pull in changes from the web repo: `git fetch upstream && git merge upstream/main`.

## Stage 1 — Backend ready for the app

Do this once, in the Supabase project the services already use.

1. **SQL editor** → paste and run `supabase/migrations/native_client_access.sql`.
   The app talks to the database directly, so this is required (it locks
   down subscriptions and enforces the health-record rules).
2. **Authentication → URL Configuration → Redirect URLs** → add
   `fitnofat://reset-password`.
3. **Authentication → Providers → Email**: keep "Confirm email" as you like.
   Sign-up goes through the accounts service, which creates users
   pre-confirmed either way.
4. Services (`server/`, `accounts/`) on Render: redeploy from this repo so
   the server has `GET /api/health/ai`. No CORS change is needed, because the
   app's origin `capacitor://localhost` is allowed in code.
5. For App Store review the services must be **awake and reachable**. A
   reviewer who waits 50 s for a free Render instance to boot may reject for
   "app doesn't load". During review, either use a paid instance ($7/mo) or
   ping `/health` every 10 minutes (e.g. a free cron-job.org job).

## Stage 2 — The Mac

You need a Mac to build locally and for the first-run debugging. (Stage 8B
shows how to upload builds without one.)

1. macOS 15 or newer.
2. **Xcode 26+** from the Mac App Store. Open it once, accept the licence,
   and let it install the iOS platform (Xcode → Settings → Components → iOS).
3. Command-line tools: `xcode-select --install`.
4. Node.js 22: `brew install node@22` (install [Homebrew](https://brew.sh)
   first), or the installer from nodejs.org.
5. Git: comes with the command-line tools.

Mac too old for macOS 15 (for example a 2015 MacBook Air, which stops at
Monterey and Xcode 14)? You can still run the app on your iPhone and in that
Mac's Simulator: see [IOS.md → Option C](../IOS.md#option-c--an-older-mac-or-windows-free).
Uploading to the App Store then goes through Stage 8B, which needs no Mac.

## Stage 3 — Build the app bundle

```bash
git clone https://github.com/moTaar/Fitnofat-iOS.git
cd Fitnofat-iOS
npm ci                        # installs all packages (workspaces)
cd web
cp .env.example .env
```

Edit `web/.env`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_API_URL=https://<your-api>.onrender.com
VITE_ACCOUNTS_URL=https://<your-accounts>.onrender.com
VITE_APP_URL_SCHEME=fitnofat
```

Only the **anon** key goes here. Never the service-role, Gemini or Stripe
keys: everything in this file ends up inside the app, where anyone can
extract it.

```bash
npm run ios:sync      # web build (iOS mode) + copy into web/ios + native plugin setup
npm run ios:open      # opens web/ios/App/App.xcodeproj in Xcode
```

Run `npm run ios:sync` again after **every** code or `.env` change.

## Stage 4 — First run in the Simulator

1. In Xcode's toolbar pick the **App** scheme and an iPhone simulator
   (e.g. iPhone 17).
2. Press **▶ (Cmd-R)**. The first build downloads Swift packages and takes a
   few minutes.
3. Sign in and click through all the tabs. Notifications and the motion rep
   counter need a real device.

If the build fails with package errors: **File → Packages → Reset Package
Caches**, then run `npm run ios:sync` again.

## Stage 5 — Run on your own iPhone (free)

1. Xcode → **Settings → Accounts → +** → Apple ID → sign in.
2. Project navigator → **App** (blue icon) → target **App** → **Signing &
   Capabilities**:
   - ✅ Automatically manage signing
   - **Team**: your name (Personal Team)
   - **Bundle Identifier**: change `com.fitnofat.app` to something only you
     own, e.g. `com.<yourname>.fitnofat`. Set the same value as `appId` in
     `web/capacitor.config.ts`, then `npm run ios:sync`. The bundle ID is
     permanent once the app is in the App Store, so pick it now.
3. Connect the iPhone by cable (or the same Wi-Fi after the first pairing),
   unlock it, and tap **Trust this computer**.
4. iPhone: **Settings → Privacy & Security → Developer Mode → On** (restarts).
5. Pick the iPhone in Xcode's device menu → **▶**.
6. If the app won't open ("Untrusted Developer"): **Settings → General → VPN &
   Device Management** → your Apple ID → **Trust**.

With a free team the install expires after 7 days. Re-run from Xcode to
renew it.

## Stage 6 — Join the Apple Developer Program

Required for TestFlight and the App Store.

1. [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll)
   → sign in with the Apple ID you'll publish under.
2. Individual (your own name on the store) or Organization (needs a D-U-N-S
   number, which takes days to weeks to get).
3. Pay $99. Approval usually takes 24–48 h.
4. After approval, in Xcode → Settings → Accounts, your team shows
   "Apple Developer Program". In **Signing & Capabilities** switch **Team**
   to it.
5. Also accept the **Paid Apps agreement** in App Store Connect → Business
   (needed later if you ever sell in-app purchases), and fill in tax and
   banking details.

## Stage 7 — Register the app

1. [developer.apple.com/account](https://developer.apple.com/account) →
   **Certificates, IDs & Profiles → Identifiers → +** → App IDs → App →
   - Description: Fitnofat
   - Bundle ID: **Explicit**, the one you chose in stage 5
   - Capabilities: none needed. Local notifications need no capability;
     tick **In-App Purchase** if you're doing stage 10 option A.
2. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps →
   + → New App**:
   - Platform iOS · Name (unique on the store, e.g. "Fitnofat: AI Training
     Coach") · primary language · the bundle ID · SKU `fitnofat-ios` · Full
     access.

## Stage 8 — Upload a build

Every upload needs a **higher build number** than the last one. The
version (e.g. 1.0.0) is what users see; the build number (1, 2, 3…) only has
to go up. Both are in Xcode → target App → **General → Identity**.

### 8A — From Xcode on your Mac

1. Device menu → **Any iOS Device (arm64)**.
2. Bump **Build** (General → Identity).
3. **Product → Archive**. When it finishes, the **Organizer** opens.
4. Select the archive → **Distribute App → App Store Connect → Upload** →
   leave the defaults (automatic signing, upload symbols) → **Upload**.
5. Export compliance: the app declares `ITSAppUsesNonExemptEncryption = NO`
   in Info.plist (it only uses HTTPS), so App Store Connect won't ask.

### 8B — From GitHub, no Mac needed

The workflow `.github/workflows/ios-testflight.yml` does the archive and
upload on a GitHub macOS runner.

1. App Store Connect → **Users and Access → Integrations → App Store Connect
   API → +** → name "GitHub", access **Admin** → **Generate** → download
   `AuthKey_XXXXXX.p8` (you only get one chance). Note the **Key ID** and the
   **Issuer ID** at the top of the page.
2. Base64 the key on your own computer:
   `openssl base64 -A -in AuthKey_XXXXXX.p8`
3. GitHub repo → **Settings → Secrets and variables → Actions**:
   - **Secrets**: `APPLE_TEAM_ID` (developer.apple.com → Membership details),
     `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`
   - **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
     `VITE_API_URL`, `VITE_ACCOUNTS_URL`, `APP_BUNDLE_ID` (your bundle ID)
4. **Actions → "iOS → TestFlight" → Run workflow**. The build number is
   the workflow's run number, so it always goes up.

macOS runner minutes count ×10 against a private repo's free allowance
(2,000 min/month → about 200 macOS minutes, roughly 8–10 builds).

## Stage 9 — TestFlight

1. After upload, App Store Connect → your app → **TestFlight**. The build
   shows "Processing" for 5–30 min.
2. **Internal testing** (you and up to 100 team members, no review): create
   a group, add yourself, add the build.
3. On the iPhone install **TestFlight** from the App Store and accept the
   invite. The app installs like a normal app and lasts 90 days per build.
4. **External testing** (up to 10,000 people via email or public link) needs
   a quick Beta App Review of the first build, which is lighter than full
   review.

Test everything on real hardware at this stage: sign-up, login, a full
workout with the phone locked during rest (rest alert), training reminders,
reset password from the email, the AI coach, the Medical tab, offline mode
(airplane mode → log a workout → back online → it syncs).

## Stage 10 — Make it App Store compliant

TestFlight is lenient. App Review is not. These items are specific to
Fitnofat.

### 10.1 Payments (guideline 3.1.1) — blocking

Pro unlocks digital features inside the app, so on iOS it must be sold with
**Apple In-App Purchase**. Linking to or mentioning an outside payment
(Stripe Checkout, the billing portal) is also not allowed, apart from the
narrow exceptions Apple lists. Two routes:

- **A. Sell Pro with IAP.** Create an auto-renewable subscription in App
  Store Connect (Features → Subscriptions). Add an IAP plugin (e.g.
  RevenueCat's Capacitor SDK, or `@capgo/native-purchases`), and have a
  server endpoint verify the App Store receipt or App Store Server
  Notifications and write `subscriptions.plan = 'pro'` with the service role.
  That is the same table Stripe writes, so the rest of the app just works.
  Apple takes 15% (Small Business Program) or 30%.
- **B. Don't sell on iOS.** Hide the Billing screen and every "Upgrade"
  button when `isNative()` is true. Users who subscribed on the web still
  get Pro in the app, because entitlements come from the same
  `subscriptions` row. That is allowed as long as the app neither links to
  nor mentions the outside purchase.

B is a small change. A is the path if you want iOS revenue.

### 10.2 Account deletion (5.1.1(v)) — already done

Settings → Delete account removes the account in-app. Make sure it works
against production before submitting.

### 10.3 Health and medical content (1.4.1, 5.1.3)

- The medical desk must not present itself as diagnosing or treating. The
  app already shows a disclaimer and escalates red flags, so keep those
  visible and mention them in the review notes.
- Health data may not be used for advertising and must not be shared with
  third parties without consent. The AI consent switch and the "what was
  sent" disclosure are exactly what reviewers look for. Point to them.
- You do **not** use HealthKit, so no HealthKit entitlement or wording is
  needed.

### 10.4 AI-generated content

Say in the review notes that coaching and plans are generated by an AI
model (Google Gemini). User data sent to a third-party AI must be disclosed
in the privacy policy and consented to in-app. The medical desk has
explicit consent. Add one line near the coach chat, or in onboarding,
saying chat messages are processed by Google Gemini.

### 10.5 Privacy policy and support URL — required

You need two public web pages (free on GitHub Pages, Notion or Google Sites):

- **Privacy policy**: what you collect (email, training data, optional
  health data, photos you attach), where it's stored (Supabase), who
  processes it (Supabase, Render, Google Gemini, Stripe or Apple, YouTube for
  video search), retention, deletion (in-app delete account), and contact.
- **Support page**: an email address is enough.

### 10.6 Sign-in

Email and password alone is fine. (Sign in with Apple is only required if
you add Google or Facebook login.)

### 10.7 Minimum functionality (4.2)

Apple rejects "just a website in a wrapper". Fitnofat is fine here:
offline use, local notifications, haptics, motion sensors. Mention those
native features in the review notes.

## Stage 11 — The store listing

App Store Connect → your app → the **1.0 Prepare for Submission** page.

1. **Screenshots** (required): 6.9" iPhone at 1320 × 2868 (or 1290 × 2796).
   Apple scales these down for smaller phones. Take them in the iPhone 17
   Pro Max simulator with **Cmd-S**: dashboard, active workout, AI coach,
   nutrition, history charts, medical tab. 3–10 images.
2. **Promotional text**, **Description**, **Keywords** (100 characters,
   comma-separated: `workout,gym,ai coach,fitness,nutrition,macros,training log`),
   **Support URL**, **Marketing URL** (optional).
3. **App icon**: taken from the build (1024 × 1024, already in the project).
4. **Category**: Health & Fitness (primary), Lifestyle (secondary).
5. **Age rating** questionnaire: select "Medical/Treatment Information:
   Infrequent/Mild". This usually gives 12+ or 17+ depending on answers.
6. **App Privacy** ("nutrition label"): declare Contact Info (email),
   Health & Fitness (fitness and health data), User Content (photos, chat),
   Identifiers (user ID). All "Linked to user", "App Functionality", and
   **not** used for tracking.
7. **Pricing and Availability**: Free (with IAP if you did 10.1 A),
   countries.
8. **App Review Information**:
   - **Demo account**: create a test user with a finished onboarding, a few
     workouts and **Pro enabled** (set `subscriptions.plan='pro',
     status='active'` for that user in SQL). Give the reviewer its email and
     password.
   - **Notes**: "Fitness tracker with AI coaching (Google Gemini). The
     Medical tab is general wellness guidance with disclaimers and
     emergency escalation; AI analysis of health data is opt-in and shows
     what was shared. Native features: offline logging, local notifications
     for rest timer and training days, motion-sensor rep counting, haptics."
9. **Build**: click **+** and select the TestFlight build you tested.

## Stage 12 — Submit, review and release

1. **Add for Review → Submit**.
2. Typical review time is 24–48 h. Keep the backend awake (stage 1.5).
3. **Rejected?** The message in Resolution Center cites the guideline.
   Fix it, bump the build number, upload, reply in Resolution Center and
   resubmit. The most likely reasons for this app: 3.1.1 (payments), 1.4.1
   (medical claims), 2.1 (crash or server not reachable), 5.1.1 (privacy
   policy incomplete).
4. **Approved** → release manually or automatically. Phased release (over 7
   days) is a good safety net.

## Updating the app afterwards

1. Change the code, then `cd web && npm run ios:sync`.
2. Bump **Version** (for user-visible releases) and always **Build**.
3. Archive and upload (8A) or run the workflow (8B), check it in
   TestFlight, then create a new version in App Store Connect → select the
   build → submit.

Backend-only changes (server, database, AI prompts) need no new app
release. Changes under `web/` do, because the web code is bundled inside the
app.

## Quick checklist

- [ ] Repo on GitHub, `CI` and `iOS build` green
- [ ] `native_client_access.sql` run · redirect URL added · services redeployed
- [ ] Unique bundle ID set in Xcode **and** `capacitor.config.ts`
- [ ] Runs on your iPhone from Xcode
- [ ] Apple Developer Program active · App ID · App Store Connect record
- [ ] Build uploaded, tested in TestFlight on a real device
- [ ] Payments handled for iOS (10.1 A or B)
- [ ] Privacy policy + support URL live · Gemini disclosure in-app
- [ ] Screenshots · description · privacy label · age rating
- [ ] Demo Pro account + review notes · backend kept awake
- [ ] Submitted
