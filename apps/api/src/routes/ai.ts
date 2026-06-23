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
import { personed, type AuthedRequest } from "../middleware/requireAuth";
import { anthropicClient, PRIMARY_MODEL } from "../lib/aiClient";
import {
  checkAndIncrementAiRateLimit,
  getRateLimitStatus
} from "../lib/aiRateLimit";
import { buildTools } from "../lib/aiTools";
import { getAiDailyLimit, getAiDailyLimitForUser } from "../lib/entitlements";
import {
  assembleFamilyContext,
  formatContextForPrompt,
  getConversationHistory
} from "../lib/aiContext";
import { env } from "../lib/env";
import { activeFamilyMembership, hasAdminRole } from "../lib/familyAccess";

export const aiRouter = Router();

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
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

  // 1. Person resolved by requirePerson middleware
  const person = personed(req).person;

  // 2. Validate body
  const parsed = ChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const { messages, familyGroupId, conversationId: incomingConvId } = parsed.data;

  // 3. Verify family group membership
  const membership = await activeFamilyMembership(familyGroupId, person.id);
  if (!membership) {
    res.status(403).json({ error: "Forbidden: not a member of this family group" });
    return;
  }

  // 3b. Family-level AI toggle (admins can disable AI in family settings)
  const familyGroup = await db.familyGroup.findUnique({
    where: { id: familyGroupId },
    select: { aiEnabled: true }
  });
  if (!familyGroup?.aiEnabled) {
    res.status(403).json({
      error: "The AI assistant is turned off for this family. A family admin can re-enable it in settings."
    });
    return;
  }

  // 4. Check rate limit against the person's coverage-derived daily allowance
  const limit = await getAiDailyLimit(person.id);
  const rateLimit = await checkAndIncrementAiRateLimit(userId, limit);
  if (!rateLimit.allowed) {
    res.status(429).json({
      error: "Daily AI limit reached",
      resetAt: rateLimit.resetAt,
      message: `You've reached your daily limit of ${limit} AI queries. It resets at midnight UTC.`
    });
    return;
  }

  // 5. Resolve conversation ID
  const conversationId = incomingConvId ?? randomUUID();

  // 6. Fetch conversation history (scoped to this person + family)
  const history = await getConversationHistory(conversationId, person.id, familyGroupId, 20);

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
      // Tools are bound to the membership-verified family group and requester
      // (step 3) — the model cannot direct them at another family, and event
      // reads honor PRIVATE visibility for this member.
      tools: buildTools(familyGroupId, { personId: person.id, isAdmin: hasAdminRole(membership) }),
      stopWhen: stepCountIs(env.AI_MAX_TOOL_ITERATIONS)
    });

    // 10. Persist messages after streaming (fire and forget — non-blocking)
    Promise.resolve(result.text).then(async (assistantText) => {
      if (!assistantText) return;
      await db.assistantMessage.createMany({
        data: [
          {
            conversationId,
            personId: person.id,
            familyGroupId,
            role: "user",
            content: userMessage.content
          },
          {
            conversationId,
            personId: person.id,
            familyGroupId,
            role: "assistant",
            content: assistantText
          }
        ]
      });
    }).catch((err: unknown) => {
      console.error("[ai/chat] Failed to persist messages:", err);
    });

    result.pipeUIMessageStreamToResponse(res);
  } catch (err) {
    console.error("[ai/chat] streamText error:", err);
    res.status(500).json({ error: "AI service error" });
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────

aiRouter.get("/status", async (req: Request, res: Response): Promise<void> => {
  const { userId } = authed(req);

  const limit = await getAiDailyLimitForUser(userId);
  const status = await getRateLimitStatus(userId, limit);

  res.json({
    queriesUsedToday: limit - status.remaining,
    queriesRemaining: status.remaining,
    resetAt: status.resetAt
  });
});
