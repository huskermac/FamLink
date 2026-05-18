interface BaseProps {
  toolName: string;
  output: unknown;
}

// ── Output shape types ───────────────────────────────────────────────────────

interface PersonSummary {
  id: string;
  displayName: string;
  relationship: string;
  contactable: boolean;
}

interface BirthdayEntry {
  name: string;
  date: string;
  daysUntil: number;
}

interface EventEntry {
  id: string;
  title: string;
  startTime: string;
  location: string | null;
  rsvpSummary: { yes: number; no: number; maybe: number; pending: number };
}

interface EventDetails {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  location: string | null;
  rsvps: { status: string; personName: string }[];
}

interface RsvpStatus {
  yes: string[];
  no: string[];
  maybe: string[];
  pending: string[];
}

interface ContactInfo {
  displayName: string;
  email: string | null;
  phone: string | null;
}

interface RelPath {
  path: string[] | null;
  description: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}

// ── Sub-renderers ────────────────────────────────────────────────────────────

function PersonList({ people }: { people: PersonSummary[] }) {
  if (people.length === 0) return <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>No results.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {people.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
          <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{p.displayName}</span>
          <span style={{ color: "var(--text-muted)" }}>{p.relationship}</span>
        </div>
      ))}
    </div>
  );
}

function BirthdayList({ birthdays }: { birthdays: BirthdayEntry[] }) {
  if (birthdays.length === 0) return <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>No upcoming birthdays.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {birthdays.map((b) => (
        <div key={b.name + b.date} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
          <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{b.name}</span>
          <span style={{ color: "var(--text-muted)" }}>
            {b.daysUntil === 0 ? "Today!" : b.daysUntil === 1 ? "Tomorrow" : `In ${b.daysUntil} days`}
          </span>
        </div>
      ))}
    </div>
  );
}

function EventList({ events }: { events: EventEntry[] }) {
  if (events.length === 0) return <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>No upcoming events.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {events.map((e) => (
        <div key={e.id} style={{ fontSize: "13px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{e.title}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{e.rsvpSummary.yes} going</span>
          </div>
          <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
            {formatDateTime(e.startTime)}{e.location ? ` · ${e.location}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function EventDetailsCard({ event }: { event: EventDetails }) {
  const groups: Record<string, string[]> = { YES: [], NO: [], MAYBE: [], PENDING: [] };
  for (const r of event.rsvps) groups[r.status]?.push(r.personName);
  const statusLabels: Record<string, string> = { YES: "Going", NO: "Not going", MAYBE: "Maybe", PENDING: "Pending" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
      <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>{event.title}</p>
      <p style={{ color: "var(--text-secondary)" }}>
        {formatDateTime(event.startTime)}{event.location ? ` · ${event.location}` : ""}
      </p>
      {event.description && <p style={{ color: "var(--text-muted)" }}>{event.description}</p>}
      {event.rsvps.length > 0 && (
        <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
          {(["YES", "MAYBE", "NO", "PENDING"] as const).map((s) =>
            groups[s].length > 0 ? (
              <p key={s} style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                <span style={{ fontWeight: 500 }}>{statusLabels[s]}:</span>{" "}{groups[s].join(", ")}
              </p>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

function RsvpCard({ status }: { status: RsvpStatus }) {
  const entries = [
    { label: "Going", names: status.yes },
    { label: "Maybe", names: status.maybe },
    { label: "Not going", names: status.no },
    { label: "Pending", names: status.pending },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "13px" }}>
      {entries.map(({ label, names }) => (
        <p key={label} style={{ color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{label} ({names.length})</span>
          {names.length > 0 && <>: {names.join(", ")}</>}
        </p>
      ))}
    </div>
  );
}

function ContactCard({ info }: { info: ContactInfo }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "13px" }}>
      <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>{info.displayName}</p>
      {info.email && <p style={{ color: "var(--text-secondary)" }}>{info.email}</p>}
      {info.phone && <p style={{ color: "var(--text-secondary)" }}>{info.phone}</p>}
      {!info.email && !info.phone && <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No contact info on file.</p>}
    </div>
  );
}

function RelPathCard({ rel }: { rel: RelPath }) {
  return (
    <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
      {rel.path === null ? "No relationship path found within 4 hops." : rel.description}
    </p>
  );
}

function JsonFallback({ output }: { output: unknown }) {
  const text = output === null || output === undefined
    ? "No result"
    : typeof output === "string"
    ? output
    : JSON.stringify(output, null, 2);
  return (
    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)" }}>
      {text}
    </pre>
  );
}

// ── Routing ──────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_person: "Person lookup",
  get_family_members: "Family members",
  get_relationship_path: "Relationship",
  get_upcoming_birthdays: "Upcoming birthdays",
  get_upcoming_events: "Upcoming events",
  get_event_details: "Event details",
  get_rsvp_status: "RSVP status",
  get_household_members: "Household members",
  get_contact_info: "Contact info",
};

function renderBody(toolName: string, output: unknown): React.ReactNode {
  if (output === null || output === undefined) {
    return <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>No result.</p>;
  }
  switch (toolName) {
    case "get_person":
    case "get_family_members":
    case "get_household_members":
      return <PersonList people={output as PersonSummary[]} />;
    case "get_upcoming_birthdays":
      return <BirthdayList birthdays={output as BirthdayEntry[]} />;
    case "get_upcoming_events":
      return <EventList events={output as EventEntry[]} />;
    case "get_event_details":
      return (output as EventDetails | null) ? <EventDetailsCard event={output as EventDetails} /> : <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>Event not found.</p>;
    case "get_rsvp_status":
      return (output as RsvpStatus | null) ? <RsvpCard status={output as RsvpStatus} /> : <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>Event not found.</p>;
    case "get_contact_info":
      return (output as ContactInfo | null) ? <ContactCard info={output as ContactInfo} /> : <p style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>No contact info found.</p>;
    case "get_relationship_path":
      return <RelPathCard rel={output as RelPath} />;
    default:
      return <JsonFallback output={output} />;
  }
}

export function ToolResultCard({ toolName, output }: BaseProps) {
  const label = TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
  return (
    <div style={{ borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg-card)", padding: "10px 12px" }}>
      <p style={{ marginBottom: "8px", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
        {label}
      </p>
      {renderBody(toolName, output)}
    </div>
  );
}
