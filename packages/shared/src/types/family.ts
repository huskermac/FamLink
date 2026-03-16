import type { VisibilityTier } from "./visibility";

export interface FamilyGroup {
  id: string;
  name: string;
  createdByPersonId: string;
  settings: FamilyGroupSettings;
  createdAt: string;
}

export interface FamilyGroupSettings {
  aiEnabled: boolean;
  defaultVisibility: VisibilityTier;
}

export interface Household {
  id: string;
  familyGroupId: string;
  name: string;
  address: HouseholdAddress | null;
  createdAt: string;
}

export interface HouseholdAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

