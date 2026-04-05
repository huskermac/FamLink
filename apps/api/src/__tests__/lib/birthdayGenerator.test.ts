import { birthdayMonthDayInYear, generateBirthdayEvents } from "../../lib/birthdayGenerator";

describe("birthdayGenerator", () => {
  it("uses Feb 28 in non-leap years for Feb 29 DOB", () => {
    expect(birthdayMonthDayInYear("2000-02-29", 2023)).toEqual({ month: 2, day: 28 });
    expect(birthdayMonthDayInYear("2000-02-29", 2024)).toEqual({ month: 2, day: 29 });
  });

  it("produces stable ids birthday-{personId}-{year}", () => {
    const [e] = generateBirthdayEvents(
      [
        {
          id: "p1",
          firstName: "Ada",
          lastName: "Lovelace",
          dateOfBirth: "1815-12-10"
        }
      ],
      2026,
      "fam1"
    );
    expect(e.id).toBe("birthday-p1-2026");
    expect(e.isBirthdayEvent).toBe(true);
    expect(e.title).toBe("Ada's Birthday");
  });
});
