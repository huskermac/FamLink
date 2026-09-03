import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const refetch = vi.fn();
let queryResult: { data: unknown; refetch: () => void } = { data: { requests: [{}, {}] }, refetch };
vi.mock("@tanstack/react-query", () => ({ useQuery: () => queryResult }));

import { useLinkRequestCount } from "@/hooks/useLinkRequestCount";

describe("useLinkRequestCount", () => {
  it("returns the pending count", () => {
    queryResult = { data: { requests: [{}, {}, {}] }, refetch };
    const { result } = renderHook(() => useLinkRequestCount());
    expect(result.current).toBe(3);
  });

  it("returns 0 when there is no data", () => {
    queryResult = { data: undefined, refetch };
    const { result } = renderHook(() => useLinkRequestCount());
    expect(result.current).toBe(0);
  });

  it("refetches on a path change but not on the initial mount", () => {
    refetch.mockClear();
    queryResult = { data: { requests: [] }, refetch };
    pathname = "/dashboard";
    const { rerender } = renderHook(() => useLinkRequestCount());
    expect(refetch).toHaveBeenCalledTimes(0); // initial mount: useQuery already fetched
    pathname = "/requests";
    rerender();
    expect(refetch).toHaveBeenCalledTimes(1); // path changed
  });
});
