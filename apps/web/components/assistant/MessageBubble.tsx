"use client";

import type { UIMessage, DynamicToolUIPart } from "ai";
import { EventConfirmationCard } from "@/components/events/EventConfirmationCard";
import { ToolResultCard } from "@/components/assistant/ToolResultCard";
import type { AiEventProposal } from "@/lib/api/events";

interface Props {
  message: UIMessage;
  /** Called when the user confirms an AI-proposed event. */
  onConfirmEvent?: (proposal: AiEventProposal) => void;
  /** Called when the user cancels an AI-proposed event. */
  onCancelEvent?: () => void;
}

interface CreateEventOutput {
  proposed: true;
  event: {
    title: string;
    startTime: string;
    endTime: string | null;
    location: string | null;
    description: string | null;
    familyGroupId: string;
  };
  confirmationRequired: true;
  message: string;
}

function isCreateEventOutput(output: unknown): output is CreateEventOutput {
  if (typeof output !== "object" || output === null) return false;
  const o = output as Record<string, unknown>;
  return o.proposed === true && o.confirmationRequired === true && typeof o.event === "object";
}

function toAiEventProposal(output: CreateEventOutput): AiEventProposal {
  return {
    familyId: output.event.familyGroupId,
    title: output.event.title,
    startAt: output.event.startTime,
    endAt: output.event.endTime ?? undefined,
    locationName: output.event.location ?? undefined,
    description: output.event.description ?? undefined
  };
}

function renderToolPart(
  part: DynamicToolUIPart,
  onConfirmEvent?: (proposal: AiEventProposal) => void,
  onCancelEvent?: () => void
): React.ReactNode {
  if (part.state === "output-available") {
    if (part.toolName === "create_event" && isCreateEventOutput(part.output)) {
      const proposal = toAiEventProposal(part.output);
      return (
        <EventConfirmationCard
          proposal={proposal}
          onConfirm={() => onConfirmEvent?.(proposal)}
          onCancel={() => onCancelEvent?.()}
        />
      );
    }
    return <ToolResultCard toolName={part.toolName} output={part.output} />;
  }

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="text-xs text-slate-500 italic">
        Running {part.toolName.replace(/_/g, " ")}…
      </div>
    );
  }

  return null;
}

export function MessageBubble({ message, onConfirmEvent, onCancelEvent }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? "bg-indigo-600 text-white"
            : "bg-slate-800/80 text-slate-100"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap">
                {part.text}
              </p>
            );
          }
          if (part.type === "dynamic-tool") {
            return (
              <div key={i} className="mt-2">
                {renderToolPart(part, onConfirmEvent, onCancelEvent)}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
