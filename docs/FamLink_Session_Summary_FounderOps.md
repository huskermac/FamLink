# FamLink — Founder Operations Session Summary
**Date:** April 13, 2026  
**Topics:** Legal Entity Formation · Domain Name · Accounting · Secrets Management

---

## 1. Legal Entity Formation

### Decision
**Use Clerky** for Delaware C-Corp formation.

### Recommendation
- **Package:** Lifetime Package (~$819) — covers formation plus all future legal templates (SAFEs, advisor agreements, offer letters, CIIAs, board consents). Paying à la carte erodes the cost advantage given the investor trajectory.
- **Formation timeline:** 1–3 business days after filing with Delaware.

### Cost Summary
| Item | Estimated Cost |
|---|---|
| Clerky Lifetime Package | ~$819 |
| Nebraska foreign qualification | ~$160–$200 |
| Delaware franchise tax (annual, due March 1) | ~$90 |
| **Total initial** | **~$1,100** |

### Critical Post-Incorporation Checklist
- [ ] Elect directors, appoint officers
- [ ] Adopt bylaws
- [ ] Issue founder stock with vesting schedule
- [ ] **File 83(b) election with IRS within 30 days of stock grant** — missing this window has significant tax consequences
- [ ] Execute CIIA (IP assignment) for all founders including spouse
- [ ] Document any spouse equity treatment with board consent before investor conversations
- [ ] Foreign qualify in Nebraska (~$160–$200 via Clerky partner)
- [ ] Obtain EIN (available almost instantly online for US SSN holders)

### Services Evaluated
| Service | Verdict |
|---|---|
| **Clerky** | ✅ Recommended — startup-specific, lawyer-grade docs, Lifetime Package value |
| Stripe Atlas | Acceptable — bundled/faster but fewer post-formation templates |
| LegalZoom / Incfile | Not recommended for investor-track startups |

### Open Item
**Corporate name is unresolved.** "FamLink" was assessed as a weak legal name (see Section 2 and Section 5).

---

## 2. Domain Name

### Current Status
- `famlink.com` is taken; prior art on the FamLink brand exists.
- Brand/naming decision has been tabled in the ADR — this session surfaced it as a blocking issue for Clerky.

### Strategy
For an investor-track platform, a clean `.com` is strongly preferred. If unavailable for the chosen name, `.co` and `.app` are acceptable fallbacks used by funded startups. Avoid `.family` — reads as a personal family site, not a product company.

### Name Candidates (from this session)
| Name | Domain(s) to Check | Notes |
|---|---|---|
| **KinOS** | kinos.com / kinos.io | "Kin" = family, "OS" = operating system. Short, defensible, investor-legible |
| **FamilyOS** | familyos.com / familyos.app | Explicit positioning, consumer-friendly |
| **Rootwork** | rootwork.com / rootwork.io | "Roots" = lineage, "work" = coordination |
| **HomeGraph** | homegraph.com / homegraph.io | Graph-forward, family-forward |
| **KinLink** | kinlink.com | Preserves "Link" from FamLink; avoids prior art issue |
| **FamOS** | famos.com / famos.io | Very short; OS positioning |
| **Kinfull** | kinfull.com | Softer, consumer-friendly tone |

