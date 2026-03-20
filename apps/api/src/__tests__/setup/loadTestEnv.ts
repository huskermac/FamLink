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
setDefault("CLERK_SECRET_KEY", "sk_test_jest_placeholder");
setDefault(
  "CLERK_WEBHOOK_SECRET",
  "whsec_" + Buffer.from("jest_webhook_secret_32_bytes!!").toString("base64")
);
setDefault("RESEND_API_KEY", "re_test_jest");
setDefault("TWILIO_ACCOUNT_SID", "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
setDefault("TWILIO_AUTH_TOKEN", "twilio_test_jest");
setDefault("TWILIO_PHONE_NUMBER", "+15555551234");
setDefault("PORT", "3001");
setDefault("NODE_ENV", "test");
setDefault("WEB_APP_URL", "http://localhost:3000");
