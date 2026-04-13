/**
 * AI Assistant Routes (ADR-06)
 *
 * POST /api/v1/ai/chat   — streaming chat with tool use
 * GET  /api/v1/ai/status — rate limit status (read-only)
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { streamText, stepCountIs } from "ai";
import { randomUUID } from "crypto";
import { db } from "@famlink/db";
import type { AuthedRequest } from "../middleware/requireAuth";
import { anthropicClient, PRIMARY_MODEL } from "../lib/aiClient";
import {
  checkAndIncrementAiRateLimit,
  getRateLimitStatus
} from "../lib/aiRateLimit";
import { allTools } from "../lib/aiTools";
import {
  assembleFamilyContext,
  formatContextForPrompt,
  getConversationHistory
} from "../lib/aiContext";
import { env } from "../lib/env";
import { ERROR_PERSON_RECORD_REQUIRED } from "../lib/personRequiredMessages";

export const aiRouter = Router();

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

// ── Validation schemas ────────────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1)
});

const ChatBodySchema = z.object({
  messages: z.array(MessageSchema).min(1),
  familyGroupId: z.string().min(1),
  conversationId: z.string().optional()
});

// ── POST /chat ────────────────────────────────────────────────────────────────

aiRouter.post("/chat", async (req: Request, res: Response): Promise<void> => {
  const { userId } = authed(req);

  // 1. Resolve person from auth
  const person = await personForClerkUserId(userId);
  if (!person) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  // 2. Validate body
  const parsed = ChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const { messages, familyGroupId, conversationId: incomingConvId } = parsed.data;

  // 3. Verify family group membership
  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId, personId: person.id } }
  });
  if (!membership) {
    res.status(403).json({ error: "Forbidden: not a member of this family group" });
    return;
  }

  // 4. Check rate limit
  const rateLimit = await checkAndIncrementAiRateLimit(userId);
  if (!rateLimit.allowed) {
    res.status(429).json({
      error: "Daily AI limit reached",
      resetAt: rateLimit.resetAt,
      message: "You've reached your 20 daily AI queries. Your limit resets at midnight UTC."
    });
    return;
  }

  // 5. Resolve conversation ID
  const conversationId = incomingConvId ?? randomUUID();

  // 6. Fetch conversation history
  const history = await getConversationHistory(conversationId, 20);

  // 7. Assemble family context
  const context = await assembleFamilyContext(person.id, familyGroupId);
  const contextText = formatContextForPrompt(context);

  // 8. Build system prompt
  const systemPrompt = [
    "You are FamLink's family assistant. You help family members stay connected, coordinate events, and stay informed about their family.",
    "",
    "Current family context:",
    contextText,
    "",
    "Instructions:",
    "- Use the available tools to answer questions about family data. Never fabricate family data.",
    "- If a tool returns no results, say so clearly.",
    "- The create_event tool returns a proposal only — never confirm or create an event autonomously.",
    "- Be warm, helpful, and concise."
  ].join("\n");

  // 9. Stream response
  const userMessage = messages[messages.length - 1];

  try {
    const result = streamText({
      model: anthropicClient(PRIMARY_MODEL),
      system: systemPrompt,
      messages: [...history, ...messages],
      tools: allTools,
      stopWhen: stepCountIs(env.AI_MAX_TOOL_ITERATIONS)
    });

    // 10. Persist messages after streaming (fire and forget — non-blocking)
    result.text.then(async (assistantText) => {
      if (!assistantText) return;
      await db.assistantMessage.createMany({
        data: [
          {
            conversationId,
            role: "user",
            content: userMessage.content
          },
          {
            conversationId,
            role: "assistant",
            content: assistantText
          }
        ]
      });
    }).catch((err: unknown) => {
      console.error("[ai/chat] Failed to persist messages:", err);
    });

    result.pipeDataStreamToResponse(res);
  } catch (err) {
    console.error("[ai/chat] streamText error:", err);
    res.status(500).json({ error: "AI service error" });
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────

aiRouter.get("/status", async (req: Request, res: Response): Promise<void> => {
  const { userId } = authed(req);

  const status = await getRateLimitStatus(userId);

  res.json({
    queriesUsedToday: 20 - status.remaining,
    queriesRemaining: status.remaining,
    resetAt: status.resetAt
  });
});
