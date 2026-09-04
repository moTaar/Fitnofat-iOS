# ForgeFit — working notes

AI-driven workout / nutrition / coaching PWA. See `README.md` for the full
architecture, API surface and environment reference; this file covers the things
that are easy to get wrong when changing the code.

## Layout and install
Four packages. `server/` and `web/` are npm workspaces of the repo root;
`accounts/` and `admin/` are standalone. **Every package also has its own
lockfile**, because `render.yaml` builds each service from its own `rootDir`.

Consequence: running `npm install <pkg>` inside `server/` or `web/` updates the
**root** lockfile, not the package's own — npm resolves them as workspace
members. To refresh a child lockfile, the root `package.json` has to be moved
aside for the duration of the install. Keep both in sync when adding a dependency
to `server/` or `web/`, or CI (`npm ci` per package) will fail while local dev
passes.

## Commands
```bash
npm test --workspace=server      # vitest
npm test --workspace=web
npm run typecheck --workspace=server
npm run lint --workspace=web     # tsc --noEmit
```
CI runs typecheck + test + build for all four packages on every PR.

## Things that will bite you

**Two services verify the same tokens.** `server/src/jwt.ts` and
`accounts/src/jwt.ts` are intentional copies (separate npm projects, no shared
package). Change one, change the other.

**The entitlement map is mirrored three times**: `accounts/src/entitlements.ts`
(authority), `server/src/entitlements.ts`, and `web/src/lib/entitlements.ts`
(UI hints only). Adding a Feature means touching all three.

**Plans are cached for 60s** in the data API (`resolvePlan`). A Stripe upgrade
can take up to a minute to unlock a feature; that's deliberate, not a bug.

**Never make an AI route reachable without a meter.** Every route that can reach
Gemini must carry `aiLimiter` plus *either* `requireEntitlement` (Pro-only) or
`aiQuota` (free-reachable). `/program/generate` and `/ai/chat` are deliberately
quota-gated rather than entitlement-gated so free users keep their first program
and onboarding.

**Body limits are per-route.** Only `/api/ai/coach` gets 25mb (image
attachments); everything else is capped at 512kb in `server/src/index.ts`.

**`/bootstrap` returns a history window, not everything.** Older sessions come
from `GET /workouts`. Code that assumes `store.history` is the complete archive
is wrong — check `historyHasMore`.

**localStorage is not reliable storage.** `resilientStorage` in
`web/src/lib/store.ts` sheds old *synced* history when the quota is hit.
Unsynced sessions are never dropped — they exist nowhere else.

**Equipment enforcement is load-bearing.** The AI will program gear the athlete
doesn't own if the constraint chain in `server/src/gemini.ts` breaks, and nothing
downstream catches it. `__equipment` is exported purely as a test seam; the
tests in `gemini.equipment.test.ts` are the guard.

**Gemini output is not guaranteed JSON.** Parse it through `parseJson`, which
throws `GEMINI_BAD_JSON`. Recoverable failures (`NO_API_KEY`, `GEMINI_TIMEOUT`,
`GEMINI_BAD_JSON`) fall back to the local deterministic generator via
`isRecoverable` — don't let them surface as 500s.

**Error messages from upstream are not client-safe.** Supabase/Gemini/Stripe
messages can carry key fragments and row contents. Throw `HttpError` for anything
the client should read verbatim; everything else becomes a generic 500 when
`NODE_ENV=production`.

**Keep the eager route bundle small.** `web/src/App.tsx` lazy-loads every page
except Dashboard and ActiveWorkout, which are the in-gym critical path. A static
import of a heavy page from an always-mounted component silently undoes this —
that's how `AiCoach` originally ended up in the entry chunk via `CoachBubble`.

## Database
`supabase/schema.sql` is the base; `supabase/migrations/*.sql` apply in filename
order on top. `ai_usage` and `exercise_guides` are service-role-only (RLS on, no
policies) — the client never reads them directly.
