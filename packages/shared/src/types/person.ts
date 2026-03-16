export interface Person {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  isMinor: boolean;
  profilePhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

