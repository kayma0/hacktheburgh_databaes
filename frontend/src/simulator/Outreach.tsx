import { useState } from "react";
import type { Channel, CrisisResponse } from "../api";
import { CHANNELS, channelName, generalMessage, sendLink } from "./messages";
import type { Need } from "./needs";
import Recipients from "./Recipients";
import { useAppeal } from "./useAppeal";

/* Turning the plan into action, in two steps:
   1. write the appeal (Gemini or the template) and pick WhatsApp, SMS or email;
   2. pick who gets it from the donor registry, by blood type: everyone (the appeal as
      written) or only donors who can give now (with their name and last donation). */
export default function Outreach({ res, needs }: { res: CrisisResponse; needs: Need[] }) {
  const [org, setOrg] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [copied, setCopied] = useState(false);
  const { appeal, busy, error, draft, rewrite, edit } = useAppeal(res, needs, org.trim() || undefined);

  const copy = () =>
    appeal &&
    navigator.clipboard?.writeText(appeal[channel]).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });

  return (
    <div className="outreach">
      <div className="step">
        <header className="step-head">
          <span className="step-n">1</span>
          <div>
            <h4>Write the urgent appeal</h4>
            <p>Gemini drafts it from the crisis above. Edit it if you like, then pick how to send it.</p>
          </div>
        </header>
        {!appeal ? (
          <div className="appeal-start">
            <input
              className="outreach-org"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="Your charity's name (optional)"
              aria-label="Your charity's name"
              maxLength={80}
            />
            <button className="btn" onClick={draft} disabled={busy}>
              {busy ? "Writing…" : "Draft the appeal"}
            </button>
          </div>
        ) : (
          <>
            <div className="appeal-tabs" role="tablist" aria-label="Send by">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={channel === c.id}
                  className={channel === c.id ? "is-on" : ""}
                  onClick={() => setChannel(c.id)}
                >
                  {c.name}
                </button>
              ))}
              <span className={`appeal-src ${appeal.source}`}>
                {appeal.source === "gemini" ? "Written by Gemini" : "Template"}
              </span>
            </div>
            {channel === "email" && <p className="appeal-subject">Subject: {appeal.emailSubject}</p>}
            <textarea
              className="appeal-text"
              value={appeal[channel]}
              onChange={(e) => edit(channel, e.target.value)}
              rows={channel === "sms" ? 4 : 9}
            />
            <div className="appeal-actions">
              <button className="btn btn-ghost" onClick={rewrite} disabled={busy}>
                {busy ? "Writing…" : "Rewrite"}
              </button>
              <button className="btn btn-ghost" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                className="btn btn-ghost"
                href={sendLink(channel, generalMessage(appeal, channel))}
                target="_blank"
                rel="noreferrer"
                title="Post it to a group or send it to anyone, outside the donor list"
              >
                Share publicly via {channelName(channel)}
              </a>
              {channel === "sms" && <small className="appeal-count">{appeal.sms.length} characters</small>}
            </div>
          </>
        )}
        {error && <div className="alert">Couldn't draft the appeal: {error}</div>}
      </div>

      {appeal && (
        <div className="step">
          <header className="step-head">
            <span className="step-n">2</span>
            <div>
              <h4>Send it to your donors by {channelName(channel)}</h4>
              <p>Your registered donors with the blood types in the plan.</p>
            </div>
          </header>
          <Recipients country={res.country} needs={needs} appeal={appeal} channel={channel} />
        </div>
      )}
    </div>
  );
}
