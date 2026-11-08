import type { CrisisResponse } from "../api";
import { dayToDate, fmt, fmtDays, fmtRate, fmtWindow, groupLabel, pct } from "../format";
import { PROCESSING_DAYS, needsFromCrisis, recruitBy } from "./needs";

const AGE_ORDER = ["under_5", "children", "teens", "adults"] as const;
const AGE_SINGULAR: Record<string, string> = {
  under_5: "under-5",
  children: "child aged 5–9",
  teens: "teen aged 10–19",
  adults: "adult aged 20+",
};

const HEADLINE = { enough: "Enough blood", at_risk: "Might run short", not_enough: "Not enough blood" };

export default function CrisisResult({ res, stale }: { res: CrisisResponse; stale: boolean }) {
  const span = fmtWindow(res.days).replace(/ \(.*\)$/, "");
  const without = res.example.filter((p) => !p.served).length;
  const shownGroups = res.by_group.filter((g) => g.share_of_sims_with_patients > 0.05);
  const short = new Set(res.lacking);
  const risky = new Set(res.at_risk);

  const needs = needsFromCrisis(res);
  const weeks = res.days / 7;

  const who = AGE_ORDER.filter((a) => res.example_counts[a] > 0).map((a) => ({
    a,
    n: res.example_counts[a],
    lost: res.example.filter((p) => p.age_group === a && !p.served).length,
  }));
  const ageLabel = (a: string, n: number) =>
    n === 1 ? AGE_SINGULAR[a] : res.age_group_labels[a].replace(/(\d)-(\d)/g, "$1–$2");

  const firstDay = res.first_short_day;
  const noShortage = firstDay === null || res.share_runs_with_shortage < 0.1;
  const inDays = (d: number) => (Math.floor(d) < 1 ? "today" : `in ${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"}`);

  return (
    <div className={`sim-result verdict-${res.verdict} ${stale ? "is-stale" : ""}`} aria-live="polite">
      {stale && <p className="sim-stale">Settings changed. Run again to update.</p>}

      <div className="sim-banner">
        <p className="sim-banner-head">{HEADLINE[res.verdict]}</p>
        <p className="sim-banner-sub">
          for <b>{res.people}</b> {res.people === 1 ? "person" : "people"} in crisis over <b>{span}</b> in{" "}
          {res.country}, at today's collection rate.
        </p>
      </div>

      <div className="sim-tiles">
        <div className="sim-tile">
          <span className="sim-tile-k">Go without blood</span>
          <span className="sim-tile-v">
            {without}
            <small> of {res.people}</small>
          </span>
          <span className="sim-tile-n">in a typical run</span>
        </div>
        <div className="sim-tile">
          <span className="sim-tile-k">First shortage</span>
          <span className="sim-tile-v">{noShortage ? "None" : dayToDate(firstDay!)}</span>
          <span className="sim-tile-n">{noShortage ? "in 9 of 10 runs" : inDays(firstDay!)}</span>
        </div>
        <div className="sim-tile">
          <span className="sim-tile-k">Everyone covered</span>
          <span className="sim-tile-v">{pct(res.p_all_served)}</span>
          <span className="sim-tile-n">of {fmt(res.draws)} runs</span>
        </div>
        <div className={`sim-tile ${needs.length ? "is-action" : ""}`}>
          <span className="sim-tile-k">Donors to recruit</span>
          <span className="sim-tile-v">{fmt(res.donors_to_cover_total)}</span>
          <span className="sim-tile-n">{needs.length ? needs[0].deadline : "none needed"}</span>
        </div>
      </div>

      <section className="sim-section">
        <h3 className="sim-h">Who is in crisis</h3>
        <ul className="sim-who">
          {who.map((x) => (
            <li key={x.a}>
              <b>{x.n}</b> {ageLabel(x.a, x.n)}
              {x.lost > 0 && <em> · {x.lost} without blood</em>}
            </li>
          ))}
        </ul>
      </section>

      <section className="sim-section">
        <h3 className="sim-h">What to do</h3>
        {needs.length === 0 ? (
          <p>
            <b>No donation drive needed</b> for this scenario. Keep regular donors coming in.
          </p>
        ) : (
          <>
            <p className="sim-todo-lead">
              Recruit <b>{fmt(res.donors_to_cover_total)} donors</b>, starting with{" "}
              <b>{groupLabel(needs[0].group)}</b> {needs[0].deadline}. This covers the gap in{" "}
              {Math.round(res.cover_share * 10)} of 10 runs, allowing {PROCESSING_DAYS} days to test and process
              each donation.
            </p>
            <ol className="sim-plan">
              {needs.map((n, i) => (
                <li key={n.group} className={i === 0 ? "is-first" : ""}>
                  <span className="sim-plan-g">{groupLabel(n.group)}</span>
                  <span className="sim-plan-n">
                    <b>{fmt(n.donors)}</b> donor{n.donors === 1 ? "" : "s"}
                    {weeks >= 2 && <small> · about {Math.max(1, Math.ceil(n.donors / weeks))} a week</small>}
                  </span>
                  <span className="sim-plan-d">{n.deadline}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {res.o_neg_fallback && (
          <p className="sim-note">
            {res.o_neg_patients_helped >= 0.005
              ? `O− covered someone whose own group ran out in about ${pct(Math.min(res.o_neg_patients_helped, 1))} of runs.`
              : "O− could not help: it runs out first."}
          </p>
        )}
      </section>

      <section className="sim-section">
        <h3 className="sim-h">By blood group</h3>
        <div className="sim-table-wrap">
          <table className="rates sim-table">
            <thead>
              <tr>
                <th>Group</th>
                <th title="Share of runs where someone with this group went without">Chance short</th>
                <th>Donors to recruit</th>
                <th>Recruit by</th>
                <th>Collected a day</th>
                <th>Used a day</th>
                <th>Stock runs out</th>
              </tr>
            </thead>
            <tbody>
              {shownGroups.map((g) => {
                const chip = short.has(g.blood_group) ? "chip-critical" : risky.has(g.blood_group) ? "chip-low" : "chip-ok";
                const recruit = g.donors_to_cover > 0;
                return (
                  <tr key={g.blood_group} className={short.has(g.blood_group) ? "is-short" : ""}>
                    <th scope="row">{groupLabel(g.blood_group)}</th>
                    <td>
                      <span className={`chip ${chip}`}>{pct(g.p_short)}</span>
                    </td>
                    <td>{recruit ? <b>{fmt(g.donors_to_cover)}</b> : "–"}</td>
                    <td>{recruit ? recruitBy(res, g.deadline_day).replace(/^by /, "") : "–"}</td>
                    <td>{fmtRate(g.collected_per_day)}</td>
                    <td className={g.routine_use_per_day > g.collected_per_day ? "is-deficit" : ""}>
                      {fmtRate(g.routine_use_per_day)}
                    </td>
                    <td>{g.runs_dry_after_days === null ? "holds" : `in ${fmtDays(g.runs_dry_after_days)} days`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="sim-scope">Sickle cell crises only. Assumes nothing else happens.</p>
    </div>
  );
}
