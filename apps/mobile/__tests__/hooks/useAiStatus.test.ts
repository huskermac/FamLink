import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useAiStatus } from "../../hooks/useAiStatus";

const mockApiFetch = jest.fn();
jest.mock("../../lib/api", () => ({ useApiFetch: () => mockApiFetch }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => mockApiFetch.mockReset());

it("fetches status for the given family", async () => {
  mockApiFetch.mockResolvedValue({ queriesRemaining: 2, effectiveLimit: 3, covered: false, foreignContext: true });
  const { result } = renderHook(() => useAiStatus("fg1"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/ai/status?familyGroupId=fg1");
  expect(result.current.data?.foreignContext).toBe(true);
});

it("is disabled and does not fetch when familyId is null", () => {
  const { result } = renderHook(() => useAiStatus(null), { wrapper });
  expect(result.current.fetchStatus).toBe("idle");
  expect(mockApiFetch).not.toHaveBeenCalled();
});
