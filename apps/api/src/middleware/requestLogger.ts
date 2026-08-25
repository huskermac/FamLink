import morgan from "morgan";
import { env } from "../lib/env";

/**
 * The consent token is a bearer credential (possession = authorization) — it
 * must never reach logs. A GET on `/consent/:token` puts it in the request
 * path, and a POST from the consent web page carries it again in `Referer`
 * (browsers send the page's own URL as Referer on same-site form posts), so
 * both are masked here.
 */
const redactConsentToken = (s: string): string => s.replace(/(\/consent\/)[^/?#]+/g, "$1[redacted]");

morgan.token("safeurl", (req) => {
  const url = (req as { originalUrl?: string; url?: string }).originalUrl ?? (req as { url?: string }).url ?? "";
  return redactConsentToken(url);
});
morgan.token("saferef", (req) => redactConsentToken((req.headers?.referer ?? req.headers?.referrer ?? "-") as string));

const devFormat = ":method :safeurl :status :response-time ms - :res[content-length]";
const prodFormat =
  ':remote-addr - :remote-user [:date[clf]] ":method :safeurl HTTP/:http-version" :status :res[content-length] ":saferef" ":user-agent"';

export const requestLogger = morgan(env.NODE_ENV === "development" ? devFormat : prodFormat);
