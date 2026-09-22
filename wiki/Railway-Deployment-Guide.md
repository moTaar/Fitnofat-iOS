# Deploying Fitnofat to Railway (with Supabase)

This guide walks through hosting the **entire Fitnofat app** on
[Railway](https://railway.app), with [Supabase](https://supabase.com) as the
Postgres database + auth provider. Follow the steps in order — later steps
depend on URLs created in earlier ones.

> Fitnofat was originally set up for Render (see `render.yaml`). This guide
> is the Railway equivalent — same four services, same Supabase backend, just
> configured through Railway's dashboard instead of a blueprint file.

## 1. What you're deploying

Fitnofat is a **monorepo with four deployable pieces**, all pointing at one
shared Supabase project:

| Folder | What it is | Type |
| --- | --- | --- |
| `server/` | Main API (workouts, programs, nutrition, AI coach) | Node/Express — needs a running process |
| `accounts/` | Auth + billing microservice (signup/login, Stripe) | Node/Express — needs a running process |
| `web/` | The PWA users actually use | Static React build |
| `admin/` | Internal admin panel | Static React build |

```
                     HTTPS/JWT                 service-role key
  web/ (PWA)  ─────────────────────▶  server/  ─────────────────▶  Supabase
     │                                    │                        (Postgres
     │            HTTPS                   ▼                         + Auth)
     └───────────────────────▶  accounts/ (auth, billing) ─────────────▲
                                           │                            │
                                           ▼                            │
                                        Stripe               admin/ ────┘
                                                          (talks to accounts)
```

The browser never talks to Supabase, Gemini, or Stripe directly — `server/`
and `accounts/` are the only pieces holding secret keys.

You'll create **one Railway project** with **four services** inside it, plus
**one Supabase project**. Total: 5 dashboards, but only two of them need real
configuration effort (server + accounts) — the two static sites are copy/paste.

**Not covered here:** the `ios/` folder (a Capacitor native shell) — that's an
App Store submission, not something you host.

---

## 2. Prerequisites

- The repo pushed to GitHub (Railway deploys from a GitHub repo).
- A [Railway](https://railway.app) account (sign in with GitHub).
- A [Supabase](https://supabase.com) account.
- Optional: a [Google AI Studio](https://aistudio.google.com/) Gemini API key
  (the app works without one — it falls back to a built-in local program
  generator — but AI coaching/generation needs it).
- Optional: a [Stripe](https://stripe.com) account, only if you want billing
  (`accounts/`) to actually charge people. Without Stripe keys the accounts
  service still runs — signup/login work, billing routes just error.

---

## 3. Set up Supabase (the database)

1. Go to [supabase.com](https://supabase.com) → **New project**.
   - Pick any name/region. Save the database password somewhere — you won't
     need it directly, but keep it.
   - Wait ~2 minutes for provisioning.
2. Open the **SQL Editor** (left sidebar) → **New query**.
3. Paste in the contents of [`supabase/schema.sql`](../supabase/schema.sql)
   and run it. This creates all base tables and RLS policies.
4. Run each file in [`supabase/migrations/`](../supabase/migrations) as a
   **separate query**, in this order (they're incremental patches on top of
   the base schema):
   ```
   add_equipment_mix.sql
   add_exercise_guide.sql
   add_exercise_met.sql
   add_profile_category.sql
   add_profile_cuisine.sql
   add_subscriptions.sql
   add_workout_calories.sql
   add_equipment_prefs.sql
   ```
5. Go to **Project Settings → API**. You'll need three values repeatedly in
   the steps below — copy them somewhere handy:
   - **Project URL** → `SUPABASE_URL`
   - **`anon` `public` key** → `SUPABASE_ANON_KEY`
   - **`service_role` key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ secret — this
     bypasses Row Level Security; it only ever goes into the two backend
     services, never into `web/` or `admin/`)
6. (Optional, recommended) Under **Authentication → Providers → Email**,
   turn **off** "Confirm email" for a smoother signup flow — Fitnofat's API
   auto-confirms users on signup either way, but this keeps Supabase's own
   settings consistent with that.
7. **Required for "Forgot password" to work**: under **Authentication → URL
   Configuration → Redirect URLs**, add your `web/` domain's reset page,
   e.g. `https://<your-web-domain>/reset-password` (and
   `http://localhost:5173/reset-password` if you also test locally).
   Supabase refuses to send a recovery link to any URL not on this allowlist.
   You won't have the real Railway domain yet at this point in the guide —
   come back and add it once step 7 gives you the `web/` domain (this is the
   same "wire it up after the fact" pattern as `CORS_ORIGIN` in step 9).

---

## 4. Create the Railway project

1. Go to [railway.app/new](https://railway.app/new) → **Deploy from GitHub repo**.
2. Authorize Railway to access your GitHub account if prompted, then pick
   your Fitnofat repo.
3. Railway will try to auto-detect and deploy one service from the repo
   root — **it will fail to build**, because the repo root has its own
   `package.json` with an npm `workspaces` field (`server` + `web`), and
   Railway's builder can't tell which app to run from there. That's
   expected — don't debug it, just give it a Root Directory in the next
   step (or delete it and add services manually with **+ New → GitHub
   Repo**, same repo, four times, one per folder).

You want to end up with **4 services** in this one project, each pointed at
a different subfolder of the same repo. The subfolder is set via **Root
Directory** in each service's **Settings → Source** tab — set this on every
service *before* its first deploy, otherwise the build reads the repo root
instead of the app folder and fails with a `No start command detected`
error (see Troubleshooting).

---

## 5. Deploy the API (`server/`)

1. In the Railway project, add a service from the repo (or reuse the
   auto-created one) → open its **Settings** tab.
2. **Root Directory**: `server`
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm start`
5. **Networking → Generate Domain** — this gives you a public URL like
   `fitnofat-api-production.up.railway.app`. Note it down; you'll need it in
   step 8.
6. **Settings → Healthcheck Path**: `/health`
7. Go to the **Variables** tab and add:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | from step 3.5 |
   | `SUPABASE_ANON_KEY` | from step 3.5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 3.5 |
   | `GEMINI_API_KEY` | your Gemini key (leave blank to skip AI) |
   | `GEMINI_MODEL` | `gemini-3.6-flash` (optional, this is the default — check [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) for the current model name if generation starts failing with a 404) |
   | `CORS_ORIGIN` | *placeholder for now, e.g. `http://localhost:5173`* |

   > Don't set `PORT` — Railway injects it automatically and the app already
   > reads `process.env.PORT`.

   The AI nutritionist + medical helper needs nothing extra here: with only
   `GEMINI_API_KEY` set it runs on Gemini. To point it at a medical-tuned model
   instead, see
   [MedGemma on Cloud Run](MedGemma-Cloud-Run-Deployment.md) and add the
   `MEDICAL_AI_*` variables from step 15.

   You'll come back and fix `CORS_ORIGIN` to the real web app URL in step 8,
   once that URL exists.
8. Deploy (Railway auto-deploys on the first save, and on every future
   `git push` to this branch). Once it's live, open
   `https://<your-api-domain>/health` in a browser — you should see
   `{"ok":true,...}`.

---

## 6. Deploy the accounts service (`accounts/`)

Same pattern as the API, in a second service.

1. **+ New → GitHub Repo** → same repo.
2. **Root Directory**: `accounts`
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm start`
5. **Networking → Generate Domain** — note this URL down too (e.g.
   `fitnofat-accounts-production.up.railway.app`).
6. **Settings → Healthcheck Path**: `/health`
7. **Variables**:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | same as step 5 |
   | `SUPABASE_ANON_KEY` | same as step 5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | same as step 5 |
   | `CORS_ORIGIN` | *placeholder for now* |
   | `APP_URL` | *placeholder for now* — where Stripe redirects back to after checkout |
   | `STRIPE_SECRET_KEY` | from Stripe Dashboard → Developers → API keys (skip if not using billing) |
   | `STRIPE_WEBHOOK_SECRET` | see step 9 below |
   | `STRIPE_PRICE_PRO` | the Price ID of your "Pro" recurring price in Stripe |
   | `ADMIN_API_KEY` | any long random string — gates `/admin/*` routes. Generate one: |

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
8. Deploy, then check `https://<your-accounts-domain>/health`.

---

## 7. Deploy the frontend PWA (`web/`)

Railway doesn't have a dedicated "static site" product the way Render does —
static builds are served by running a tiny static file server inside the
container. `web/package.json` already has this wired up: `serve` is a real
dependency and `npm start` runs `serve -s dist`, with SPA fallback (so
client-side routes like `/history` resolve correctly) — no `npx` fetch at
deploy time, and no custom Railway start command needed.

1. **+ New → GitHub Repo** → same repo.
2. **Root Directory**: `web`
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm start`

   - `-s` (baked into the `start` script) = single-page-app mode: unmatched
     paths fall back to `index.html`, same as the `rewrite /* → /index.html`
     rule in `render.yaml`.
   - `serve` automatically listens on `$PORT` when no `-l` flag is given —
     Railway injects `PORT`, so this needs no further setup.
5. **Networking → Generate Domain** — this is the real app URL your users
   will visit, e.g. `fitnofat-web-production.up.railway.app`.
6. **Variables**:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | the `server/` domain from step 5 (e.g. `https://fitnofat-api-production.up.railway.app`) |
   | `VITE_ACCOUNTS_URL` | the `accounts/` domain from step 6 |

   > These are **build-time** variables (Vite bakes them into the JS bundle),
   > so set them *before* the first deploy if possible. If you add/change
   > them later, trigger a redeploy — a variable change alone won't rebuild
   > the static bundle.
7. Deploy, then open the web domain in a browser and confirm the app loads
   (it'll show a network error on login until step 8 is done).

### Optional: correct cache headers for the service worker

`render.yaml` sets `Cache-Control: no-cache` on `/sw.js` and
`/manifest.webmanifest` so browsers always fetch the latest service worker.
To replicate this with `serve`, add a `serve.json` file to `web/public/`
(Vite copies everything in `public/` into `dist/` on build, so it ships
automatically):

```json
{
  "headers": [
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    }
  ]
}
```

This is a nice-to-have, not a blocker — skip it and redeploy later if you
want to keep the first pass simple.

---

## 8. Deploy the admin panel (`admin/`)

Same static-site pattern as `web/`.

1. **+ New → GitHub Repo** → same repo.
2. **Root Directory**: `admin`
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm start` (also runs `serve -s dist`, same as `web/`)
5. **Networking → Generate Domain**.
6. **Variables**:

   | Variable | Value |
   | --- | --- |
   | `VITE_ACCOUNTS_URL` | the `accounts/` domain from step 6 |

7. Deploy.

The admin panel calls the accounts service's `/admin/*` routes, gated by the
`ADMIN_API_KEY` you set in step 6 — it'll prompt for that key on first use.

---

## 9. Wire the URLs together (do this after all 4 domains exist)
VITE_API_URL="https://fitnofat-api-production-b74d.up.railway.app"
VITE_ACCOUNTS_URL="https://fitnofat-accounts-production.up.railway.app"
admin= https://fitnofat-admin-production.up.railway.app
web=https://fitnofat-web-production.up.railway.app
origin= https://fitnofat-api-production-b74d.up.railway.app,https://fitnofat-accounts-production.up.railway.app,https://fitnofat-admin-production.up.railway.app,https://fitnofat-web-production.up.railway.app
Now that every service has a real Railway domain, go back and fix the
placeholder variables:

1. **`server/` service → Variables**:
   - `CORS_ORIGIN` = your `web/` domain, e.g.
     `https://fitnofat-web-production.up.railway.app`
     (comma-separate multiple origins if you also test locally, e.g.
     `https://fitnofat-web-production.up.railway.app,http://localhost:5173`)
2. **`accounts/` service → Variables**:
   - `CORS_ORIGIN` = same as above (add the `admin/` domain too, since admin
     also calls this service — comma-separated)
   - `APP_URL` = your `web/` domain (Stripe checkout/portal redirects here,
     **and** it's where "forgot password" reset links point)
3. **Supabase → Authentication → URL Configuration → Redirect Urls**: add
   `https://<your-web-domain>/reset-password` now that you have the real
   domain (see step 3.7) — without this, Supabase silently refuses to send
   password-reset emails.
4. Saving a variable triggers an automatic redeploy of that service — no
   manual restart needed.
5. Re-check `web/`'s `VITE_API_URL` / `VITE_ACCOUNTS_URL` and `admin/`'s
   `VITE_ACCOUNTS_URL` actually point at the final domains from steps 5–6
   (not the placeholders you might have started with). If you change them,
   manually trigger a redeploy of `web`/`admin` (**Deployments → ⋮ →
   Redeploy**) since Vite only reads env vars at build time.

---

## 10. Set up the Stripe webhook (only if using billing)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<your-accounts-domain>/webhooks/stripe`
3. Select events: at minimum `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
4. Copy the **Signing secret** (`whsec_...`) it gives you → set it as
   `STRIPE_WEBHOOK_SECRET` on the `accounts/` service in Railway → redeploy.

No special Railway configuration is needed for the raw-body signature check
— `accounts/src/index.ts` already registers that route with `express.raw()`
before the JSON body parser, so it works identically on any host.

---

## 11. Verify everything end-to-end

1. `https://<server-domain>/health` → `{"ok": true, ...}`
2. `https://<accounts-domain>/health` → `{"ok": true, "service": "accounts", ...}`
3. Open the `web/` domain → sign up a test account → confirm you land on the
   dashboard (proves web ↔ accounts ↔ Supabase auth all work).
4. Generate an AI program (or use the local fallback if no Gemini key) →
   confirms web ↔ server ↔ Supabase.
5. If using billing: start a checkout from the web app, complete it with a
   [Stripe test card](https://stripe.com/docs/testing) (`4242 4242 4242 4242`),
   and confirm the subscription shows as active (proves the webhook is wired
   correctly).
6. Open the `admin/` domain, enter your `ADMIN_API_KEY`, confirm it loads data.

---

## 12. Custom domains (optional)

For any of the four services: **Settings → Networking → Custom Domain**,
add your domain, then create the CNAME record Railway shows you at your DNS
provider. If you put a custom domain on `web/` or `accounts/`, remember to
update `CORS_ORIGIN` / `APP_URL` / `VITE_API_URL` / `VITE_ACCOUNTS_URL`
everywhere they're referenced (step 9) and redeploy.

---

## 13. Redeploys and ongoing changes

- Railway auto-deploys every service on every push to the connected branch
  (each service only rebuilds when files under its **Root Directory**
  change, so a `web/` commit won't rebuild `server/`).
- Database schema changes: write a new file in `supabase/migrations/`, run
  it manually in the Supabase SQL Editor (there's no auto-migration runner
  wired up here — the migrations folder is just an ordered history you apply
  by hand).
- Changing a `VITE_*` variable on `web/`/`admin/` requires a manual redeploy
  (build-time only, see step 7's note).

---

## 14. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Web app shows a network/CORS error on login | `CORS_ORIGIN` on `accounts/` (and `server/`) doesn't exactly match the web domain — check for a trailing slash or `http` vs `https` mismatch |
| `/health` returns but signup fails with a 500 | `SUPABASE_SERVICE_ROLE_KEY` missing/wrong on `server/` or `accounts/` — check the Railway service logs (Deployments → View Logs) |
| App loads but a hard refresh on `/history` (or any deep link) 404s | The static service's start command is missing `-s` (SPA fallback) — check step 7.4 |
| AI program generation silently falls back to the local generator | `GEMINI_API_KEY` isn't set on `server/` — this is a soft failure by design, not a crash |
| Stripe checkout works but subscription never activates | Webhook URL/secret mismatch — re-check step 10, and check `accounts/` logs for signature errors |
| Changing a `VITE_*` var didn't seem to do anything | You edited the variable but didn't trigger a redeploy — Vite bakes these in at build time only |
| Build fails with `Found workspace with 2 packages` / `No start command detected` (Railpack) | **Root Directory** isn't set on this service, so the builder is reading the repo root's `package.json` (`workspaces: ["server","web"]`) instead of the app folder. Service → Settings → Source → Root Directory → set it to `server`/`accounts`/`web`/`admin`, and set Build/Start Command explicitly rather than relying on autodetection — see steps 5–8 |
| Deploy crashes with `npm error Missing script: "start"`, and the build itself seemed to succeed | Same root cause as above, different symptom: the **root** `package.json` happens to have a valid `build` script (`npm run build --workspaces`) so the build phase doesn't error, but it has no `start` script at all, so the deploy phase fails. This means Root Directory is unset here too — Railway is still running everything from the repo root. Fix identically: set Root Directory, then manually **Redeploy** (a settings change alone doesn't always trigger a rebuild) |
| All four `/health`/domain URLs return `{"status":"error","code":404,"message":"Application not found"}` with header `x-railway-fallback: true` | This is Railway's edge proxy, not your app — it means no successful deployment is currently live behind that domain. Check each service's Deployments tab for the actual build/crash log rather than trusting the domain response |

---

## 15. Environment variable reference

**`server/`**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=            # optional
GEMINI_MODEL=gemini-3.6-flash   # optional
CORS_ORIGIN=https://<web-domain>

# Medical desk — all optional. Unset, it answers on GEMINI_MODEL.
MEDICAL_AI_PROVIDER=auto              # auto | cloudrun | vertex | gemini
MEDICAL_AI_BASE_URL=                  # self-hosted endpoint, incl. /v1
MEDICAL_AI_SELF_HOSTED_MODEL=         # e.g. medgemma-1.5-4b-it
VERTEX_SERVICE_ACCOUNT_JSON=          # also mints the Cloud Run ID token
```

See [MedGemma on Cloud Run](MedGemma-Cloud-Run-Deployment.md) for what to put
in those.

**`accounts/`**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CORS_ORIGIN=https://<web-domain>,https://<admin-domain>
APP_URL=https://<web-domain>
STRIPE_SECRET_KEY=         # optional, billing only
STRIPE_WEBHOOK_SECRET=     # optional, billing only
STRIPE_PRICE_PRO=          # optional, billing only
ADMIN_API_KEY=
```

**`web/`** (build-time)
```
VITE_API_URL=https://<server-domain>
VITE_ACCOUNTS_URL=https://<accounts-domain>
```

**`admin/`** (build-time)
```
VITE_ACCOUNTS_URL=https://<accounts-domain>
```

None of the above need `PORT` set manually — Railway injects it for every
service, and every start command in this guide already reads it
(`process.env.PORT` in the two Node services, `$PORT` for `serve`).
