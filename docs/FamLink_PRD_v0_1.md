# FamLink

*The Family Operating System*

**Product Requirements Document**

Version 0.1 — Working Draft

March 2026 | CONFIDENTIAL

---

## 1. Executive Summary

FamLink is a private, family-centric platform that serves as the coordination and communication layer for extended families. It combines a relationship graph (who is connected to whom and how), a shared event and calendar hub, and a progressive commerce layer into a single, private, family-owned digital space.

The platform addresses a clear and unmet need: families today coordinate birthdays, holidays, gift exchanges, sports schedules, travel, and life events across fragmented channels — group texts, email threads, spreadsheets, Evites, Amazon wishlists, and phone calls. No single product owns this coordination layer. FamLink intends to.

The target investor thesis: FamLink captures the coordination intent that already exists in every family and redirects the commerce that naturally follows — gifts, travel, catering, venues, photography — through an affiliate and partner commerce layer that monetizes without advertising.

| | |
|---|---|
| **Product Name** | FamLink (working title — domain TBD) |
| **Document Version** | 0.1 — Working Draft |
| **Date** | March 2026 |
| **Stage** | Pre-seed / MVP Planning |
| **Build Strategy** | AI-assisted development (Cursor / Claude Code) with small team |
| **Target MVP Timeline** | 6 – 12 months to investor-ready demo |
| **Primary Monetization** | Affiliate commerce + partner integrations (Phase 2) |
| **Freemium Model** | Free core tier; premium family subscription (Phase 2) |

---

## 2. Problem Statement

### 2.1 The Coordination Gap

Modern families are coordinating more than ever — across more households, more time zones, and more complex schedules — using tools built for other purposes. The result is a chronic, invisible tax on the one or two people in every family who absorb the coordination burden.

Consider what the average family organizer manages today:

- Holiday gatherings: who's coming, who's bringing what, dietary restrictions, RSVPs via text thread
- Birthdays: tracking dates across 15-30+ family members, often from memory or a personal spreadsheet
- Gift coordination: wishlists scattered across Amazon, email, and word-of-mouth; duplicate gifts are common
- Kids' schedules: sports, recitals, plays, school events — communicated via separate apps, coach texts, and flyers
- Travel and vacations: group trip planning via email threads and Google Docs not shared with everyone
- Life events: pregnancies, graduations, weddings, deaths — announced and coordinated via phone trees and text blasts

All of this coordination happens without a shared, persistent, private space. Every event requires re-establishing context. Every new family member requires re-introduction to every platform. The organizer's knowledge lives in her head, and when she's unavailable, nothing works.

### 2.2 Why Existing Platforms Fail Families

| Platform | What It Does | Why It Fails Families |
|---|---|---|
| Facebook / Groups | Social network with group features | Too public, too noisy, trust erosion, generational drop-off |
| WhatsApp / GroupMe | Group messaging | No structure, no history, no events, no relationship graph |
| Google Calendar | Shared calendar | Not family-aware, no relationship layer, no event coordination |
| Evite / Paperless Post | Single-event invitations | No persistence, no family graph, no ongoing coordination |
| Cozi / FamilyWall | Nuclear family apps | Nuclear household only, not extended family, limited features |
| Amazon Wishlists | Gift tracking | No coordination layer, no family context, not integrated |
| Ancestry / 23andMe | Genealogy | Historical only, no live coordination or communication |

The gap is not a lack of tools — it is the absence of a platform that understands family relationships as a graph, not a contact list, and builds coordination features on top of that graph.

---

## 3. Vision & Positioning

### 3.1 Product Vision

FamLink is the private operating system for family life — the place where every family member, at every age and technical comfort level, can participate in the coordination, celebration, and memory-making of their family, on their own terms.

### 3.2 Positioning Statement

| | |
|---|---|
| **For** | Families of all sizes and configurations |
| **Who** | Struggle to coordinate life events, schedules, gifts, and communication across multiple households and generations |
| **FamLink is** | A private, relationship-aware family platform |
| **That** | Brings together event coordination, shared calendars, family communication, and commerce in one private space |
| **Unlike** | Facebook Groups, WhatsApp threads, or generic calendar apps |
| **FamLink** | Understands family relationships structurally and builds coordination tools that reflect how families actually work |

### 3.3 Design Philosophy

