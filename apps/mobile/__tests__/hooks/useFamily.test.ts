import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import { useMembers, useMyFamilies, useMyPerson, usePerson } from "../../hooks/useFamily";

jest.mock("../../lib/api", () => ({
  useApiFetch: jest.fn(),
}));

import { useApiFetch } from "../../lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useMyFamilies", () => {
  it("fetches /api/v1/persons/me/families", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ memberships: [{ familyGroup: { id: "fam1", name: "Smiths" }, roles: ["MEMBER"], joinedAt: "2025-01-01T00:00:00.000Z" }] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMyFamilies(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/me/families");
    expect(result.current.data?.memberships[0].familyGroup.id).toBe("fam1");
  });
});

describe("useMembers", () => {
  it("fetches /api/v1/families/:familyId", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      familyGroup: { id: "fam1", name: "Smiths" },
      members: [{ person: { id: "p1", firstName: "Jane", lastName: "Smith", preferredName: null, dateOfBirth: null, ageGateLevel: "NONE", profilePhotoUrl: null, createdAt: "", updatedAt: "" }, roles: ["MEMBER"], joinedAt: "" }],
      households: []
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMembers("fam1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/families/fam1");
    expect(result.current.data?.members[0].person.firstName).toBe("Jane");
  });

  it("is disabled when familyId is null", () => {
    const mockFetch = jest.fn();
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMembers(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("usePerson", () => {
  it("fetches /api/v1/persons/:personId", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "p1", firstName: "Jane", lastName: "Smith" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => usePerson("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/p1");
  });
});

describe("useMyPerson", () => {
  it("fetches /api/v1/persons/me", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "p1", firstName: "Jane", lastName: "Smith" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMyPerson(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/me");
    expect(result.current.data?.id).toBe("p1");
  });
});
