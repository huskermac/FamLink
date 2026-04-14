import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BirthdayPopover } from "@/components/calendar/BirthdayPopover";

describe("BirthdayPopover", () => {
  it("renders the person's name", () => {
    render(
      <BirthdayPopover person={{ name: "Alice", age: 30 }} onClose={vi.fn()} />
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("renders the correct age", () => {
    render(
      <BirthdayPopover person={{ name: "Alice", age: 30 }} onClose={vi.fn()} />
    );
    expect(screen.getByText(/turns 30/)).toBeInTheDocument();
  });

  it("does not render a navigation link", () => {
    render(
      <BirthdayPopover person={{ name: "Alice", age: 30 }} onClose={vi.fn()} />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <BirthdayPopover person={{ name: "Alice", age: 30 }} onClose={onClose} />
    );
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <BirthdayPopover person={{ name: "Alice", age: 30 }} onClose={onClose} />
    );
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
