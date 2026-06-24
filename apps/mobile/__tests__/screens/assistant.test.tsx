import { render, screen, fireEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import AssistantScreen from "../../app/(tabs)/assistant/index";

jest.mock("@clerk/clerk-expo", () => ({ useAuth: () => ({ getToken: jest.fn() }) }));
jest.mock("@ai-sdk/react", () => ({ useChat: () => ({ messages: [], status: "ready", sendMessage: jest.fn() }) }));
jest.mock("../../hooks/useFamily", () => ({ useMyFamilies: () => ({ data: { memberships: [{ familyGroup: { id: "fg1", name: "Fam" } }] } }) }));

const mockUseAiStatus = jest.fn();
jest.mock("../../hooks/useAiStatus", () => ({ useAiStatus: () => mockUseAiStatus() }));
jest.mock("../../lib/config", () => ({ API_BASE: "http://x", WEB_BASE: "http://web", ENABLE_WEB_UPSELL: true }));

beforeEach(() => {
  mockUseAiStatus.mockReturnValue({ data: { queriesRemaining: 2, effectiveLimit: 3, covered: false, foreignContext: true } });
});

it("shows the usage badge", () => {
  render(<AssistantScreen />);
  expect(screen.getByText(/2 \/ 3 AI queries left today/)).toBeTruthy();
});

it("opens web billing when the upgrade CTA is pressed (flag on)", () => {
  const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
  render(<AssistantScreen />);
  fireEvent.press(screen.getByText(/Upgrade this family/));
  expect(spy).toHaveBeenCalledWith("http://web/settings/billing");
});
