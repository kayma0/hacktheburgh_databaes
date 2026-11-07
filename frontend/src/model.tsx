import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Overrides } from "./api";

/** Shared model settings (burden source + user overrides of ASSUMPTIONs), used by every page. */
interface ModelCtx {
  source: string;
  setSource: (s: string) => void;
  overrides: Overrides;            // debounced: what queries use
  draft: Overrides;                // live slider values
  setOverride: (name: string, field: string, value: number) => void;
  reset: () => void;
}

const Ctx = createContext<ModelCtx | null>(null);

export function ModelProvider({ children, defaultSource }: { children: ReactNode; defaultSource: string }) {
  const [source, setSource] = useState(defaultSource);
  const [draft, setDraft] = useState<Overrides>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  useEffect(() => setSource(defaultSource), [defaultSource]);
  useEffect(() => {
    const t = setTimeout(() => setOverrides(draft), 350);
    return () => clearTimeout(t);
  }, [draft]);
  const value = useMemo<ModelCtx>(() => ({
    source, setSource, overrides, draft,
    setOverride: (name, field, v) => setDraft((d) => ({ ...d, [name]: { ...(d[name] ?? {}), [field]: v } })),
    reset: () => setDraft({}),
  }), [source, overrides, draft]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModel(): ModelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useModel outside ModelProvider");
  return c;
}
