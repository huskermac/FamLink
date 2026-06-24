export const REFRESH_INTERVAL_MS = 10_000;

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:3000";
// Web-link upsell is OFF by default: shipping a web purchase link for a digital
// upgrade in a store build risks App Store rejection (IAP). Enable only for
// internal/TestFlight beta builds.
export const ENABLE_WEB_UPSELL = process.env.EXPO_PUBLIC_ENABLE_WEB_UPSELL === "true";
