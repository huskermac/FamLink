export enum RelationshipType {
  SPOUSE = "SPOUSE",
  PARTNER = "PARTNER",
  EX_SPOUSE = "EX_SPOUSE",
  PARENT = "PARENT",
  CHILD = "CHILD",
  STEP_PARENT = "STEP_PARENT",
  STEP_CHILD = "STEP_CHILD",
  ADOPTIVE_PARENT = "ADOPTIVE_PARENT",
  ADOPTIVE_CHILD = "ADOPTIVE_CHILD",
  SIBLING = "SIBLING",
  HALF_SIBLING = "HALF_SIBLING",
  STEP_SIBLING = "STEP_SIBLING",
  GRANDPARENT = "GRANDPARENT",
  GRANDCHILD = "GRANDCHILD",
  AUNT_UNCLE = "AUNT_UNCLE",
  NIECE_NEPHEW = "NIECE_NEPHEW",
  COUSIN = "COUSIN",
  CAREGIVER = "CAREGIVER",
  GUARDIAN = "GUARDIAN",
  FAMILY_FRIEND = "FAMILY_FRIEND"
}

export interface Relationship {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: RelationshipType;
  familyGroupId: string;
  notes: string | null;
  createdAt: string;
}

