import { useState } from "react";
import type { FormEvent } from "react";
import { registerDonor } from "../api";
import { BLOOD_GROUPS, groupLabel } from "../format";

/* Sign a donor up to the registry. They must agree to be contacted and give a phone number
   or an email; the backend checks both (schemas.DonorIn). */

const EMPTY = { name: "", phone: "", email: "", last_donated: "", consent: false };

export default function AddDonorForm({
  country,
  defaultGroup,
  onDone,
}: {
  country: string;
  defaultGroup: string;
  /** Closed: `added` is true when a donor was saved. */
  onDone: (added: boolean) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY, blood_group: defaultGroup });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    registerDonor({
      name: form.name,
      phone: form.phone || undefined,
      email: form.email || undefined,
      blood_group: form.blood_group,
      country,
      last_donated: form.last_donated || undefined,
      consent: true,
    })
      .then(() => onDone(true))
      .catch((err) => setError(String(err).replace(/^Error: /, "")))
      .finally(() => setBusy(false));
  };

  return (
    <form className="add-donor" onSubmit={submit}>
      <h5>Add a donor in {country}</h5>
      <div className="add-donor-grid">
        <label>
          Name
          <input required value={form.name} onChange={set("name")} maxLength={80} />
        </label>
        <label>
          Blood type
          <select value={form.blood_group} onChange={set("blood_group")}>
            {BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {groupLabel(g)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phone number
          <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+233 20 123 4567" />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set("email")} />
        </label>
        <label>
          Last gave blood <small>(if known)</small>
          <input type="date" value={form.last_donated} onChange={set("last_donated")} />
        </label>
      </div>
      <label className="add-donor-consent">
        <input
          type="checkbox"
          required
          checked={form.consent}
          onChange={(e) => setForm({ ...form, consent: e.target.checked })}
        />
        They have agreed to be contacted when their blood type is needed.
      </label>
      {error && <div className="alert">{error}</div>}
      <div className="add-donor-actions">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save donor"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
