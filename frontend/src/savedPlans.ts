/* Saved drive plans. Signed in: stored on the server under the user's Auth0 id. Local mode:
   stored in this browser only. A saved plan is just the plan's settings (its URL query). */
import { AUTH_ENABLED } from "./auth";

export interface SavedPlanItem {
  id: string;
  name: string;
  country: string;
  query: string;
  created_at: string;
}

const KEY = "sicklesignal.plans";
const MAX_LOCAL = 50;

function readLocal(): SavedPlanItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeLocal(items: SavedPlanItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_LOCAL)));
  } catch {
    /* storage blocked: saving just won't persist */
  }
}

async function call(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(String(detail));
  }
  return res.json();
}

const norm = (p: { id: number | string; name: string; country: string; query: string; created_at: string }): SavedPlanItem => ({
  ...p,
  id: String(p.id),
});

export async function listSavedPlans(token: string | null): Promise<SavedPlanItem[]> {
  if (!AUTH_ENABLED) return readLocal();
  if (!token) return [];
  return (await call("/api/plans", token)).map(norm);
}

export async function savePlan(token: string | null, name: string, country: string, query: string): Promise<SavedPlanItem> {
  if (!AUTH_ENABLED) {
    const item: SavedPlanItem = { id: String(Date.now()), name, country, query, created_at: new Date().toISOString() };
    writeLocal([item, ...readLocal()]);
    return item;
  }
  if (!token) throw new Error("Sign in to save plans.");
  return norm(await call("/api/plans", token, { method: "POST", body: JSON.stringify({ name, country, query }) }));
}

export async function deleteSavedPlan(token: string | null, id: string): Promise<void> {
  if (!AUTH_ENABLED) {
    writeLocal(readLocal().filter((p) => p.id !== id));
    return;
  }
  if (!token) throw new Error("Sign in to manage saved plans.");
  await call(`/api/plans/${encodeURIComponent(id)}`, token, { method: "DELETE" });
}
