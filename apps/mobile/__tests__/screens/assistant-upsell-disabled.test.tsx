import { render, screen } from "@testing-library/react-native";
import AssistantScreen from "../../app/(tabs)/assistant/index";

jest.mock("@clerk/clerk-expo", () => ({ useAuth: () => ({ getToken: jest.fn() }) }));
jest.mock("@ai-sdk/react", () => ({ useChat: () => ({ messages: [], status: "ready", sendMessage: jest.fn() }) }));
jest.mock("../../hooks/useFamily", () => ({ useMyFamilies: () => ({ data: { memberships: [{ familyGroup: { id: "fg1", name: "Fam" } }] } }) }));

const mockUseAiStatus = jest.fn();
jest.mock("../../hooks/useAiStatus", () => ({ useAiStatus: () => mockUseAiStatus() }));
jest.mock("../../lib/config", () => ({ API_BASE: "http://x", WEB_BASE: "http://web", ENABLE_WEB_UPSELL: false }));

beforeEach(() => {
  mockUseAiStatus.mockReturnValue({ data: { queriesRemaining: 2, effectiveLimit: 3, covered: false, foreignContext: true } });
});

it("hides upgrade CTA when ENABLE_WEB_UPSELL is false (flag off)", () => {
  render(<AssistantScreen />);
  // Usage badge should still be present
  expect(screen.getByText(/2 \/ 3 AI queries left today/)).toBeTruthy();
  // But upgrade CTA must NOT be rendered
  expect(screen.queryByText(/Upgrade this family/)).toBeNull();
});
