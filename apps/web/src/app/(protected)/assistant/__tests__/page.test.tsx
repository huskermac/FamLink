import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UIMessage } from "ai";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("token") })
}));

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => unknown }) => mockUseQuery(opts),
  useMutation: (opts: { mutationFn: () => unknown }) => mockUseMutation(opts),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries })
}));

vi.mock("@/lib/api/family", () => ({ getMyFamilies: vi.fn() }));
vi.mock("@/lib/api/assistant", () => ({ getAiStatus: vi.fn() }));
vi.mock("@/lib/api/events", () => ({ createEvent: vi.fn() }));

// Capture sendMessage so tests can invoke it
let capturedSendMessage: ((text: string, options?: unknown) => void) | null = null;
let mockStatus = "ready";
let mockMessages: UIMessage[] = [];

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mockMessages,
    status: mockStatus,
    sendMessage: (msg: { text: string }, opts: unknown) => {
      capturedSendMessage = (text: string, options?: unknown) =>
        void Promise.resolve({ text, options });
      capturedSendMessage(msg.text, opts);
    }
  })
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor() {}
  }
}));

vi.mock("@/components/assistant/MessageBubble", () => ({
  MessageBubble: ({ message }: { message: UIMessage }) => (
    <div data-testid="message-bubble">{message.id}</div>
  )
}));

vi.mock("@/components/assistant/ChatInput", () => ({
  ChatInput: ({
    onSend,
    disabled
  }: {
    onSend: (text: string) => void;
    disabled: boolean;
  }) => (
    <button
      data-testid="chat-input-send"
      disabled={disabled}
      onClick={() => onSend("test message")}
    >
      Send
    </button>
  )
}));

vi.mock("@/components/assistant/RateLimitBadge", () => ({
  RateLimitBadge: ({ queriesRemaining }: { queriesRemaining: number }) => (
    <div data-testid="rate-limit-badge">{queriesRemaining}</div>
  )
}));

vi.mock("@/components/assistant/SuggestedPrompts", () => ({
  SuggestedPrompts: ({ onSelect }: { onSelect: (p: string) => void }) => (
    <div data-testid="suggested-prompts">
      <button onClick={() => onSelect("When is Dad's birthday?")}>Prompt</button>
    </div>
  )
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAMILY_ID = "fam1";

function setupQueries({
  aiRemaining = 20,
  showAiStatus = true
} = {}) {
  mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey[0];
    if (key === "families") {
      return {
        data: [{ familyGroup: { id: FAMILY_ID } }],
        isLoading: false
      };
    }
    if (key === "aiStatus") {
      return showAiStatus
        ? { data: { queriesUsedToday: 20 - aiRemaining, queriesRemaining: aiRemaining, resetAt: "" }, isLoading: false }
        : { data: undefined, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedSendMessage = null;
  mockStatus = "ready";
  mockMessages = [];
});

describe("AssistantPage", () => {
  it("renders the page heading", async () => {
    setupQueries();
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByText("Family Assistant")).toBeInTheDocument()
    );
  });

  it("shows SuggestedPrompts when no messages exist", async () => {
    setupQueries();
    mockMessages = [];
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByTestId("suggested-prompts")).toBeInTheDocument()
    );
  });

  it("shows messages when conversation is underway", async () => {
    setupQueries();
    mockMessages = [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] }];
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByTestId("message-bubble")).toBeInTheDocument()
    );
  });

  it("shows RateLimitBadge when AI status is loaded", async () => {
    setupQueries({ aiRemaining: 15 });
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByTestId("rate-limit-badge")).toBeInTheDocument()
    );
    expect(screen.getByTestId("rate-limit-badge")).toHaveTextContent("15");
  });

  it("disables ChatInput when queries are exhausted", async () => {
    setupQueries({ aiRemaining: 0 });
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByTestId("chat-input-send")).toBeDisabled()
    );
  });

  it("disables ChatInput while streaming", async () => {
    setupQueries();
    mockStatus = "streaming";
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByTestId("chat-input-send")).toBeDisabled()
    );
  });

  it("shows loading state while families are loading", async () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() });
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true });
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("calls sendMessage when ChatInput fires onSend", async () => {
    setupQueries();
    const { default: AssistantPage } = await import("@/app/(protected)/assistant/page");
    render(<AssistantPage />);
    await waitFor(() =>
      expect(screen.getByTestId("chat-input-send")).toBeInTheDocument()
    );
    await act(async () => {
      screen.getByTestId("chat-input-send").click();
    });
    expect(capturedSendMessage).not.toBeNull();
  });
});