- **Privacy first.** Families share private, sensitive information. FamLink is never ad-supported. User data is never sold. Privacy is enforced at the data layer, not just the UI.
- **Inclusive by design.** If Grandma can't use it, it has failed. Every core action must be completable via email or SMS for non-app users.
- **Earn the commerce.** FamLink monetizes by adding genuine value to family purchasing — not by inserting ads. Affiliate commerce is earned through coordination utility, not imposed.
- **The organizer wins.** Every feature should measurably reduce the effort of the person who currently carries the family coordination burden.

---

## 4. User Personas

FamLink is designed for four primary personas at launch. Every feature and UX decision must be evaluated against all four.

### 4.1 The Organizer (Primary / Anchor User)

| | |
|---|---|
| **Who she is** | Mom, aunt, grandmother — the person who runs the holidays, remembers every birthday, and manages the family calendar. Usually 35–60 years old. May or may not be highly technical. |
| **Her pain** | Spends enormous invisible effort tracking family schedules, coordinating events, managing gift lists, and ensuring no one is left out — using a patchwork of texts, emails, and personal memory. |
| **Her motivation** | Reduce the cognitive and logistical burden of family coordination. Be recognized for the role she plays. Have a tool that actually helps rather than creating more work. |
| **Her success metric** | She creates an event and every invited family member knows about it, RSVPs, and has what they need — without her following up individually. |
| **Critical requirements** | Fast event creation. Easy invitation of reluctant/low-tech members. Clear RSVP visibility. Gift list management. Birthday reminders. |

### 4.2 The Reluctant Member

| | |
|---|---|
| **Who they are** | Uncle Dave, Grandpa, the cousin who never downloads apps. Any age. Resistant to creating accounts or installing software. Participates only when the barrier is near zero. |
| **Their pain** | They are constantly asked to join new platforms and resist. They don't want to manage another account. They miss family things because they won't install the app. |
| **Their motivation** | Minimal. They participate for the family relationship, not the product. The product must get out of their way. |
| **Their success metric** | They receive an event invitation via text or email, can RSVP with one click, and get reminders without ever creating an account. |
| **Critical requirements** | SMS/email participation without app install. One-click RSVP. No forced account creation for read-only participation. Graceful upgrade path if they choose to engage more. |

### 4.3 The Grandparent

| | |
|---|---|
| **Who they are** | 60–80+ years old. High emotional investment in family. Variable but generally low technical comfort. Smartphone user but not a power user. Deeply motivated by staying connected. |
| **Their pain** | Feel out of the loop. Miss announcements. Can't keep up with grandchildren's schedules. Worry about being forgotten or irrelevant. |
| **Their motivation** | Stay connected to family. See photos. Know what's happening. Feel included. |
| **Their success metric** | They can see upcoming family events, view photos, and know when grandchildren have activities — without technical frustration. |
| **Critical requirements** | Large text / accessible UI option. Simple navigation. Photo access without complexity. Push notifications for important events. No tech jargon. |

### 4.4 The Co-Parent

| | |
|---|---|
| **Who they are** | Parent managing children's schedules across households. May be divorced or separated. Coordinating with an ex-partner, grandparents, step-parents, and coaches. |
| **Their pain** | Schedule confusion across households. Children miss events because information didn't transfer. Conflict when coordination fails. |
| **Their motivation** | Reduce scheduling conflict. Keep children's activities visible to all relevant parties. Professional-grade coordination without personal friction. |
| **Their success metric** | Children's schedules are visible to all appropriate parties. Reminders go to the right people. No event falls through the cracks. |
| **Critical requirements** | Granular sharing controls. Household vs. family-level visibility. Neutral, child-centered framing. Integration with sports and school schedules. |

---

## 5. Core Concepts & Data Model

### 5.1 The Family Graph

FamLink's foundational data structure is a relationship graph. Everything in the product is built on top of this graph. Users are nodes; relationships are edges; groups (families, households) are subgraphs.

#### Node Types

| Node Type | Description | Examples |
|---|---|---|
| Person | An individual user or family member (may or may not have an account) | Sarah, Grandpa Joe, Baby Emma |
| Household | A physical living unit — people who share a home | The Smith Household, The Denver Apartment |
| Family | An extended family group spanning multiple households | The Smith-Johnson Family |
| School | An educational institution connected to family members | Lincoln Elementary, State University |
| Team / Group | A sports team, club, or activity group | U10 Soccer, Drama Club |
| Venue | A physical location relevant to events | Grandma's House, The Lodge |

#### Edge Types (Relationships)

