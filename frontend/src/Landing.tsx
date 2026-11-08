/* The first page a signed-out visitor sees: logo, slogan and the charity sign-in card.
   `Gate` decides whether to show it; the app itself is untouched underneath.

   - Signed in                -> the app.
   - Signed out               -> this page. There is no guest mode: a charity must sign in.
   - Auth0 not configured     -> the app (local mode), since nobody could ever sign in. */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useAuth } from "./auth";
import type { AuthApi } from "./auth";
import "./landing.css";

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function Gate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.enabled) return <>{children}</>;
  // Auth0 is checking for an existing session (or finishing a login): avoid flashing the
  // landing page at someone who is already signed in.
  if (!auth.ready) return <Splash />;
  if (auth.signedIn) return <>{children}</>;
  return <Landing auth={auth} />;
}

function Splash() {
  return (
    <div className="lp lp-splash" role="status" aria-label="Loading">
      <Mark className="lp-splash-mark" />
    </div>
  );
}

/* ───────────────────────── logo ───────────────────────── */

function Mark({ className = "", thump = 0 }: { className?: string; thump?: number }) {
  return (
    <svg className={className} viewBox="60 60 1056 880" aria-hidden>
      <path d="M85 318Q588-152 1091 318Q588 32 85 318Z" fill="#EC93A2" className="lp-arc lp-arc-1" />
      <path d="M202 417Q588 57 973 417Q588 211 202 417Z" fill="#DE4E66" className="lp-arc lp-arc-2" />
      <path
        key={thump}
        d="M588 377L430 650A183 183 0 1 0 746 650Z"
        fill="#D81F3A"
        className={`lp-drop ${thump ? "is-thump" : ""}`}
      />
    </svg>
  );
}

/* A heartbeat line along the bottom with a bright pulse travelling along it. */
const ECG = (() => {
  let d = "M0 40";
  for (const x of [150, 450, 750, 1050])
    d += ` H${x - 36} q8 -10 16 0 H${x - 8} l6 -4 l10 -30 l12 64 l10 -34 l5 4 H${x + 46} q10 -12 20 0`;
  return `${d} H1200`;
})();

function Ecg() {
  return (
    <svg className="lp-ecg" viewBox="0 0 1200 80" preserveAspectRatio="none" aria-hidden>
      <path d={ECG} className="lp-ecg-base" vectorEffect="non-scaling-stroke" />
      <path
        d={ECG}
        pathLength={1200}
        className="lp-ecg-pulse"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ───────────────────────── the page ───────────────────────── */

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function Landing({ auth }: { auth: AuthApi }) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"in" | "up">("in");
  const [thump, setThump] = useState(0);
  const signup = tab === "up";
  const ready = auth.ready;

  // Cursor position, as -1..1 across the window, drives the logo and card tilt.
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    const move = (e: PointerEvent) => {
      el.style.setProperty("--px", String((e.clientX / window.innerWidth) * 2 - 1));
      el.style.setProperty("--py", String((e.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  const spotlight = (e: ReactPointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--cx", `${e.clientX - box.left}px`);
    e.currentTarget.style.setProperty("--cy", `${e.clientY - box.top}px`);
  };

  return (
    <div ref={root} className="lp">
      <div className="lp-glow" aria-hidden />

      <div className="lp-wrap">
        <section className="lp-hero">
          <div className="lp-brand lp-rise">
            <button
              className="lp-logo"
              onClick={() => setThump((n) => n + 1)}
              aria-label="SickleSignal logo"
              title="Send a signal"
            >
              <Mark className="lp-logo-svg" thump={thump} />
            </button>
            <span className="lp-name">
              <em>Sickle</em>Signal
            </span>
          </div>

          <h1 className="lp-slogan">
            <span className="lp-rise" style={{ animationDelay: "120ms" }}>
              Spot the need.
            </span>
            <span className="lp-rise lp-slogan-2" style={{ animationDelay: "260ms" }}>
              <em>Send the signal.</em>
            </span>
          </h1>
        </section>

        <aside
          className="lp-card lp-rise"
          style={{ animationDelay: "260ms" }}
          onPointerMove={spotlight}
          aria-label="Charity sign in"
        >
          <div className="lp-tabs" data-tab={tab} role="tablist">
            <button
              role="tab"
              aria-selected={tab === "in"}
              className={tab === "in" ? "is-on" : ""}
              onClick={() => setTab("in")}
            >
              Charity log in
            </button>
            <button
              role="tab"
              aria-selected={tab === "up"}
              className={tab === "up" ? "is-on" : ""}
              onClick={() => setTab("up")}
            >
              Register your charity
            </button>
          </div>

          <h2 key={tab} className="lp-card-title">
            {signup ? "Sign up your charity" : "Welcome back"}
          </h2>
          <p className="lp-card-sub">
            {signup
              ? "Create an account for your charity to start planning blood drives."
              : "Log in with your charity account details."}
          </p>

          <button
            className="lp-btn lp-btn-main"
            disabled={!ready}
            onClick={() => auth.login({ signup })}
          >
            {signup ? "Register your charity" : "Log in to your charity"}
            <span aria-hidden>→</span>
          </button>

          <div className="lp-or">
            <span>or</span>
          </div>

          <button
            className="lp-btn lp-btn-google"
            disabled={!ready}
            onClick={() => auth.login({ signup, connection: "google-oauth2" })}
          >
            <GoogleG />
            Continue with Google
          </button>
        </aside>
      </div>

      <Ecg />
      <footer className="lp-foot">
        Not a medical device · No clinical advice · Aggregate, modelled estimates only
      </footer>
    </div>
  );
}
