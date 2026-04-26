import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  /** Same instance as Next.js `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`; required by `@clerk/express`. */
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  /** Verified sending domain in Resend (e.g. `mail.yourdomain.com`) — used as `invites@{domain}`. */
  RESEND_FROM_DOMAIN: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().min(1),
  GUEST_TOKEN_SECRET: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  /** PEM private key from the Firebase service account JSON (use \\n for newlines in .env). */
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  PORT: z.string().default("3001"),
  NODE_ENV: z.string().default("development"),
  WEB_APP_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  HELICONE_API_KEY: z.string().min(1),
  AI_MAX_TOOL_ITERATIONS: z.coerce.number().default(5),
  CLOUDFLARE_R2_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
  CLOUDFLARE_R2_BUCKET_NAME: z.string().min(1),
  CLOUDFLARE_R2_PUBLIC_URL: z.string().min(1)
});

export type Env = z.infer<typeof envSchema>;

/** `@clerk/express` reads `CLERK_PUBLISHABLE_KEY`; Next.js uses `NEXT_PUBLIC_*` only. */
function applyClerkPublishableFallback(): void {
  if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }
}

function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  applyClerkPublishableFallback();
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
