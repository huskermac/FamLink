# Graph Traversal Spike Results
## Date: 2026-04-13
## Dataset: Johnson family seed data (7 people, 32 relationships, 1 event, 5 RSVPs)

---

### Query 1 — Direct family members (1-hop)
- **Execution time:** 1459ms
- **Result count:** 6 persons (excluding self)
- **Required raw SQL:** NO
- **SQL complexity notes:** Simple JOIN through FamilyMember → Person. Prisma `findMany` with `include` is sufficient. Generated SQL is a single LEFT JOIN.
- **Prisma ORM sufficient:** YES

---

### Query 2 — Household members
- **Execution time:** 1766ms
- **Result count:** 3 co-residents (excluding self)
- **Required raw SQL:** NO
- **SQL complexity notes:** Two-step Prisma query: find person's households, then find all members in those households. Two round trips but both are simple indexed lookups. Could be optimized to a single raw query if needed; at family scale, two round trips is acceptable.
- **Prisma ORM sufficient:** YES

---

### Query 3 — Relationship path (2-hop traversal)
- **Execution time:** 221ms
- **Result count:** 5 path(s) found (Sarah → Margaret)
- **Shortest path depth:** 2
- **Shortest path types:** SPOUSE → CHILD
- **Required raw SQL:** YES — `WITH RECURSIVE` CTE required
- **SQL complexity notes:** Prisma ORM **cannot express recursive graph traversal natively**. A `WITH RECURSIVE` CTE was required. The CTE anchors at the start node, extends one hop per iteration via a self-join on `Relationship`, and uses `ARRAY[...]` accumulation to detect cycles and track the path. This is standard PostgreSQL recursive query syntax and performs well at family scale.
- **Prisma ORM sufficient:** NO — raw SQL required via `db.$queryRaw`

---

### Query 4 — RSVP aggregation across family
- **Execution time:** 660ms
- **Result count:** 2 status groups
- **RSVP breakdown:** YES=4, PENDING=3
- **Required raw SQL:** NO
- **SQL complexity notes:** Two Prisma queries (FamilyMember fan-out + RSVP lookup), joined in application code. At family scale (<50 members) this is adequate. For larger groups, a single JOIN query would be more efficient.
- **Prisma ORM sufficient:** YES (with application-layer join)

---

## Recommendation

**STAY ON POSTGRESQL**

All four queries run successfully against the Johnson family seed data (7 people, 32 relationships). Execution times are well within acceptable range for a family-scale dataset.

**Rationale:**
- Queries 1, 2, and 4 are fully expressible with Prisma ORM and perform well.
- Query 3 (multi-hop traversal) requires a `WITH RECURSIVE` CTE via `db.$queryRaw`, but this is a known PostgreSQL capability that is well-documented and easily encapsulated in a helper function (e.g., `lib/graph.ts`). The CTE is not significantly more complex than what a graph DB would provide via Cypher or Gremlin — and we avoid adding an entirely new infrastructure component.
- Family-scale graphs (< 50 nodes, < 200 edges per family group) are well within PostgreSQL's recursive CTE performance envelope. The query planner uses the `Relationship(fromPersonId)` index for the join predicate.
- The only raw SQL exposure is in one well-defined traversal function. This can be wrapped and tested in isolation, keeping production code clean.

**Implication for P2-03 (AI tools):** The `get_relationship_path` Layer 1 tool **must** use `db.$queryRaw` with the `WITH RECURSIVE` CTE pattern from this spike. All other Layer 1 tools can use Prisma ORM.
