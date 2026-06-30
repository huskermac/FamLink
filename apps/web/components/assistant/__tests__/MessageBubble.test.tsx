import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { UIMessage } from "ai";
import { MessageBubble } from "@/components/assistant/MessageBubble";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/events/EventConfirmationCard", () => ({
  EventConfirmationCard: ({
    proposal,
    onConfirm,
    onCancel
  }: {
    proposal: { title: string };
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="confirmation-card">
      <span>{proposal.title}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  )
}));

vi.mock("@/components/assistant/ToolResultCard", () => ({
  ToolResultCard: ({ toolName }: { toolName: string }) => (
    <div data-testid="tool-result-card">{toolName}</div>
  )
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function textMessage(text: string): UIMessage {
  return {
    id: "msg1",
    role: "user",
    parts: [{ type: "text", text }]
  };
}

function assistantMessage(text: string): UIMessage {
  return {
    id: "msg2",
    role: "assistant",
    parts: [{ type: "text", text }]
  };
}

function createEventMessage(title: string): UIMessage {
  return {
    id: "msg3",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "create_event",
        toolCallId: "tc1",
        state: "output-available",
        input: {},
        output: {
          proposed: true,
          confirmationRequired: true,
          message: "Please confirm",
          event: {
            title,
            startTime: "2026-07-04T18:00:00Z",
            endTime: null,
            location: "Mom's House",
            description: null,
            familyGroupId: "fam1"
          }
        }
      }
    ]
  };
}

function toolLoadingMessage(): UIMessage {
  return {
    id: "msg4",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "get_family_members",
        toolCallId: "tc2",
        state: "input-streaming",
        input: undefined
      }
    ]
  };
}

function genericToolMessage(toolName: string): UIMessage {
  return {
    id: "msg5",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName,
        toolCallId: "tc3",
        state: "output-available",
        input: {},
        output: { result: "some data" }
      }
    ]
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MessageBubble", () => {
  it("renders user text message", () => {
    render(<MessageBubble message={textMessage("Hello family!")} />);
    expect(screen.getByText("Hello family!")).toBeInTheDocument();
  });

  it("renders assistant text message", () => {
    render(<MessageBubble message={assistantMessage("Dad's birthday is July 4th.")} />);
    expect(screen.getByText("Dad's birthday is July 4th.")).toBeInTheDocument();
  });

  it("renders EventConfirmationCard for create_event tool output", () => {
    render(<MessageBubble message={createEventMessage("Summer BBQ")} />);
    expect(screen.getByTestId("confirmation-card")).toBeInTheDocument();
    expect(screen.getByText("Summer BBQ")).toBeInTheDocument();
  });

  it("calls onConfirmEvent with proposal when Confirm is clicked", async () => {
    const onConfirmEvent = vi.fn();
    render(
      <MessageBubble
        message={createEventMessage("Summer BBQ")}
        onConfirmEvent={onConfirmEvent}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirmEvent).toHaveBeenCalledOnce();
    expect(onConfirmEvent.mock.calls[0][0]).toMatchObject({
      title: "Summer BBQ",
      familyId: "fam1"
    });
  });

  it("calls onCancelEvent when Cancel is clicked", async () => {
    const onCancelEvent = vi.fn();
    render(
      <MessageBubble
        message={createEventMessage("Summer BBQ")}
        onCancelEvent={onCancelEvent}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancelEvent).toHaveBeenCalledOnce();
  });

  it("renders ToolResultCard for non-create_event tools", () => {
    render(<MessageBubble message={genericToolMessage("get_person")} />);
    expect(screen.getByTestId("tool-result-card")).toBeInTheDocument();
    expect(screen.getByText("get_person")).toBeInTheDocument();
  });

  it("shows loading indicator for streaming tool call", () => {
    render(<MessageBubble message={toolLoadingMessage()} />);
    expect(screen.getByText(/get family members/i)).toBeInTheDocument();
  });
});
