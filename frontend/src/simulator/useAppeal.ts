import { useEffect, useState } from "react";
import { draftAppeal } from "../api";
import type { AppealResponse, Channel, CrisisResponse } from "../api";
import { needMaps } from "./needs";
import type { Need } from "./needs";

/** The appeal as the charity has it now: drafted by Gemini (or the template), then
 *  possibly edited. One text per channel. */
export interface Appeal {
  whatsapp: string;
  sms: string;
  email: string;
  emailSubject: string;
  source: AppealResponse["source"];
}

/* Drafting state for the appeal: draft, rewrite (a fresh version each time) and edits. */
export function useAppeal(res: CrisisResponse, needs: Need[], organisation?: string) {
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 0 = first draft; each Rewrite asks for a new version (1, 2, ...).
  const [variant, setVariant] = useState(0);

  // A new simulation result means a new appeal.
  useEffect(() => {
    setAppeal(null);
    setError(null);
    setVariant(0);
  }, [res]);

  const draft = (v: number) => {
    setBusy(true);
    setError(null);
    draftAppeal({
      country: res.country,
      people: res.people,
      days: res.days,
      verdict: res.verdict,
      ...needMaps(needs),
      organisation,
      patients_by_age: res.example_counts,
      variant: v,
    })
      .then((a) => {
        setVariant(v);
        setAppeal({
          whatsapp: a.whatsapp,
          sms: a.sms,
          email: a.email_body,
          emailSubject: a.email_subject,
          source: a.source,
        });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return {
    appeal,
    busy,
    error,
    draft: () => draft(0),
    rewrite: () => draft(variant + 1),
    edit: (channel: Channel, text: string) => setAppeal((a) => (a ? { ...a, [channel]: text } : a)),
  };
}
