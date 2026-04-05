/** No Person row for this Clerk user — use for most authenticated routes. */
export const ERROR_PERSON_RECORD_REQUIRED = "Person record required — complete onboarding";

/** Only when rejecting POST /api/v1/families (creating a family requires a Person). */
export const ERROR_PERSON_BEFORE_CREATE_FAMILY = "Complete onboarding before creating a family";
