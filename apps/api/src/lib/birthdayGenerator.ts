/** In-memory only — never persisted (P1-09). */
export interface SyntheticBirthdayEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  isBirthdayEvent: true;
  birthdayPersonId: string;
  visibility: "FAMILY";
  familyGroupId: string;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Month/day for this person's birthday in `targetYear`.
 * Feb 29 → Feb 28 when `targetYear` is not a leap year.
 */
export function birthdayMonthDayInYear(
  dobYmd: string,
  targetYear: number
): { month: number; day: number } | null {
  const parts = dobYmd.split("-");
  if (parts.length !== 3) {
    return null;
  }
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (Number.isNaN(m) || Number.isNaN(d)) {
    return null;
  }
  if (m === 2 && d === 29 && !isLeapYear(targetYear)) {
    return { month: 2, day: 28 };
  }
  return { month: m, day: d };
}

export function generateBirthdayEvents(
  persons: Array<{
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  }>,
  year: number,
  familyGroupId: string
): SyntheticBirthdayEvent[] {
  const out: SyntheticBirthdayEvent[] = [];
  for (const p of persons) {
    if (!p.dateOfBirth) {
      continue;
    }
    const md = birthdayMonthDayInYear(p.dateOfBirth, year);
    if (!md) {
      continue;
    }
    const startAt = new Date(Date.UTC(year, md.month - 1, md.day, 0, 0, 0, 0));
    const endAt = new Date(Date.UTC(year, md.month - 1, md.day, 23, 59, 59, 999));
    out.push({
      id: `birthday-${p.id}-${year}`,
      title: `${p.firstName}'s Birthday`,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      isBirthdayEvent: true,
      birthdayPersonId: p.id,
      visibility: "FAMILY",
      familyGroupId
    });
  }
  return out;
}
