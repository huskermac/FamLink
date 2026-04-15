"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { getMyFamilies } from "@/lib/api/family";
import { getAiStatus } from "@/lib/api/assistant";
import { createEvent } from "@/lib/api/events";
import type { AiEventProposal } from "@/lib/api/events";
import { MessageBubble } from "@/components/assistant/MessageBubble";
import { ChatInput } from "@/components/assistant/ChatInput";
import { RateLimitBadge } from "@/components/assistant/RateLimitBadge";
import { SuggestedPrompts } from "@/components/assistant/SuggestedPrompts";

const transport = new DefaultChatTransport({ api: "/api/ai/chat" });

export default function AssistantPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);

  const familiesQuery = useQuery({
    queryKey: ["families"],
    queryFn: () => getMyFamilies(getToken)
  });

  useEffect(() => {
    const memberships = familiesQuery.data;
    if (memberships && memberships.length > 0) {
      setFamilyId(memberships[0].familyGroup.id);
    }
  }, [familiesQuery.data]);

  const statusQuery = useQuery({
    queryKey: ["aiStatus"],
    queryFn: () => getAiStatus(getToken),
    enabled: !!familyId,
    refetchInterval: false
  });

  const { messages, status, sendMessage } = useChat({ transport });

  const queriesRemaining = statusQuery.data?.queriesRemaining ?? 20;
  const isStreaming = status === "streaming" || status === "submitted";
  const isDisabled = isStreaming || queriesRemaining === 0 || !familyId;

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Refetch status after each completed response
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      void queryClient.invalidateQueries({ queryKey: ["aiStatus"] });
    }
  }, [status, messages.length, queryClient]);

  const createEventMutation = useMutation({
    mutationFn: ({ proposal }: { proposal: AiEventProposal }) =>
      createEvent(proposal.familyId, {
        title: proposal.title,
        startAt: proposal.startAt,
        endAt: proposal.endAt,
        locationName: proposal.locationName,
        description: proposal.description
      }, getToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    }
  });

  function handleSend(text: string) {
    if (!familyId || isDisabled) return;
    void sendMessage({ text }, { body: { familyGroupId: familyId } });
  }

  if (familiesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] p-6 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Family Assistant</h1>
        {statusQuery.data && (
          <RateLimitBadge queriesRemaining={queriesRemaining} />
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col justify-end flex-1 pb-2">
            <SuggestedPrompts onSelect={handleSend} />
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onConfirmEvent={(proposal) =>
                createEventMutation.mutate({ proposal })
              }
              onCancelEvent={() => {
                // No action needed — the UI simply stops showing the card
              }}
            />
          ))
        )}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-slate-800/80 px-4 py-2.5 text-sm text-slate-400 animate-pulse">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isDisabled}
        placeholder={
          queriesRemaining === 0
            ? "Daily limit reached"
            : "Ask about your family…"
        }
      />
    </div>
  );
}
