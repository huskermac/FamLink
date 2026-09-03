import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import FamilyDetailPage from "../page";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ familyId: "fam1" }) }));
vi.mock("@/lib/api/family", () => ({ getFamilyDetails: vi.fn(), getMyFamilies: vi.fn() }));

// Stub the admin-gated children so this test isolates the PAGE's gating decision, not the
// children's own internals (those are covered by AddMemberForm.test.tsx / HouseholdSection.test.tsx).
vi.mock("@/components/family/AddMemberForm", () => ({
  AddMemberForm: () => <div>AddMemberFormStub</div>
}));
// HouseholdSection mounts for every viewer (it shows linked family names to non-admins too —
// see HouseholdSection.test.tsx); the stub echoes the isAdmin prop so this test can verify the
// page passes the correct value down, rather than asserting it is unmounted for a non-admin.
vi.mock("@/components/family/HouseholdSection", () => ({
  HouseholdSection: ({ isAdmin }: { isAdmin: boolean }) => <div>HouseholdSectionStub:{String(isAdmin)}</div>
}));

const queryData: Record<string, unknown> = {};
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryData[String(queryKey[0])],
    isLoading: false,
    isError: false
  })
}));

const familyDetail = {
  familyGroup: { id: "fam1", name: "The Test Family", createdById: "p1" },
  members: [],
  households: [
    { household: { id: "h1", name: "Home" }, members: [] }
  ]
};

beforeEach(() => {
  queryData["family"] = familyDetail;
});

describe("FamilyDetailPage admin gating", () => {
  it("renders AddMemberForm and passes isAdmin=true to HouseholdSection for an admin viewer", () => {
    queryData["my-families"] = [{ familyGroup: { id: "fam1" }, role: "ADMIN", roles: ["ADMIN"] }];
    render(<FamilyDetailPage />);
    expect(screen.getByText("AddMemberFormStub")).toBeInTheDocument();
    expect(screen.getByText("HouseholdSectionStub:true")).toBeInTheDocument();
  });

  it("hides AddMemberForm but still mounts HouseholdSection (isAdmin=false) for a non-admin viewer", () => {
    queryData["my-families"] = [{ familyGroup: { id: "fam1" }, role: "MEMBER", roles: ["MEMBER"] }];
    render(<FamilyDetailPage />);
    expect(screen.queryByText("AddMemberFormStub")).toBeNull();
    // HouseholdSection must still mount for a non-admin — it shows linked family names to every
    // viewer and only hides its own Activity/unlink internally (see HouseholdSection.test.tsx).
    expect(screen.getByText("HouseholdSectionStub:false")).toBeInTheDocument();
  });
});
