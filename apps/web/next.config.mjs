import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Must run before any Clerk code loads: disables keyless + KeylessCookieSync server actions.
process.env.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED ??= "1";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
const dotenv = require("dotenv");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = __dirname;
// Next only loads `.env*` from `apps/web` by default; Clerk keys often live in the repo root.
const repoRoot = path.join(__dirname, "../..");
const dev = process.env.NODE_ENV !== "production";
// Monorepo: load root `.env*` (same rules as `next dev` from repo root).
loadEnvConfig(repoRoot, dev);
// Reinforce root + apps/web (some setups skip the first pass; middleware reads from compiled env).
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true });
dotenv.config({ path: path.join(webRoot, ".env") });
dotenv.config({ path: path.join(webRoot, ".env.local"), override: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: trace files from repo root (avoids wrong workspace root + noisy Next warning).
  outputFileTracingRoot: repoRoot,
  // Pin NEXT_PUBLIC_* into the bundle. Next can reset `process.env` after this file runs; without this,
  // monorepo root `.env` may not reach Clerk (Missing publishableKey).
  env: {
    NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "1",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL:
      process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL:
      process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "",
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? ""
  }
};

if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.NODE_ENV !== "test") {
  console.warn(
    "[@famlink/web] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing after loading env from:",
    repoRoot,
    "and",
    webRoot,
    "— add it to the repo root .env / .env.local or apps/web/.env.local, then delete apps/web/.next and restart."
  );
}

export default nextConfig;
