if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must be set for API tests (see apps/api/.env.example)."
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
