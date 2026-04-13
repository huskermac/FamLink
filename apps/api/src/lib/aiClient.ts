/**
 * AI Client (ADR-06)
 *
 * Initializes the Anthropic client wrapped with Helicone observability,
 * and an OpenAI fallback client. Helicone is used via its OpenAI-compatible
 * proxy URL — no separate Helicone package needed.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "./env";

export const PRIMARY_MODEL = "claude-sonnet-4-6";
export const FALLBACK_MODEL = "gpt-4.1";

/**
 * Anthropic client routed through Helicone for observability.
 * All requests are logged, costed, and cached via Helicone.
 */
export const anthropicClient = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  baseURL: "https://anthropic.helicone.ai/v1",
  headers: {
    "Helicone-Auth": `Bearer ${env.HELICONE_API_KEY}`
  }
});

/**
 * OpenAI fallback client — standard, no Helicone wrapping.
 * Used when the primary Anthropic model is unavailable.
 */
export const openAiClient = createOpenAI({
  apiKey: env.OPENAI_API_KEY
});
