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
  PORT: z.string().default("3001"),
  NODE_ENV: z.string().default("development"),
  WEB_APP_URL: z.string().url()
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
