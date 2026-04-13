import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PersonHeader } from "@/components/family/PersonHeader";
import type { PersonBrief } from "@/lib/api/family";

const basePerson: PersonBrief = {
  id: "p1",
  userId: null,
  firstName: "Alice",
  lastName: "Smith",
  preferredName: null,
  dateOfBirth: null,
  ageGateLevel: "ADULT",
  profilePhotoUrl: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("PersonHeader", () => {
  it("renders full name as heading", () => {
    render(<PersonHeader person={basePerson} />);
    expect(screen.getByRole("heading", { name: "Alice Smith" })).toBeInTheDocument();
  });

  it("renders preferredName when present", () => {
    const person = { ...basePerson, preferredName: "Ali" };
    render(<PersonHeader person={person} />);
    expect(screen.getByRole("heading", { name: "Ali" })).toBeInTheDocument();
  });

  it("does not show Minor badge for adults", () => {
    render(<PersonHeader person={basePerson} />);
    expect(screen.queryByText("Minor")).not.toBeInTheDocument();
  });

  it("shows Minor badge when ageGateLevel is MINOR", () => {
    const person = { ...basePerson, ageGateLevel: "MINOR" };
    render(<PersonHeader person={person} />);
    expect(screen.getByText("Minor")).toBeInTheDocument();
  });

  it("shows initials avatar when no profilePhotoUrl", () => {
    render(<PersonHeader person={basePerson} />);
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("shows profile photo when profilePhotoUrl is set", () => {
    const person = { ...basePerson, profilePhotoUrl: "https://example.com/alice.jpg" };
    render(<PersonHeader person={person} />);
    const img = screen.getByRole("img", { name: "Alice Smith" });
    expect(img).toHaveAttribute("src", "https://example.com/alice.jpg");
  });
});
