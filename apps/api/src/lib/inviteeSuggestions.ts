import { db } from "@famlink/db";

export interface Suggestion {
  person: { id: string; displayName: string; avatarUrl: string | null };
  via: { personId: string; personName: string; relationshipType: string; relationshipState: "ACTIVE" | "ENDED" };
  sharedChildren: { id: string; displayName: string }[];
}

function displayName(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return p.preferredName?.trim() || `${p.firstName} ${p.lastName}`.trim();
}

export async function getInviteeSuggestions({
  familyGroupId,
  invitedPersonIds,
}: {
  familyGroupId: string;
  invitedPersonIds: string[];
}): Promise<Suggestion[]> {
  if (invitedPersonIds.length === 0) return [];

  // All current family members (exclude from suggestions)
  const familyMembers = await db.familyMember.findMany({
    where: { familyGroupId },
    select: { personId: true }
  });
  const familyMemberIds = new Set(familyMembers.map(m => m.personId));

  const seen = new Set<string>(); // prevent duplicate suggestions
  const suggestions: Suggestion[] = [];

  for (const invitedPersonId of invitedPersonIds) {
    const invitedPerson = await db.person.findUnique({
      where: { id: invitedPersonId },
      select: { id: true, firstName: true, lastName: true, preferredName: true }
    });
    if (!invitedPerson) continue;

    // --- ACTIVE FRIEND suggestions ---
    const activeFriends = await db.relationship.findMany({
      where: { fromPersonId: invitedPersonId, type: "FRIEND", endDate: null, forgottenAt: null },
      include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true, isDeceased: true, profilePhotoUrl: true } } }
    });
    for (const rel of activeFriends) {
      const candidate = rel.toPerson;
      if (candidate.isDeceased) continue;
      if (familyMemberIds.has(candidate.id)) continue;
      if (invitedPersonIds.includes(candidate.id)) continue;
      if (seen.has(`${invitedPersonId}:${candidate.id}`)) continue;
      seen.add(`${invitedPersonId}:${candidate.id}`);
      suggestions.push({
        person: { id: candidate.id, displayName: displayName(candidate), avatarUrl: candidate.profilePhotoUrl },
        via: { personId: invitedPersonId, personName: displayName(invitedPerson), relationshipType: "FRIEND", relationshipState: "ACTIVE" },
        sharedChildren: [],
      });
    }

    // --- ACTIVE SPOUSE/PARTNER suggestions ---
    const activeRomantic = await db.relationship.findMany({
      where: { fromPersonId: invitedPersonId, type: { in: ["SPOUSE", "PARTNER"] }, endDate: null, forgottenAt: null },
      include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true, isDeceased: true, profilePhotoUrl: true } } }
    });
    for (const rel of activeRomantic) {
      const candidate = rel.toPerson;
      if (candidate.isDeceased) continue;
      if (familyMemberIds.has(candidate.id)) continue;
      if (invitedPersonIds.includes(candidate.id)) continue;
      if (seen.has(`${invitedPersonId}:${candidate.id}`)) continue;
      seen.add(`${invitedPersonId}:${candidate.id}`);
      suggestions.push({
        person: { id: candidate.id, displayName: displayName(candidate), avatarUrl: candidate.profilePhotoUrl },
        via: { personId: invitedPersonId, personName: displayName(invitedPerson), relationshipType: rel.type, relationshipState: "ACTIVE" },
        sharedChildren: [],
      });
    }

    // --- ENDED SPOUSE/PARTNER — only if shared children ---
    const endedRomantic = await db.relationship.findMany({
      where: { fromPersonId: invitedPersonId, type: { in: ["SPOUSE", "PARTNER"] },
               endDate: { not: null }, forgottenAt: null },
      include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true, isDeceased: true, profilePhotoUrl: true } } }
    });
    for (const rel of endedRomantic) {
      const candidate = rel.toPerson;
      if (candidate.isDeceased) continue;
      if (familyMemberIds.has(candidate.id)) continue;
      if (invitedPersonIds.includes(candidate.id)) continue;

      // Find shared children
      const invitedChildren = await db.relationship.findMany({
        where: { fromPersonId: invitedPersonId, type: "PARENT", forgottenAt: null },
        select: { toPersonId: true }
      });
      const invitedChildIds = new Set(invitedChildren.map(r => r.toPersonId));

      if (invitedChildIds.size === 0) continue;

      const candidateChildren = await db.relationship.findMany({
        where: { fromPersonId: candidate.id, type: "PARENT", forgottenAt: null,
                 toPersonId: { in: [...invitedChildIds] } },
        include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true } } }
      });

      if (candidateChildren.length === 0) continue;
      if (seen.has(`${invitedPersonId}:${candidate.id}`)) continue;
      seen.add(`${invitedPersonId}:${candidate.id}`);

      suggestions.push({
        person: { id: candidate.id, displayName: displayName(candidate), avatarUrl: candidate.profilePhotoUrl },
        via: { personId: invitedPersonId, personName: displayName(invitedPerson), relationshipType: rel.type, relationshipState: "ENDED" },
        sharedChildren: candidateChildren.map(c => ({ id: c.toPerson.id, displayName: displayName(c.toPerson) })),
      });
    }
  }

  return suggestions;
}
