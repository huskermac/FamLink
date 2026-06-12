# FamLink Production Operations Reference

Practical recaps of the operator actions used to bring production live (2026-06-12).
Keep this handy for repeat tasks. Architecture recap: **web on Vercel · API + Postgres + Redis on Railway · payments on Stripe · repo on GitHub** (push to `main` → CI → Railway deploy).

---

## 1. Prisma — database changes

### Apply migrations to an environment
```powershell
cd C:\Users\swmcl\FamLink\packages\db
# Local/default database (root .env decides which — see warning below):
npx prisma migrate deploy
# A specific database:
$env:DATABASE_URL = "<connection string>"
npx prisma migrate deploy
Remove-Item Env:DATABASE_URL   # always clear it afterward
```
- `migrate deploy` is **idempotent** — running it twice is harmless ("No pending migrations").
- Production applies migrations automatically on every Railway deploy (it's in the start command).
- From the repo root, always use `--config=packages/db/prisma.config.ts` (Prisma 7 keeps the database URL in that config; `--schema` alone fails).

### Edit data with Prisma Studio
```powershell
cd C:\Users\swmcl\FamLink\packages\db
$env:DATABASE_URL          # PRINT IT FIRST — this is the database you are about to edit
npx prisma studio
```
- Studio shows the **live database**, whatever `DATABASE_URL` points at.
- ⚠️ **Currently the root `.env` points at the production Railway database** — local dev and production are the same DB until the planned `famlink_dev` split. Treat every Studio session as production.
- A column missing in Studio = that database hasn't had the migration applied yet (see above).

### Seeding
- **Never run `npm run db:seed` against production** — it inserts a demo family. Enter/adjust production rows by hand in Studio.

---

## 2. Railway — API hosting

### Where things are
- **Variables**: API service → Variables (runtime env; the API validates ALL of them at boot and exits if any are missing — the first deploy-log lines name the missing ones).
- **Public domain**: API service → Settings → Networking.
- **Logs**: each deployment has **Build logs** (compile errors) and **Deploy logs** (boot + runtime, including crashes).

### The two rules that bit us
1. **Staged changes**: editing variables or Source settings does NOT apply immediately — look for the **"Apply changes" / Deploy banner** on the project canvas and click it.
2. **Exact-match URLs**: `WEB_APP_URL` must equal the Vercel origin **exactly** — `https://fam-link-web.vercel.app`, no trailing slash. (The API now tolerates a trailing slash, but don't rely on it.)

### Deploys
- Push to `main` → CI runs → (service has **Wait for CI** on) → Railway builds and swaps when the healthcheck (`/health`) passes. Two deployments showing at once during a rollout is normal — don't cancel.
- **"Redeploy" on an old deployment rebuilds that old commit** — to ship the latest, push a commit or use the Deploy button/command palette.
- Build stage has **no environment variables** (only runtime does) — code must not require env at build time.

### GitHub connection
- Repo events only reach Railway if the **Railway GitHub App** is installed: github.com → Settings → **Installed GitHub Apps** (not "Authorized OAuth Apps") → Railway → Repository access includes `huskermac/FamLink`.

---

## 3. Vercel — web hosting

- **Environment variables**: project → Settings → Environment Variables. The critical one: `NEXT_PUBLIC_API_URL = https://<railway-api-domain>`.
- ⚠️ **`NEXT_PUBLIC_*` values are baked in at build time.** After changing one: Deployments → ⋯ → **Redeploy**, and **uncheck "Use existing Build Cache."** (Railway variables, by contrast, apply on restart without a rebuild.)
- Deploys trigger automatically on push to `main`. Monorepo builds take a while (~5–10 min). Future speedups (M3): Ignored Build Step `npx turbo-ignore famlink-web`; confirm Root Directory is `apps/web`.

---

## 4. Stripe — products, prices, webhook

### IDs — the trap
- Every product has a `prod_…` ID (top of the product page) and each price under it has a `price_…` ID (click the price row → "API ID").
- **The app only ever wants `price_…` IDs.** A `prod_…` in the database = checkout fails with "No such price."

### Where pricing config lives
- Runtime checkout reads the **`PricingTier` table** (edit via Prisma Studio):
  - `stripePriceId` — the base plan's **monthly** `price_` ID
  - `stripeSeatPriceId` — the per-seat overflow **monthly** `price_` ID
  - `includedSeats` — how many active seats the base price covers (only the overflow is billed)
  - `activeUserLimit`, `trialDays`, `displayName`, `displayOrder`, `isActive`
- The `STRIPE_PRICE_*` env vars only feed the seed script — the table is the source of truth.
- **One subscription cannot mix billing intervals** — base and seat prices must both be monthly. Annual = a future separate tier row (e.g. `FAMILY_ANNUAL`) with annual prices.

### Webhook (once per environment)
- Developers → Webhooks → endpoint `https://<railway-api-domain>/api/v1/billing/webhook` with events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`.
- Copy its **signing secret** (`whsec_…`) into Railway as `STRIPE_WEBHOOK_SECRET`.
- Verify deliveries on the endpoint page — every event should show **200**.

### Customer Portal (Settings → Billing → Customer portal)
- Allow: payment-method updates, cancellation. **Disable plan switching and quantity changes** (portal-made switches would desync the app's tier data).

### Test mode
- Keep the **Test mode** toggle on (orange banner) until launch; `STRIPE_SECRET_KEY` in Railway must match the mode (`sk_test_…`). Test card: `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.

---

## 5. End-to-end smoke test (after any billing-related change)

1. Web app → sign in → `/billing/plans` → pick Family → checkout page → Continue to Payment.
2. Pay with `4242 4242 4242 4242`.
3. Verify three things:
   - Stripe → Webhooks → endpoint → recent delivery `checkout.session.completed` = **200**
   - App → `/settings/billing` shows the tier, status, and seat count (= `includedSeats` when no overflow bought)
   - Stripe → Customers → subscription shows **base price only** (no seat item within the allowance)
4. Optional: cancel from Stripe → `/settings/billing` flips on its own (tests the deletion webhook).

---

## 6. Symptom → cause cheat sheet (all observed 2026-06-12)

| Symptom | Cause / fix |
|---|---|
| Browser: `Failed to fetch` / requests to `localhost:3001` | Vercel `NEXT_PUBLIC_API_URL` missing/wrong → set it, **redeploy without build cache** |
| Browser: CORS "header has a value '…/' not equal to origin" | Railway `WEB_APP_URL` trailing slash / wrong URL → exact origin match |
| Browser: 502 + missing CORS header | API process crashed mid-request → read Railway **Deploy logs** at that timestamp for the real error |
| Deploy log: `Invalid environment variables: { X: … }` then exit | Required Railway variable missing — the log names it |
| Deploy fails at healthcheck, log shows `datasource.url property is required` | Prisma command missing `--config=packages/db/prisma.config.ts` |
| Stripe error `No such price: 'prod_…'` | Product ID in `PricingTier` instead of price ID |
| API 400 `familyGroupId is required when you belong to multiple families` | Caller didn't pass family scope (web pages now do); account belongs to 2+ families |
| Railway shows no new deployment after a push | GitHub App not installed/repo not connected, staged-changes banner unclicked, or CI (the gate) failed — check github Actions tab |
| Edited a Railway variable, nothing changed | Staged changes banner — click Apply |
| Column missing in Prisma Studio | Migration not applied to that database |
