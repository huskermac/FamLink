import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: string = "US"
): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as CountryCode);
  return parsed && parsed.isValid() ? parsed.number : null;
}