| Relationship | Between | Notes |
|---|---|---|
| Spouse / Partner | Person ↔ Person | Current or former; supports blended families |
| Parent / Child | Person ↔ Person | Biological, adoptive, step |
| Sibling | Person ↔ Person | Full, half, step |
| Grandparent / Grandchild | Person ↔ Person | Auto-derived or manually set |
| Member Of | Person ↔ Household | Current residence |
| Member Of | Person ↔ Family | Extended family membership |
| Attends | Person ↔ School / Team | Student, player, participant |
| Caregiver | Person ↔ Person | Nanny, guardian, caretaker |

#### Role System

Each person can hold multiple roles within the family graph. Roles are contextual and user-assigned. Examples include: Mother, Father, Daughter, Son, Sister, Brother, Aunt, Uncle, Cousin, Grandmother, Grandfather, Step-parent, Step-child, Caregiver, Family Friend. Roles determine notification defaults and UI presentation but do not restrict access independently — permissions are governed separately.

### 5.2 Privacy & Permissions Model

Privacy is enforced at the data layer. The following visibility tiers govern all content in FamLink:

| Tier | Visible To | Example Use |
|---|---|---|
| Private | Only the creating user | Personal notes on a gift idea |
| Household | All members of a specific household | Chore schedule, household budget events |
| Family | All members of the extended family group | Holiday gathering invite, family photo album |
| Invited | Specific named individuals only | Medical appointment shared with spouse only |
| Guest | Non-account holders via link/SMS/email | RSVP link sent to Reluctant Members |

---

## 6. MVP Feature Scope

The MVP is defined as the minimum set of features that delivers the core value proposition to the Organizer persona, supports participation by Reluctant Members and Grandparents, and creates a demonstrable, investor-ready product within 6-12 months.

The MVP is intentionally narrow. Features not listed in Module 1-4 below are explicitly out of scope for MVP unless noted as exceptions.

### 6.1 MVP Modules

#### Module 1 — Identity & Family Graph

| Feature | Priority | Notes |
|---|---|---|
| User registration (email + social OAuth) | P0 | Email required; Google/Apple OAuth strongly recommended |
| Profile creation (name, birthday, roles) | P0 | Birthday is core data — drives birthday reminders |
| Profile photo upload | P2 | Headshot on person profile; replaces initials avatar — ships in P2-10 |
| Household creation and member invitation | P0 | Household is the first grouping unit |
| Family group creation and invitation | P0 | Extended family umbrella above households |
| Relationship definition between members | P0 | Spouse, parent/child, sibling — core graph edges |
| Invitation via email and SMS | P0 | Required for Reluctant Member persona |
| Guest participation (no account required) | P0 | RSVP and view without account — critical for adoption |
| Member directory / family tree view | P1 | Visual representation of the family graph |
| Profile privacy controls | P1 | What each member can see of your profile |
| Minor / child profiles (parent-managed) | P1 | Legal requirement; parent creates and controls |

#### Module 2 — Event Hub

| Feature | Priority | Notes |
|---|---|---|
| Event creation (title, date/time, location, description) | P0 | Core creation flow — must be fast and simple |
| Event invitation to family members and guests | P0 | Individual, household, or full family invite |
| RSVP collection (Yes / No / Maybe) | P0 | Must work via email/SMS link for non-account users |
| RSVP visibility for organizer | P0 | Who's coming at a glance — core organizer value |
| Event reminders (push, email, SMS) | P0 | Configurable; critical for Grandparent persona |
| Potluck / contribution assignments | P1 | Who's bringing what — reduces organizer follow-up |
| Event comments / discussion thread | P1 | In-context discussion without leaving FamLink |
| Recurring events (annual birthdays, weekly practice) | P1 | Avoid re-creation of standing events |
| Event photo upload and gallery | P2 | Post-event memories — any member can upload; ships in P2-10 |
| Guest list sharing (who else is coming) | P1 | Visible to confirmed attendees |

#### Module 3 — Shared Family Calendar

| Feature | Priority | Notes |
|---|---|---|
| Unified family calendar view (month / week / list) | P0 | All events across the family in one view |
| Birthday calendar (auto-populated from profiles) | P0 | Auto-generated from member birthdates — key hook |
| Household calendar layer | P0 | Filter to household-only events |
| Family calendar layer | P0 | Full extended family view |
| Personal calendar layer | P1 | Individual events not shared with family |
| Calendar event creation from calendar view | P0 | Tap date to create event |
| External calendar sync (Google, Apple, Outlook) | P1 | Import/export — important for Co-Parent persona |
| Sports / school schedule import | P2 | Structured import from league/school systems — Phase 2 |
| Calendar notifications and reminders | P0 | Configurable per-event and per-user |
| Upcoming events digest (weekly email summary) | P1 | Particularly valuable for Grandparent persona |

