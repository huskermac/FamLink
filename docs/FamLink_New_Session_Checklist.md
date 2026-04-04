# FamLink — New development session checklist

Use this when you **start a fresh day** or **new machine** to get web + API + Clerk webhooks working again. Work **top to bottom** unless a step doesn’t apply.

**Related:** `docs/FamLink_Cursor_Checkpoint_DevEnv.md` (technical context), `docs/FamLink_Resumption_Prompt.md` (product/phase).

---

## Before you start (one-time per machine)

- [ ] **Node.js** installed (LTS recommended), **npm** works in PowerShell.
- [ ] **Git** clone of `FamLink` on disk.
- [ ] **PostgreSQL** reachable (Railway URL in `.env` is fine — no local Postgres required if you use cloud DB).
- [ ] **ngrok** installed ([download](https://ngrok.com/download)) and **account** created; run `ngrok config add-authtoken <token>` once ([dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)).
- [ ] **Clerk** app configured; you have **Publishable** and **Secret** keys in your local `.env` (see env section below).

---

## 1. Open the repo and install dependencies

1. Open **PowerShell**.
2. Go to the repo root:

   ```powershell
   cd C:\Users\swmcl\FamLink
   ```

3. Install packages:

   ```powershell
   npm install
   ```

4. If you changed **`packages/db`** Prisma schema or **`packages/shared`** since last session, rebuild:

   ```powershell
   npm run build -w @famlink/db
   npm run build -w @famlink/shared
   ```

   *(Skip if you only edited app code and didn’t touch schema/shared.)*

---

## 2. Confirm environment files exist

Your secrets live in **gitignored** files — they are **not** committed.

| File | Purpose |
|------|--------|
| **`C:\Users\swmcl\FamLink\.env`** | Primary local config (DB, Clerk, API, etc.) |
| **`C:\Users\swmcl\FamLink\.env.local`** | Overrides (optional; same keys win over `.env` per your tooling) |

**Checklist:**

- [ ] **`DATABASE_URL`** — points at your Postgres (e.g. Railway).
- [ ] **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`** — starts with `pk_test_` or `pk_live_` (from [Clerk → API keys](https://dashboard.clerk.com/last-active?path=api-keys)).
- [ ] **`CLERK_SECRET_KEY`** — starts with `sk_test_` or `sk_live_`.
- [ ] **`CLERK_PUBLISHABLE_KEY`** — same value as publishable key (API / Express uses this name).
- [ ] **`CLERK_WEBHOOK_SECRET`** — starts with `whsec_` (from Clerk **after** you create the webhook endpoint; see section 5).
- [ ] **`WEB_APP_URL`** — e.g. `http://localhost:3000` (must match the Next.js origin).
- [ ] **`PORT`** for API — usually **`3001`** in `.env` (or omit to default if your code defaults it).

**If the web app shows “Missing publishable key”:** keys must be present **before** starting Next; after fixing, delete **`apps\web\.next`** once, then restart web (step 4).

---

## 3. Start the API (Express on port 3001)

1. Open **Terminal A** (keep it open).

   ```powershell
   cd C:\Users\swmcl\FamLink\apps\api
   npm run dev
   ```

2. Wait for a line like: **`API listening on port 3001`** (or your configured `PORT`).

3. **If you see `EADDRINUSE`:** another process is using that port — usually an old API still running. Stop it with **Ctrl+C** in its terminal, or find and end the process:

   ```powershell
   netstat -ano | findstr ":3001"
   ```

   Note the **PID** in the last column, then:

   ```powershell
   Stop-Process -Id <PID> -Force
   ```

4. **Smoke test** in a browser:

   - **`http://localhost:3001/health`**  
   - Expect JSON with **`"status":"ok"`** and **`"db":"ok"`**.

If **`db`** is **error**, fix `DATABASE_URL` / network / Railway before webhooks or app testing.

---

## 4. Start the Next.js web app (port 3000)

1. Open **Terminal B**.

   ```powershell
   cd C:\Users\swmcl\FamLink\apps\web
   npm run dev
   ```

2. Wait for **Ready** and **Local: http://localhost:3000**.

3. Open **`http://localhost:3000/`** — home page should load without a red error overlay.

4. Optional: **`http://localhost:3000/sign-in`** — Clerk UI loads.

**If port 3000 is in use:** stop the other dev server or change that app’s port — only **one** process per port.

---

## 5. ngrok — new public URL every session (typical)

**Why:** Clerk webhooks must call a **public HTTPS** URL. Your API is only on `localhost` unless you tunnel.

**Important:** Each time you **restart ngrok** (or your PC sleeps), the **random subdomain often changes**. You must **update Clerk** with the **new** URL (step 6).

### 5a. Start ngrok pointing at the API port

1. Open **Terminal C**.

2. Run:

   ```powershell
   ngrok http 3001
   ```

   *(Use **3001**, not 3000 — that’s the Express API.)*

3. In the ngrok output, find the **Forwarding** line, **HTTPS** — it looks like:

   `https://abcd-12-34-56-78.ngrok-free.app`  
   *(Your subdomain will differ.)*

4. **Copy** that **origin only** (no path), e.g. `https://YOUR-SUBDOMAIN.ngrok-free.app`

### 5b. Build the full webhook URL (for Clerk)

Append the FamLink webhook path:

```text
https://YOUR-SUBDOMAIN.ngrok-free.app/api/v1/webhooks/clerk
```

**Checklist:**

- [ ] Uses **`https`**
- [ ] **No** `:3001` in the URL (ngrok handles the tunnel)
- [ ] Path ends with **`/api/v1/webhooks/clerk`** exactly (matches Express mount in `apps/api`)

### 5c. ngrok inspector (optional but useful)

- Open **`http://127.0.0.1:4040`** in a browser to see **every** request ngrok receives (helps debug Clerk timeouts).

---

## 6. Update Clerk webhook URL after ngrok changes

Do this **whenever** your ngrok HTTPS URL changes.

1. Go to **[Clerk Dashboard](https://dashboard.clerk.com)** → select your **application**.

2. Navigate to **Configure → Webhooks** (or **Developers → Webhooks**, depending on UI).

3. Open your **existing** webhook endpoint (or **Add endpoint** if first time).

4. Set **Endpoint URL** to the **full** URL from section 5b:

   `https://YOUR-SUBDOMAIN.ngrok-free.app/api/v1/webhooks/clerk`

5. Ensure **subscribed events** include at least:

   - `user.created`
   - `user.updated`

6. **Save**.

7. **Signing secret:** If you **created a new** endpoint, Clerk shows a new **`whsec_...`** secret — put it in **`.env` / `.env.local`** as:

   ```env
   CLERK_WEBHOOK_SECRET=whsec_xxxxxxxx
   ```

   Then **restart the API** (Terminal A: **Ctrl+C**, `npm run dev` again).  
   If you only **changed the URL** and kept the **same** endpoint, the secret usually **stays the same** — no env change.

---

## 7. Verify webhook delivery (after API + ngrok + Clerk URL match)

1. In Clerk → your webhook → **Send test event** (or trigger a real user update).

2. In **ngrok** (`http://127.0.0.1:4040`), confirm a **POST** hits your host.

3. In **Clerk** delivery log, status should be **success** (2xx).

4. If **timeout / failed:**

   - API not running, ngrok not running, or **wrong URL** (port 3000 vs 3001, typo, **old** ngrok URL).
   - **`CLERK_WEBHOOK_SECRET`** must match the **same** Clerk endpoint that sends events.

---

## 8. Quick “all systems” verification

| Check | URL / action | Expected |
|-------|----------------|----------|
| API health | `http://localhost:3001/health` | `status` ok, `db` ok |
| API root | `http://localhost:3001/` | JSON mentioning API + `/health` |
| Web home | `http://localhost:3000/` | FamLink home, no overlay error |
| Signed in | Visit `/dashboard` after sign-in | Dashboard shows your Clerk `user_...` id |
| Webhook | Clerk test event + ngrok inspector | 2xx in Clerk, request visible in ngrok |

---

## 9. When you’re done for the day

- **Ctrl+C** in each terminal (API, web, ngrok) to free ports.
- **No need** to delete `.next` unless Next behaves oddly next time.

---

## 10. Optional: clean Next cache if the web app acts strange

```powershell
Remove-Item -Recurse -Force C:\Users\swmcl\FamLink\apps\web\.next -ErrorAction SilentlyContinue
```

Then start **`npm run dev`** again in `apps/web`.

---

## Quick reference — ports

| Service | Default port |
|---------|----------------|
| Next.js (web) | **3000** |
| Express (API) | **3001** |
| ngrok web UI | **4040** (local only) |

---

## Quick reference — Clerk webhook path (API only)

```text
POST https://<public-host>/api/v1/webhooks/clerk
```

`<public-host>` = ngrok HTTPS host **or** your production API host — **never** `localhost` for Clerk’s dashboard.

---

*Copy or trim this checklist into your notes; update section 5–6 if you switch to a **stable ngrok domain** (paid) or **deploy the API** to Railway and use that URL instead of ngrok.*
