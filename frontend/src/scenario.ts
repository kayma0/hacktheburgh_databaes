/* The crisis scenario travels between pages in the address bar (#/page?c=…&p=…), so the
   plan page rebuilds the exact simulation run on the reservoir page, going back restores
   it, and a copied link opens the same thing. */

import { clamp } from "./format";

export interface Scenario {
  country: string;
  people: number;
  days: number;
  oNegFallback: boolean;
  /** The crisis run's seed: the same seed gives the same simulation. Unset = not run yet. */
  seed?: number;
}

export const SCENARIO_DEFAULTS = { people: 25, days: 30, oNegFallback: false };
const MAX_PEOPLE = 50;
export const MAX_DAYS = 365;

/** The query part of the current hash: "#/plan?c=Ghana&p=25" -> c=Ghana&p=25. */
export function hashQuery(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

const num = (q: URLSearchParams, k: string, d: number, lo: number, hi: number) => {
  const v = parseFloat(q.get(k) ?? "");
  return Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : d;
};

/** The scenario in the address bar; anything missing falls back to the defaults, and the
 *  country to `country`. */
export function readScenario(country: string): Scenario {
  const q = hashQuery();
  const seed = q.get("s");
  return {
    country: q.get("c") || country,
    people: num(q, "p", SCENARIO_DEFAULTS.people, 1, MAX_PEOPLE),
    days: num(q, "d", SCENARIO_DEFAULTS.days, 1, MAX_DAYS),
    oNegFallback: q.get("on") === "1",
    seed: seed !== null && /^\d+$/.test(seed) ? Number(seed) : undefined,
  };
}

export function scenarioQuery(s: Scenario): string {
  const q = new URLSearchParams({
    c: s.country,
    p: String(s.people),
    d: String(s.days),
    on: s.oNegFallback ? "1" : "0",
  });
  if (s.seed !== undefined) q.set("s", String(s.seed));
  return q.toString();
}
