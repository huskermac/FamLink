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
setDefault("FIREBASE_PROJECT_ID", "jest-firebase-project");
setDefault("FIREBASE_CLIENT_EMAIL", "firebase-adminsdk@jest-firebase-project.iam.gserviceaccount.com");
/** Throwaway PKCS#8 key so `firebase-admin` can parse credentials in non-mocked imports. */
setDefault(
  "FIREBASE_PRIVATE_KEY",
  `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC6tzZ47yqw8zVT
NliMR+wXq0TlBWu9JWtFHgKCezFi2bH6WP5cG33jeF+DiY5gANlQ8n9K2MMRM4GH
s9dWntA3YRY9c/pw7BQGuRKXcX7t1zfMtx5WzCizPoEgdALjPAhqwoibfCMASGgB
Bv6ApIlR11brJHSzFV5MN53bCR04EyQHySzQSk48HYgbrGGhv1z8zOpjQ6hc7gzi
OfvrqRsVipqs+rBuEQeNA4ZPFfDGEa+OIhfb8kPxK6rPCRCoMbn7Cfas9swzh+tt
red5xa9PHTevGUaE6ROPHFPFSxm+UEizL5lXL0Pe8wnbKsqpzMJMuyf207ksx5qB
GcIWsz17AgMBAAECggEAWB6ztKubiFugJR+W9s3S3PDV2QiP6nrIf5xELvSZQD/h
wXdSxIGtDjf3TAsViLWd2pg3/0kB9xJJ5ZO444acWiaV6nbcEYM5iFq8LYFBGFrk
WNdrmCdOZhnvszNNUZU5m7kn48nYcv+5JhL49hmxPVDWEq/n68T/9hShiYhpo9aG
OjHfVBltusXmCw0E8QRzUb+mANuwPdDcGjhUrXAq/2TbCm3u5t2tMgtIlneitOPY
ZtoNtz4UrMUmroiBO9+yI4dEttJD4QF8b9Ng+x54FGtZPShfEPtD79lrhKUkhBpY
v2EDg2oZui4JwExbWo7cZ62qAcDHEpf+ySkAnjiToQKBgQDjXNqqzEOFJ4GzXwII
WrdpYZBZw8bt5POjVKbAlzxBw7oq8McGIJ1CyfJkhOsMddPZ92rrDVC3ETf2qbjU
tJRPSyRnu9YAecejIyOwrsm49iTvMOIHQPW1MHPi7hFb5+QZ4ignomvN1zjF5kyP
hzphvI2I5VZ6kWLWGA3yt3PiqQKBgQDSO7lw90HqgBf9+v9Er0HJaOwmaVffBd2g
XosDh6J+xojBlOVOdQKkNBtbWSvkU12W/oCTrS2X+aT60LcVQ0/2eKmduTPG4aZ6
5qQY1+8B7XniJ7GgF54cR2fWchQBqd61pakuXOaUAZrQeflU++rlu1DqgeoHAkxF
7pXE0T3ZgwKBgQCI64M39lj3GCqQhbeoplDr4nhWxoLHAukCRFlDhBAinqc/cs64
Tu3Fqe4SQMV4NIEHM2us79Da3kCwh9cqKTFjayIaYlDm6m+iO+gjX69Vds4ZSXvk
2Gbf3bT8RVgo28ZPHBYIgFShmmmzLBSRHuO2tiEZ/tqMZ3945PWJZJciOQKBgDHX
KOqII99lSMrUo4n0BqOqNToSBVwBNv6bC1fl4vctOCS0mPxVry+gjs/EPyydOvXe
Fjtsdf+ulpdDvfPThnSHPKcAzi6bNm2ymjqtjqMlWpzsDidHEhvgLdTgLLAMRplH
0ekE60ExdDNyh1LHenPGSbOe4w2QVObLXkRP2trjAoGAKYXKhVNtOwLYYqPJ3NCR
H6URTedDo25AxHkuEGnfV3mv7Ui8eDQpSB/bGOgE+aaqfhtlumkXP6s7+cIQzprd
ybw55YiWFwpjBt0bMpzfidA4aE25D25YF5o+t5vRbP3BH5to0wXGJz0lyx3S7p2q
PV1SK3RsMOHmxt0G63B1JTQ=
-----END PRIVATE KEY-----`
);
setDefault("PORT", "3001");
setDefault("NODE_ENV", "test");
setDefault("WEB_APP_URL", "http://localhost:3000");
setDefault("REDIS_URL", "redis://localhost:6379");
setDefault("ANTHROPIC_API_KEY", "anthropic_test_key_placeholder");
setDefault("OPENAI_API_KEY", "openai_test_key_placeholder");
setDefault("HELICONE_API_KEY", "helicone_test_key_placeholder");
setDefault("AI_MAX_TOOL_ITERATIONS", "5");
setDefault("CLOUDFLARE_R2_ACCOUNT_ID", "test-account");
setDefault("CLOUDFLARE_R2_ACCESS_KEY_ID", "test-key");
setDefault("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "test-secret");
setDefault("CLOUDFLARE_R2_BUCKET_NAME", "test-bucket");
setDefault("CLOUDFLARE_R2_PUBLIC_URL", "https://pub.example.com");
