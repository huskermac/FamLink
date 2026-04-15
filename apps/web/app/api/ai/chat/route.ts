/**
 * Next.js proxy route for AI chat.
 *
 * Receives a Vercel AI SDK v6 data-stream request from the frontend,
 * converts UIMessage[] → {role, content}[] for the Express endpoint,
 * adds the Clerk auth token, and pipes the streaming response back.
 *
 * FamLink runs on Railway — do NOT use Vercel AI Gateway.
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface TextPart {
  type: "text";
  text: string;
}

interface UIMessageInput {
  id?: string;
  role?: string;
  parts?: Array<{ type: string; text?: string }>;
}

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  const { getToken } = await auth();
  const token = await getToken();

  let body: {
    messages?: UIMessageInput[];
    familyGroupId?: string;
    id?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const messages: UIMessageInput[] = body.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  if (!body.familyGroupId) {
    return NextResponse.json({ error: "familyGroupId is required" }, { status: 400 });
  }

  // Extract text content from the last UIMessage's parts
  const textContent = (lastMessage.parts ?? [])
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");

  const expressBody = {
    messages: [{ role: lastMessage.role ?? "user", content: textContent }],
    familyGroupId: body.familyGroupId,
    conversationId: body.id
  };

  const upstream = await fetch(`${API_BASE}/api/v1/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`
    },
    body: JSON.stringify(expressBody)
  });

  // Pipe the data stream response back unchanged
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": upstream.headers.get("x-vercel-ai-data-stream") ?? "v1",
      "Transfer-Encoding": "chunked"
    }
  });
}
