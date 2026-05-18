import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ToolResultCard } from "@/components/assistant/ToolResultCard";

describe("ToolResultCard", () => {
  it("renders event list for get_upcoming_events", () => {
    const output = [
      {
        id: "evt1",
        title: "Summer BBQ",
        startTime: "2026-07-04T18:00:00Z",
        location: "Riverside Park",
        rsvpSummary: { yes: 3, no: 1, maybe: 0, pending: 2 }
      }
    ];
    render(<ToolResultCard toolName="get_upcoming_events" output={output} />);
    expect(screen.getByText("Summer BBQ")).toBeInTheDocument();
    expect(screen.getByText("3 going")).toBeInTheDocument();
    expect(screen.getByText(/Riverside Park/)).toBeInTheDocument();
  });

  it("renders empty state for get_upcoming_events with no results", () => {
    render(<ToolResultCard toolName="get_upcoming_events" output={[]} />);
    expect(screen.getByText("No upcoming events.")).toBeInTheDocument();
  });

  it("renders RSVP counts for get_rsvp_status", () => {
    const output = {
      yes: ["Alice", "Bob"],
      no: ["Charlie"],
      maybe: [],
      pending: ["Dana"]
    };
    render(<ToolResultCard toolName="get_rsvp_status" output={output} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/Charlie/)).toBeInTheDocument();
    expect(screen.getByText(/Dana/)).toBeInTheDocument();
    expect(screen.getByText(/Going \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Not going \(1\)/)).toBeInTheDocument();
  });

  it("renders birthday list for get_upcoming_birthdays", () => {
    const output = [
      { name: "Steve McLaughlin", date: "1980-05-30", daysUntil: 12 },
      { name: "Jane Doe", date: "1975-06-01", daysUntil: 0 }
    ];
    render(<ToolResultCard toolName="get_upcoming_birthdays" output={output} />);
    expect(screen.getByText("Steve McLaughlin")).toBeInTheDocument();
    expect(screen.getByText("In 12 days")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Today!")).toBeInTheDocument();
  });

  it("renders person list for get_person", () => {
    const output = [
      { id: "p1", displayName: "Alice Johnson", relationship: "parent", contactable: true },
      { id: "p2", displayName: "Bob Johnson", relationship: "sibling", contactable: false }
    ];
    render(<ToolResultCard toolName="get_person" output={output} />);
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("parent")).toBeInTheDocument();
    expect(screen.getByText("Bob Johnson")).toBeInTheDocument();
    expect(screen.getByText("sibling")).toBeInTheDocument();
  });

  it("renders contact info for get_contact_info", () => {
    const output = { displayName: "Alice Johnson", email: "alice@example.com", phone: "555-1234" };
    render(<ToolResultCard toolName="get_contact_info" output={output} />);
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("555-1234")).toBeInTheDocument();
  });

  it("renders relationship description for get_relationship_path", () => {
    const output = { path: ["parent", "sibling"], description: "parent → sibling" };
    render(<ToolResultCard toolName="get_relationship_path" output={output} />);
    expect(screen.getByText("parent → sibling")).toBeInTheDocument();
  });

  it("renders 'no path found' for null relationship path", () => {
    const output = { path: null, description: "No relationship path found within 4 hops." };
    render(<ToolResultCard toolName="get_relationship_path" output={output} />);
    expect(screen.getByText("No relationship path found within 4 hops.")).toBeInTheDocument();
  });

  it("renders JSON fallback for unknown tool name", () => {
    const output = { foo: "bar", count: 42 };
    render(<ToolResultCard toolName="some_unknown_tool" output={output} />);
    expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
  });

  it("renders 'No result' when output is null", () => {
    render(<ToolResultCard toolName="get_rsvp_status" output={null} />);
    expect(screen.getByText("No result.")).toBeInTheDocument();
  });
});
