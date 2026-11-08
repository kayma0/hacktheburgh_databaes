import type { CrisisResponse } from "../api";
import { dayToDate } from "../format";

/** One line of the recruitment plan: donors of `group` ("O-", not "O−") needed by `deadline`. */
export interface Need {
  group: string;
  donors: number;
  /** "by Sun 15 Nov" or "now" */
  deadline: string;
}

/* Donated blood is tested and processed before use (typically 1–2 days), so donors must
   give this many days before the shortage they cover. */
export const PROCESSING_DAYS = 2;

/** Recruit-by date for a shortage on window day `day` (or the window's end). */
export const recruitBy = (res: CrisisResponse, day: number | null) => {
  const by = (day ?? res.days) - PROCESSING_DAYS;
  return by < 1 ? "now" : `by ${dayToDate(by)}`;
};

/** The recruitment plan from a crisis run, most urgent first: earliest deadline, then most
 *  donors. Groups needing nobody are left out. */
export const needsFromCrisis = (res: CrisisResponse): Need[] =>
  res.by_group
    .filter((g) => g.donors_to_cover > 0)
    .sort(
      (a, b) =>
        (a.deadline_day ?? Infinity) - (b.deadline_day ?? Infinity) || b.donors_to_cover - a.donors_to_cover,
    )
    .map((g) => ({ group: g.blood_group, donors: g.donors_to_cover, deadline: recruitBy(res, g.deadline_day) }));

/** The plan as request maps keyed by blood group, most urgent first. */
export const needMaps = (needs: Need[]) => ({
  donors: Object.fromEntries(needs.map((n) => [n.group, n.donors])),
  deadlines: Object.fromEntries(needs.map((n) => [n.group, n.deadline])),
});
