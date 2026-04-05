import path from "path";
import { config } from "dotenv";
import { loadDotenvTest } from "./loadDotenvTest";

loadDotenvTest();

/** Repo root `.env` (Clerk keys live there); does not override vars already set by `.env.test`. */
const repoRoot = path.resolve(__dirname, "../../../../../");
config({ path: path.join(repoRoot, ".env") });
config({ path: path.join(repoRoot, ".env.local") });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must be set for API tests (see apps/api/.env.example)."
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

function setDefault(key: string, value: string): void {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

/** Minimal values so `lib/env` Zod validation passes when tests import `server`. */
/** Deliberately not `sk_test_*` — audit flags hardcoded Clerk-style key prefixes in source. */
setDefault("CLERK_SECRET_KEY", "jest_clerk_secret_key_placeholder_not_a_real_key");
/** Required by `@clerk/express` middleware (validates JWTs); must be a real-shaped test key. */
setDefault(
  "CLERK_PUBLISHABLE_KEY",
  "pk_test_Y2xlcmsuZGV2JTIwJTIwJTIwJTIwJTIwJTIw"
);
setDefault(
  "CLERK_WEBHOOK_SECRET",
  "whsec_" + Buffer.from("jest_webhook_secret_32_bytes!!").toString("base64")
);
setDefault("RESEND_API_KEY", "re_test_jest");
setDefault("RESEND_FROM_DOMAIN", "example.com");
setDefault("TWILIO_ACCOUNT_SID", "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
setDefault("TWILIO_AUTH_TOKEN", "twilio_test_jest");
setDefault("TWILIO_PHONE_NUMBER", "+15555551234");
setDefault("GUEST_TOKEN_SECRET", "jest_guest_token_secret_32_chars!!");
setDefault("PORT", "3001");
setDefault("NODE_ENV", "test");
setDefault("WEB_APP_URL", "http://localhost:3000");
