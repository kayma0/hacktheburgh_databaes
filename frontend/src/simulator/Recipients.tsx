import { useEffect, useState } from "react";
import { getActivity, logOutreach, matchDonors } from "../api";
import type { Activity, Channel, DonorGroupMatch, DonorMatchResponse, MatchedDonor, OutreachStatus } from "../api";
import { fmtDate, groupLabel } from "../format";
import AddDonorForm from "./AddDonorForm";
import { channelName, contactFor, generalMessage, personalMessage, sendLink } from "./messages";
import { needMaps } from "./needs";
import type { Need } from "./needs";
import type { Appeal } from "./useAppeal";

/* Step 2: the charity's registered donors (Postgres on Tiger Data) for each blood type in
   the plan. Two ways to send:
   - "Only those who can give now": donors past the gap since their last donation, each
     getting the appeal with their name and a nudge about when they last gave;
   - "Everyone": every donor of the type gets the appeal as written, and email and SMS can
     go to the whole group at once. */

type Audience = "eligible" | "everyone";
const SHOWN_PER_GROUP = 6;
const STATUS_LABEL: Record<OutreachStatus, string> = {
  contacted: "Sent, waiting for reply",
  pledged: "Pledged",
  declined: "Can't give",
};

export default function Recipients({
  country,
  needs,
  appeal,
  channel,
}: {
  country: string;
  needs: Need[];
  appeal: Appeal;
  channel: Channel;
}) {
  const [data, setData] = useState<DonorMatchResponse | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>("eligible");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0); // bump to reload after a change
  const reload = () => setVersion((v) => v + 1);
  const needsKey = JSON.stringify(needs);

  useEffect(() => {
    let live = true;
    Promise.all([matchDonors({ country, ...needMaps(needs) }), getActivity(country)])
      .then(([d, a]) => {
        if (!live) return;
        setData(d);
        setActivity(a);
        setError(null);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [country, needsKey, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const record = (donors: MatchedDonor[], status: OutreachStatus, ch?: Channel) =>
    logOutreach(
      donors.map((d) => d.id),
      status,
      ch,
    )
      .then(reload)
      .catch((e) => setError(String(e)));

  const toggleGroup = (g: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  if (!data) {
    return error ? (
      <div className="alert">Couldn't reach the donor database: {error}</div>
    ) : (
      <p className="fine">Finding donors…</p>
    );
  }
  if (!data.connected) {
    return (
      <p className="donors-off">
        No donor database connected. Add your Tiger Data connection string to <code>.env</code> as{" "}
        <code>DATABASE_URL</code> (see the README).
      </p>
    );
  }

  const personal = audience === "eligible";
  const messageFor = (d: MatchedDonor) =>
    personal ? personalMessage(appeal, channel, d) : generalMessage(appeal, channel);
  const needed = data.groups.reduce((a, g) => a + g.needed, 0);
  const pledged = data.groups.reduce((a, g) => a + Math.min(g.pledged, g.needed), 0);

  const groupBlock = (g: DonorGroupMatch) => {
    const label = groupLabel(g.blood_group);
    const audienceList = personal ? g.donors.filter((d) => d.can_donate) : g.donors;
    const reachable = audienceList.filter((d) => contactFor(channel, d));
    const open = expanded.has(g.blood_group);
    const listed = open ? audienceList : audienceList.slice(0, SHOWN_PER_GROUP);
    const gap = g.needed - g.eligible;
    // Email and SMS can go to the whole group in one message; WhatsApp is one at a time,
    // and personal messages differ per donor.
    const bulk = !personal && channel !== "whatsapp" && reachable.length > 1;

    return (
      <div key={g.blood_group} className="donor-group">
        <div className="donor-group-head">
          <span className="donor-group-g">{label}</span>
          <span className="donor-group-n">
            <b>{Math.min(g.pledged, g.needed)}</b> of {g.needed} pledged · {g.deadline} ·{" "}
            <span className="muted">
              {g.eligible} of {g.on_file} on file can give now
            </span>
          </span>
          <span className="donor-bar" aria-hidden>
            <i style={{ width: `${Math.min(1, g.pledged / g.needed) * 100}%` }} />
          </span>
        </div>
        {gap > 0 && (
          <p className="donor-gap">
            {g.eligible === 0 ? "No" : `Only ${g.eligible}`} {label} donor{g.eligible === 1 ? "" : "s"} can give
            now. Share the appeal publicly to find {gap} more.
          </p>
        )}
        {bulk && (
          <a
            className="btn donor-bulk"
            href={sendLink(
              channel,
              generalMessage(appeal, channel),
              reachable.map((d) => contactFor(channel, d)!),
            )}
            onClick={() => record(reachable, "contacted", channel)}
          >
            {channel === "email" ? "Email" : "Text"} all {reachable.length} {label} donors
          </a>
        )}
        {personal && listed[0] && (
          <details className="donor-preview">
            <summary>Preview the message to {listed[0].name.split(" ")[0]}</summary>
            <pre>{messageFor(listed[0]).text}</pre>
          </details>
        )}
        <ul className="donor-list">
          {listed.map((d) => {
            const to = contactFor(channel, d);
            return (
              <li key={d.id} className="donor">
                <span className="donor-who">
                  <b>{d.name}</b>
                  <small>
                    {!d.last_donated
                      ? "Has not given blood yet"
                      : d.can_donate
                        ? `Last gave ${fmtDate(d.last_donated)} · can give again`
                        : `Gave ${fmtDate(d.last_donated)} · can give from ${fmtDate(d.can_donate_from!)}`}
                  </small>
                </span>
                {d.status && <span className={`donor-status is-${d.status}`}>{STATUS_LABEL[d.status]}</span>}
                <span className="donor-actions">
                  {to ? (
                    <a
                      href={sendLink(channel, messageFor(d), [to])}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => record([d], "contacted", channel)}
                    >
                      {d.status ? "Send again" : `Send by ${channelName(channel)}`}
                    </a>
                  ) : (
                    <span className="donor-none">No {channel === "email" ? "email" : "phone"} on file</span>
                  )}
                  {d.status !== "pledged" && d.status !== "declined" && (
                    <>
                      <button onClick={() => record([d], "pledged")}>Pledged</button>
                      <button onClick={() => record([d], "declined")}>Can't</button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {audienceList.length > SHOWN_PER_GROUP && (
          <button className="donor-more" onClick={() => toggleGroup(g.blood_group)}>
            {open ? "Show fewer" : `Show all ${audienceList.length}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="recipients">
      <div className="audience" role="radiogroup" aria-label="Who gets the appeal">
        <button
          role="radio"
          aria-checked={personal}
          className={personal ? "is-on" : ""}
          onClick={() => setAudience("eligible")}
        >
          <b>Only those who can give now</b>
          <small>A personal message with their name and when they last gave blood</small>
        </button>
        <button
          role="radio"
          aria-checked={!personal}
          className={!personal ? "is-on" : ""}
          onClick={() => setAudience("everyone")}
        >
          <b>Everyone with these blood types</b>
          <small>The appeal as written, including donors who gave recently and can share it</small>
        </button>
      </div>

      <p className="donors-summary">
        <b>{pledged}</b> of <b>{needed}</b> donors pledged · {data.registered} on file in {country}
      </p>
      {activity?.connected && (
        <p className="donors-activity">
          {activity.contacted + activity.pledged + activity.declined === 0
            ? "No messages sent from your account this week yet."
            : `This week: ${activity.contacted} message${activity.contacted === 1 ? "" : "s"} sent · ${activity.pledged} pledged · ${activity.declined} can't give`}
        </p>
      )}
      {error && <div className="alert">{error}</div>}

      {data.groups.map(groupBlock)}

      {adding ? (
        <AddDonorForm
          country={country}
          defaultGroup={needs[0]?.group ?? "O+"}
          onDone={(added) => {
            setAdding(false);
            if (added) reload();
          }}
        />
      ) : (
        <button className="btn btn-ghost" onClick={() => setAdding(true)}>
          + Add a donor
        </button>
      )}
    </div>
  );
}