#### Module 4 — Notifications & Accessibility

| Feature | Priority | Notes |
|---|---|---|
| Push notifications (mobile app) | P0 | Event invites, RSVPs, reminders, birthday alerts |
| Email notifications (all major events) | P0 | Required for Grandparent and Reluctant Member |
| SMS notifications (invites and reminders) | P0 | Required for Reluctant Member persona |
| Notification preference management per user | P0 | Users control their own notification cadence |
| Accessible UI mode (larger text, simplified nav) | P1 | Critical for Grandparent persona |
| Digest emails (daily or weekly summary) | P1 | Reduced noise option for low-engagement users |

### 6.2 Explicitly Out of Scope for MVP

The following features are confirmed roadmap items but will NOT be built for MVP:

- Family / general photo album (not tied to a specific event) — deferred to Phase 3
- Image resizing / thumbnail pipeline — deferred to Phase 3
- Facial recognition search (find person across all photos by name) — deferred to Phase 3
- *Note: Profile photos and event photo galleries ship in Phase 2 (P2-10)*
- Gift wishlist and gift coordination
- Group chat / direct messaging
- Trip and vacation planning
- Cost sharing and expense splitting
- Affiliate commerce and partner integrations
- Wedding and major event planning tools
- Obituary / memorial features
- Sports and school schedule structured imports
- AI-assisted features (event suggestions, summary generation)

---

## 7. Core User Journeys

### 7.1 Journey: The Organizer Sets Up Thanksgiving

| Step | Action | System Response |
|---|---|---|
| 1 | Organizer creates FamLink account and profile | Account created; prompted to create or join a Family |
| 2 | Creates 'The Johnson Family' group | Family group created; organizer is admin |
| 3 | Invites family members via email and SMS | Each invitee receives personalized invite; guests can RSVP without account |
| 4 | Creates 'Thanksgiving 2026' event | Event created on family calendar; organizer sets date, location, details |
| 5 | Assigns potluck contributions | Each invitee sees their assigned dish in their invite and on the event page |
| 6 | Sends invitations | Email + SMS sent to all; non-account members receive one-click RSVP link |
| 7 | Monitors RSVPs | Organizer dashboard shows live RSVP count and who is / isn't responding |
| 8 | Sends reminder to non-responders | One-click reminder to pending invitees; still works via email/SMS for guests |
| 9 | Event day and follow-up | Attendees receive day-of reminder; post-event, organizer can upload photos (Phase 2) |

### 7.2 Journey: The Reluctant Member RSVPs Without an Account

| Step | Action | System Response |
|---|---|---|
| 1 | Uncle Dave receives SMS: 'Sarah invited you to Thanksgiving...' | SMS contains event summary and one-click RSVP link |
| 2 | Dave taps the link | Mobile-optimized event page loads — no login required |
| 3 | Dave sees event details, potluck assignment, and who else is coming | Guest view of event — read-only, no account needed |
| 4 | Dave taps 'Yes, I'll be there' | RSVP recorded; organizer notified; Dave added to confirmed list |
| 5 | Dave receives day-before reminder via SMS | Automated reminder with address and his potluck assignment |
| 6 | Optional: Dave is prompted to create an account to see more family events | Soft upgrade prompt — not required, never forced |

### 7.3 Journey: The Grandparent Checks the Family Calendar

| Step | Action | System Response |
|---|---|---|
| 1 | Grandma receives weekly digest email: 'Upcoming this week in your family' | Email lists 3 upcoming events with dates, times, and who's involved |
| 2 | Grandma sees granddaughter Emma has a soccer game Saturday | Event detail includes location, time, and who is attending |
| 3 | Grandma taps 'Add to my calendar' | Exports to Google/Apple calendar — no FamLink login required for this action |
| 4 | Grandma opens FamLink app to see more | Accessible view loads; large text, simple navigation, upcoming events prominent |
| 5 | Grandma sees Emma's birthday is in 3 weeks | Birthday card prompt shown — Phase 2 gift/card commerce opportunity |

---

## 8. Success Metrics

FamLink is targeting investor conversations at 6-12 months. The following metrics are selected because they (a) demonstrate product-market fit, (b) show viral family adoption, and (c) map to a credible monetization path. These are the numbers that should be on the pitch deck.

### 8.1 MVP / Seed Metrics (0-12 months)

