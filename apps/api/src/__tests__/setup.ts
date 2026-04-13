import { vi } from "vitest";

/**
 * Resettable mocked Prisma client for Phase 2 unit tests.
 * Usage in a test file:
 *   vi.mock("@famlink/db", () => ({ db: mockPrisma }));
 *   beforeEach(() => vi.clearAllMocks());
 */
export const mockPrisma = {
  person: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  familyGroup: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn()
  },
  relationship: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn()
  },
  event: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  familyMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn()
  }
};
