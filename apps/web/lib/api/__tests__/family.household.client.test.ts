import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPerson,
  addFamilyMember,
  getHousehold,
  getHouseholdAudit,
  unlinkHousehold
} from "@/lib/api/family";

const getToken = () => Promise.resolve("tok");
const originalEnv = process.env.NEXT_PUBLIC_API_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});
function mockFetch(ok: boolean, body: unknown) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body)
  });
}

describe("family household + person client", () => {
  it("createPerson POSTs the name and family id", async () => {
    mockFetch(true, { id: "p1", firstName: "Jo", lastName: "Doe" });
    await createPerson({ firstName: "Jo", lastName: "Doe", familyGroupId: "fam1" }, getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/persons");
    expect(JSON.parse(init.body as string)).toMatchObject({ firstName: "Jo", lastName: "Doe", familyGroupId: "fam1" });
  });

  it("addFamilyMember POSTs personId with a default MEMBER role", async () => {
    mockFetch(true, { id: "m1", personId: "p1" });
    await addFamilyMember("fam1", "p1", getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/families/fam1/members");
    expect(JSON.parse(init.body as string)).toEqual({ personId: "p1", roles: ["MEMBER"] });
  });

  it("getHousehold GETs the detail", async () => {
    mockFetch(true, { id: "h1", name: "Home", linkedFamilies: [{ name: "The Smiths" }], members: [] });
    const r = await getHousehold("h1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://localhost:4000/api/v1/households/h1");
    expect(r.linkedFamilies[0].name).toBe("The Smiths");
  });

  it("getHouseholdAudit GETs the audit entries", async () => {
    mockFetch(true, { entries: [] });
    await getHouseholdAudit("h1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://localhost:4000/api/v1/households/h1/audit");
  });

  it("unlinkHousehold POSTs the family id and destroy flag", async () => {
    mockFetch(true, "");
    await unlinkHousehold("h1", { familyGroupId: "fam1", destroy: true }, getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/households/h1/unlink");
    expect(JSON.parse(init.body as string)).toEqual({ familyGroupId: "fam1", destroy: true });
  });
});