| Metric | Target | Why It Matters to Investors |
|---|---|---|
| Families created | 500+ active families | Unit of value — each family is a network, not an individual |
| Members per family (avg) | 8+ members | Validates network effect and adoption depth |
| Monthly Active Families | 60%+ of created families | Retention signal — families return because events keep happening |
| Events created per family/month | 2+ events | Frequency of use; event creation = engagement trigger |
| RSVP response rate | 65%+ per event | Validates that the Reluctant Member problem is solved |
| Guest-to-account conversion | 20%+ of guest RSVPs | Organic growth loop — each event brings in new members |
| Organizer NPS | 50+ | Willingness to recommend; the Organizer is your sales force |
| D30 Retention (family level) | 40%+ | Families stay because life events are continuous |

### 8.2 Qualitative Signals

- Families invite more members without being prompted — organic growth within the family network
- Organizers report reduced coordination effort in post-onboarding surveys
- Grandparent and Reluctant Member personas engage without direct support intervention
- Unsolicited referrals — organizers telling other organizers

---

## 9. Phased Product Roadmap

| Phase | Timeline | Focus | Key Features |
|---|---|---|---|
| 0 — Foundation | Months 1-3 | Identity & Graph | Accounts, family groups, households, relationship graph, invitation system, guest participation |
| 1 — Wedge | Months 3-7 | Event & Calendar Hub | Event creation, RSVPs, potluck assignments, shared family calendar, birthday calendar, notifications (push/email/SMS) |
| 2 — Engagement | Months 7-12 | Depth & Stickiness | Profile photos + event photo galleries (P2-10), AI assistant (web + mobile), gift wishlists, recurring events, external calendar sync, accessible UI |
| 3 — Commerce | Months 12-18 | Monetization | Family photo album, image resize pipeline, facial recognition search (by person name across all photos), group chat (Stream.io), gift purchase integration (Amazon/affiliate), venue and travel affiliate links, premium family subscription |
| 4 — Platform | Months 18-24 | Ecosystem | Wedding planning, trip planning, cost sharing, API for partner integrations, white-label options |

---

## 10. Technical Direction

Note: Full technical decisions will be documented in a separate Architecture Decision Record (ADR). This section captures directional decisions relevant to product scope.

### 10.1 Stack Considerations

| Layer | Decision |
|---|---|
| Frontend | React (web) + React Native or Expo (mobile). Single codebase priority given small team and AI-assisted development. |
| Backend | Node.js with Express (TypeScript). REST API. (Locked in ADR-03. GraphQL deferred to Phase 2.) |
| Database — Relationships | PostgreSQL with a relational nodes-and-edges pattern for MVP (sufficient for 2-3 hop traversal at family scale). Native graph DB (Neo4j or AWS Neptune) is a Phase 2 evaluation item. (See ADR-04.) |
| Database — Transactional | PostgreSQL for events, RSVPs, user accounts, notifications, and all transactional data. |
| Auth | Clerk — managed authentication with Social OAuth (Google, Apple). (Locked in ADR-05. Auth0 not selected.) |
| Media Storage | Cloudflare R2 or AWS S3 for photo/media storage (Phase 2). |
| Notifications | Resend (email) + Twilio (SMS) + Firebase Cloud Messaging (push). All three required at MVP. (SendGrid replaced by Resend — see ADR-07 v0.3.) |
| Hosting | Vercel (frontend) + Railway or Render (backend) for MVP simplicity. Migrate to AWS/GCP at scale. |
| Chat (Phase 2) | Stream.io — do not build real-time messaging from scratch. |

### 10.2 Critical Technical Constraints

- Guest participation (no account required) must be architected from day one. This affects auth, session management, and data access patterns throughout the stack.
- The privacy model must be enforced at the data layer — not just the UI. Row-level security or equivalent is required from the start.
- COPPA compliance for minor profiles must be designed in from the beginning. Parent-controlled minor profiles require special handling in auth and data access.
- SMS and email delivery reliability is a product-critical dependency. Vendor SLA and deliverability must be evaluated before launch.

---

