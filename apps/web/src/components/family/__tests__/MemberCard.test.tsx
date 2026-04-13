import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemberCard } from "@/components/family/MemberCard";
import type { PersonBrief } from "@/lib/api/family";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const basePerson: PersonBrief = {
  id: "p1",
  userId: null,
  firstName: "Jane",
  lastName: "Doe",
  preferredName: null,
  dateOfBirth: null,
  ageGateLevel: "ADULT",
  profilePhotoUrl: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("MemberCard", () => {
  it("renders the display name", () => {
    render(<MemberCard person={basePerson} familyId="f1" />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("uses preferredName when present", () => {
    const person = { ...basePerson, preferredName: "Jay" };
    render(<MemberCard person={person} familyId="f1" />);
    expect(screen.getByText("Jay")).toBeInTheDocument();
  });

  it("shows initials avatar when no profilePhotoUrl", () => {
    render(<MemberCard person={basePerson} familyId="f1" />);
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("shows profile photo when profilePhotoUrl is provided", () => {
    const person = { ...basePerson, profilePhotoUrl: "https://example.com/photo.jpg" };
    render(<MemberCard person={person} familyId="f1" />);
    const img = screen.getByRole("img", { name: "Jane Doe" });
    expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
  });

  it("links to the member profile page", () => {
    render(<MemberCard person={basePerson} familyId="fam123" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/family/fam123/members/p1");
  });
});
