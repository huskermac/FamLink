import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import { useMembers, useMyFamilies, useMyPerson, usePerson, usePersonRelationships, useIsFamilyAdmin } from "../../hooks/useFamily";

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
      members: [{ person: { id: "p1", firstName: "Jane", lastName: "Smith", preferredName: null, dateOfBirth: null, ageGateLevel: "ADULT", profilePhotoUrl: null, createdAt: "", updatedAt: "" }, roles: ["MEMBER"], joinedAt: "" }],
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

describe("usePersonRelationships", () => {
  it("fetches /api/v1/persons/:personId/relationships", async () => {
    const mockFetch = jest.fn().mockResolvedValue([
      { id: "r1", fromPersonId: "p1", toPersonId: "p2", type: "SPOUSE", relatedPerson: { displayName: "John Smith", ageGateLevel: "ADULT" } },
    ]);
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => usePersonRelationships("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/p1/relationships");
    expect(result.current.data?.[0].type).toBe("SPOUSE");
  });
});

describe("useIsFamilyAdmin", () => {
  function mockFamilies(memberships: Array<{ id: string; roles: string[] }>) {
    const mockFetch = jest.fn().mockResolvedValue({
      memberships: memberships.map((m) => ({ familyGroup: { id: m.id, name: "F" }, roles: m.roles, joinedAt: "" })),
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
  }
  it("true when the membership for the family has ADMIN or ORGANIZER", async () => {
    mockFamilies([{ id: "famA", roles: ["ADMIN"] }]);
    const { result } = renderHook(() => useIsFamilyAdmin("famA"), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("false for a non-admin membership, and false for null family", async () => {
    mockFamilies([{ id: "famA", roles: ["MEMBER"] }]);
    const { result: r1 } = renderHook(() => useIsFamilyAdmin("famA"), { wrapper });
    await waitFor(() => expect(r1.current).toBe(false));
    const { result: r2 } = renderHook(() => useIsFamilyAdmin(null), { wrapper });
    expect(r2.current).toBe(false);
  });
});