### Tools for Availability Checking
- [Instant Domain Search](https://instantdomainsearch.com) — bulk checking across TLDs
- [Namecheap](https://namecheap.com) — registrar with clean UX
- [Porkbun](https://porkbun.com) — competitive pricing, no dark patterns
- [USPTO TESS](https://tmsearch.uspto.gov) — trademark availability check (do this alongside domain check)

### Recommended Registrar
**Cloudflare Registrar** or **Porkbun** — at-cost or near-at-cost pricing. Avoid GoDaddy (renewal pricing and upsell patterns).

### Corporate Name vs. Product Brand
The corporate legal name and the consumer product brand **do not need to be the same.** Many successful companies incorporate under a neutral legal name and operate under a different product brand. See Section 5 for full analysis.

---

## 3. Accounting System

### Decision
**QuickBooks Online Simple Start** (~$35/month) — start here, not Wave.

### Rationale
- Universal CPA/bookkeeper compatibility — nearly every external accountant knows QBO
- Scales without migration through at least $2–4M revenue
- Wave is free but limited to one user, lacks scalability, and forces a messy migration before investor conversations

### Setup Instructions (Day One)
1. **Chart of accounts** — use a SaaS-startup chart, not QBO's default small-business template. Separate R&D from G&A. Enables R&D tax credit tracking and investor-standard reporting.
2. **Accounting method** — set to **accrual basis**, not cash. Investors expect accrual; avoids restatement conversation later.
3. **Connect business bank account** — auto-imports and categorizes all transactions.
4. **Receipt capture** — photograph every software subscription, service fee, and tool purchase via QBO mobile app. Paper trail for both tax and due diligence.
5. **Capitalized software development costs** — set up separate tracking category. IRS rules under ASC 350 distinguish capitalized vs. expensed development costs. CPA should guide setup; QBO can track it if configured from day one.

### Recommended Banking
**Mercury** — dominant startup banking choice, integrates natively with QBO, no fees.

### Cost Ladder
| Stage | Tool | Monthly Cost |
|---|---|---|
| Pre-revenue / early | QBO Simple Start | ~$35 |
| Post-seed, adding payroll | QBO Plus | ~$90 |
| Series A+ | Xero Premium or QBO Advanced | $70–$235 |
| $8M+ revenue | NetSuite | $3,000–$8,000+ |

---

## 4. Secrets Management

### Decision
**Infisical** — cloud-hosted free tier to start; self-hostable if compliance needs change.

### Why Infisical
- Open-source (MIT license), full audit trail, version history with one-click rollback
- Free for single developer; team tier at ~$6/user/month when onboarding contractors
- Can generate `.env` files on demand for tools that require them
- Native GitHub Actions integration — secrets injected at CI/CD runtime, never stored in GitHub Secrets
- Self-hosted option available (Docker Compose or Helm) for future compliance requirements

### How It Works (Conceptual)
Infisical replaces your local `.env` files by storing all secrets centrally in a project/environment hierarchy. Secrets are never written to disk during development — they are injected as environment variables at runtime.

```
famlink (project)
├── development
│   ├── DATABASE_URL
│   ├── CLERK_SECRET_KEY
│   ├── CLERK_PUBLISHABLE_KEY
│   ├── CLERK_WEBHOOK_SECRET
│   ├── GUEST_TOKEN_SECRET
│   ├── RESEND_API_KEY
│   ├── TWILIO_ACCOUNT_SID / AUTH_TOKEN
│   ├── ANTHROPIC_API_KEY
│   └── OPENAI_API_KEY
├── staging
└── production
```

### Workflow Changes
| Current | With Infisical |
|---|---|
| `npm run dev` (reads `.env` from disk) | `infisical run -- npm run dev` (injects from vault) |
| `.env` file on disk | No `.env` on disk during development |
| Cursor needs a `.env` | `infisical export --format dotenv > .env` (on demand) |
| GitHub Actions secrets manually set | Infisical GitHub Actions integration (runtime fetch) |
| Railway env vars set manually | Sync via Infisical CLI in deploy hook |

### Migration Steps (One-Time, ~1 Hour)
1. Install Infisical CLI: `brew install infisical/get-infisical/infisical`
2. Create account at [infisical.com](https://infisical.com) (free)
3. Create project: `famlink`, environment: `development`
4. Manually input all current keys from `.env` into Infisical dashboard
5. Delete `.env` from local disk
6. Update root `package.json` scripts to prefix with `infisical run --`
7. Add `.env` to `.gitignore` if not already present (it should be)

*Note: A full migration document with updated npm scripts can be generated as a project document when ready to execute.*

---

## 5. Corporate Name vs. Product Brand

### The Direct Answer
**No — the corporate legal name does not need to directly relate to the product brand.** This is common practice among technology companies.

### How It Works
The Delaware C-Corp is a legal container. The product can operate under a separate **DBA (Doing Business As)**, also called a trade name. In practice, many companies incorporate under a neutral or descriptive holding-company name and operate their consumer product under a distinct brand.

### Why This Matters for FamLink
- "FamLink" was assessed as a weak brand: slang-adjacent, overused "-Link" suffix, prior art risk
- The corporate name filed with Delaware appears on: stock certificates, investor agreements, term sheets, and tax filings — it needs to be clean and defensible
- The product brand appears on: the app, the website, marketing, and user-facing materials — it needs to be memorable and ownable
- You can incorporate today under a strong legal name and launch the product under whatever brand wins the naming exercise

### Examples of Divergent Legal / Product Names
| Legal Entity | Product Brand |
|---|---|
| Meta Platforms, Inc. | Facebook, Instagram, WhatsApp |
| Alphabet Inc. | Google, YouTube, Waymo |
| Block, Inc. | Square, Cash App, TIDAL |

### Recommended Path
1. Choose a clean, trademark-safe corporate legal name — something like **Kinetic Family Systems, Inc.** or **Rootwork Technologies, Inc.** or simply **KinOS, Inc.** — and file it with Clerky now.
2. Continue the product brand naming exercise in parallel.
3. If the product brand eventually aligns with the legal name, no action needed. If it diverges, file a DBA in Nebraska under the product brand name (~$10–$50).

---

## Sequencing Summary

| Priority | Action | Status |
|---|---|---|
| 1 | Decide on corporate legal name | 🔴 Blocking — needed for Clerky |
| 2 | Check domain + trademark availability for candidates | 🔴 Blocking |
| 3 | Initiate Clerky formation | ⏳ Ready once name decided |
| 4 | Open Mercury business bank account | ⏳ After entity formed |
| 5 | Set up QuickBooks Online Simple Start | ⏳ After bank account |
| 6 | Set up Infisical, migrate secrets from `.env` | ⏳ Next build session |

---

*Document generated from session discussion — April 13, 2026*  
*Place in `/docs` in FamLink monorepo or retain as founder reference.*
