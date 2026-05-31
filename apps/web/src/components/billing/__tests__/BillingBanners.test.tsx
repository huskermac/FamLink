import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BillingBanners } from "@/components/billing/BillingBanners";
import type { FamilySubscription } from "@/lib/api/billing";

const baseSub: FamilySubscription = {
  tierKey: "BASE",
  seatCount: 2,
  status: "ACTIVE",
  trialEndsAt: null,
  pendingDowngradeTierKey: null,
  pendingDowngradeSeatCount: null,
  downgradeGraceEndsAt: null,
  grandfathered: false
};

describe("BillingBanners", () => {
  it("renders nothing for active non-trial subscription", () => {
    const { container } = render(<BillingBanners subscription={baseSub} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders trial ending banner when trialWarningSentAt is set", () => {
    const sub: FamilySubscription = { ...baseSub, status: "TRIALING", trialEndsAt: "2026-06-13T00:00:00Z" };
    render(<BillingBanners subscription={sub} trialWarningSentAt="2026-06-10T00:00:00Z" />);
    expect(screen.getByText(/trial ends/i)).toBeInTheDocument();
  });

  it("renders downgrade pending banner when pendingDowngradeTierKey is set", () => {
    const sub: FamilySubscription = {
      ...baseSub,
      pendingDowngradeTierKey: "BASE",
      pendingDowngradeSeatCount: 1,
      downgradeGraceEndsAt: "2026-06-07T00:00:00Z"
    };
    render(<BillingBanners subscription={sub} />);
    expect(screen.getByText(/plan change/i)).toBeInTheDocument();
  });

  it("renders past due banner when status is PAST_DUE", () => {
    render(<BillingBanners subscription={{ ...baseSub, status: "PAST_DUE" }} />);
    expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
  });
});
