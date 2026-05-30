export enum AgeGateLevel {
  ADULT = "ADULT",
  TEEN = "TEEN",
  CHILD = "CHILD"
}

export interface Person {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  ageGateLevel: AgeGateLevel;
  guardianPersonId: string | null;
  profilePhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