## 11. Constraints & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Cold start problem — value requires a full family to be on the platform | High | Guest participation (no account needed) lowers adoption barrier; Organizer can use FamLink solo initially for personal coordination |
| Privacy breach or data misuse erodes trust fatally | Critical | Privacy-by-design architecture; no advertising model; clear and simple privacy policy; third-party security audit before launch |
| COPPA / GDPR compliance for minor profiles | High | Legal counsel before launch; parent-controlled minor profiles; no behavioral targeting of minors |
| Reluctant Member non-adoption limits network value | High | Email/SMS first-class participation; one-click RSVP; no forced account creation |
| AI-assisted dev quality drift (inconsistent code from Cursor) | Medium | Comprehensive PRD and ADR as source of truth for every prompt; regular architectural review |
| 'Easy enough for grandparents' UX is harder than it sounds | Medium | Dedicated accessible UI mode; user testing with 60+ cohort before launch; progressive disclosure design pattern |
| Brand name / domain conflict (FamLink.com taken) | Low-Medium | Domain decision and trademark search to be completed before any public launch or investor materials |
| Competitive response from large platforms (Meta, Google) | Low (near-term) | Focus on trust and privacy as primary differentiator — the core reason families have left Facebook |

---

## 12. Open Questions

The following questions require decisions before detailed architecture and development can begin. They are ordered by priority.

| # | Question | Impact | Owner |
|---|---|---|---|
| 1 | What is the final product name and is the .com domain acquirable? | Brand, legal, investor materials | Founder |
| 2 | Graph DB (Neo4j/Neptune) or PostgreSQL with graph extension (Apache AGE)? | Core architecture, team skills, cost — PostgreSQL relational graph for MVP; graph DB eval deferred to Phase 2 (see ADR-04) | RESOLVED |
| 3 | React Native vs. Expo vs. web-first for mobile? | Build speed, feature parity, App Store requirements | Technical lead |
| 4 | What is the freemium boundary? What is free vs. paid? | Monetization model, investor story | Founder |
| 5 | Who is the technical co-founder or lead developer? | Build timeline, architecture quality | Founder |
| 6 | Which US states / countries are targeted at launch? (GDPR scope?) | Legal, compliance, data residency | Founder + Legal |
| 7 | How are blended / non-traditional family structures represented? | Graph model, UX, inclusivity | Product + Technical |
| 8 | What is the moderation strategy for harmful family content? | Trust & safety, legal liability | Founder + Legal |

---

## 13. Next Steps

Note (March 2026): This section was written at PRD v0.1. Phase 0 development is complete and Phase 1 is in progress. Items 1–6 below are substantially completed. The ADR is now at v0.3. Refer to ADR v0.3 Section 7 for the current action list.

| Priority | Action | Output |
|---|---|---|
| 1 | Finalize product name and check domain + trademark availability | Confirmed brand identity |
| 2 | Resolve Open Questions 1-4 (name, DB, mobile platform, freemium model) | ADR draft ready for architecture |
| 3 | Draft Architecture Decision Record (ADR) | Tech stack locked; ADR v0.1 |
| 4 | Draft Data Model document (graph schema, entity definitions) | Data model v0.1 |
| 5 | Build Cursor Prompt Library — Phase 0 (Identity & Graph) | 10-15 sequenced, modular build prompts |
| 6 | Begin MVP development — Module 1 (Identity & Family Graph) | Working foundation with accounts, groups, invitations |
| 7 | Draft investor pitch narrative (parallel to development) | Pitch deck outline; investor story framing |
| 8 | Identify 3-5 beta Organizer users for early feedback | Real family feedback before investor conversations |

---

## Appendix A — Competitive Landscape Summary

A brief scan of the competitive landscape as of early 2026. No direct competitor occupies the extended-family coordination + private social graph position FamLink targets.

| Company | Category | Strength | Weakness vs. FamLink |
|---|---|---|---|
| Facebook Groups | Social network | Massive reach, features | Trust deficit, ad-driven, public noise, generational drop-off |
| Cozi | Family organizer | Good for nuclear family | Nuclear only, no extended family graph, limited social features |
| FamilyWall | Family organizer | Privacy-focused | Niche, limited network effect, no commerce layer |
| Tinybeans | Baby/child sharing | Strong for new parents | Age-limited use case, no extended family coordination |
| GroupMe / WhatsApp | Messaging | Universal adoption | No structure, no events, no relationship graph, no commerce |
| Ancestry | Genealogy | Deep family history | Historical only, no live coordination or communication |
| 23andMe | DNA / genealogy | Biological data insight | Not a coordination platform; different use case entirely |

Market gap confirmed: No product combines (1) extended family relationship graph, (2) private event and calendar coordination, (3) multi-generational accessibility, and (4) a natural commerce layer. This is the white space FamLink occupies.

---

*FamLink PRD v0.1 — Working Draft — March 2026 — CONFIDENTIAL*

*This document is a living artifact. All sections subject to revision as product decisions are finalized.*
