import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ReactNode } from "react";
import { useCalendarMonth } from "../../hooks/useCalendar";

jest.mock("../../lib/api", () => ({ useApiFetch: jest.fn() }));
import { useApiFetch } from "../../lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCalendarMonth", () => {
  it("fetches calendar data for the given month", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      month: "2026-05",
      events: [{ id: "e1", title: "Family Dinner", startAt: "2026-05-10T18:00:00.000Z", isBirthdayEvent: false }]
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useCalendarMonth("fam1", 2026, 5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/families/fam1/calendar?month=2026-05");
    expect(result.current.data?.events[0].title).toBe("Family Dinner");
  });

  it("is disabled when familyId is null", () => {
    const mockFetch = jest.fn();
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useCalendarMonth(null, 2026, 5), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
