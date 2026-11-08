import { useEffect, useState } from "react";
import { getCountries, saveCharityName, setTokenSource } from "./api";
import { AuthControls, useAuth } from "./auth";
import BrandMark from "./components/BrandMark";
import HotspotsPage from "./pages/HotspotsPage";
import PlanPage from "./pages/PlanPage";
import ReservoirPage from "./pages/ReservoirPage";
import TravelBriefPage from "./pages/TravelBriefPage";
import { hashQuery, scenarioQuery } from "./scenario";

/* Four pages, reached by buttons on each page rather than a nav bar:
   #/hotspots (the map) -> #/reservoir (blood stock + crisis simulator)
   -> #/plan (plan a blood drive from that crisis) -> #/briefing (before you travel).
   Each page's settings live in the hash query, so Back and copied links rebuild them. */

type Page = "hotspots" | "reservoir" | "plan" | "briefing";
const PAGES: Page[] = ["hotspots", "reservoir", "plan", "briefing"];

function readPage(): Page {
  const h = window.location.hash.replace("#/", "").split("?")[0];
  return PAGES.includes(h as Page) ? (h as Page) : "hotspots";
}

export default function App() {
  const auth = useAuth();
  // Set during render, not in an effect: the pages' first requests (their effects run
  // before this component's) already need the signed-in charity's token.
  setTokenSource(auth.getToken);
  const [page, setPage] = useState<Page>(readPage);
  const [country, setCountry] = useState(() => hashQuery().get("c") ?? "");

  useEffect(() => {
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // The charity's account row is created on its first request; this records its name.
  useEffect(() => {
    if (auth.signedIn) saveCharityName(auth.label).catch(() => undefined);
  }, [auth.signedIn, auth.label]);

  // Someone opening a page directly gets the first country until they pick one.
  useEffect(() => {
    getCountries()
      .then((list) => setCountry((c) => c || list[0] || ""))
      .catch(() => undefined);
  }, []);

  const go = (p: Page, query = "") => {
    window.location.hash = `#/${p}${query ? `?${query}` : ""}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const wide = page === "hotspots" ? "is-wide" : "";

  return (
    <div className="shell">
      <header className={`mast ${wide}`}>
        <div className="mast-inner">
          <a className="brand" href="#/hotspots" aria-label="SickleSignal home">
            <BrandMark />
            <span className="brand-word">
              <em>Sickle</em>Signal
            </span>
          </a>
          <AuthControls />
        </div>
      </header>

      <main className={`page ${page === "hotspots" ? "page-wide" : ""}`}>
        {page === "hotspots" && (
          <HotspotsPage
            onSelect={setCountry}
            onOpen={(c) => {
              setCountry(c);
              go("reservoir");
            }}
          />
        )}
        {page === "reservoir" && (
          <ReservoirPage
            country={country}
            onBack={() => go("hotspots")}
            onPlan={(s) => go("plan", scenarioQuery(s))}
          />
        )}
        {page === "plan" && (
          <PlanPage
            country={country}
            onCountry={setCountry}
            onBack={(s) => go("reservoir", scenarioQuery(s))}
            onTravel={(c) => go("briefing", new URLSearchParams({ c }).toString())}
          />
        )}
        {page === "briefing" && (
          <TravelBriefPage
            country={country}
            onCountry={setCountry}
            onBack={() => (window.history.length > 1 ? window.history.back() : go("plan"))}
          />
        )}
      </main>

      <footer className={`foot ${wide}`}>
        <span>SickleSignal</span>
        <span>Not a medical device · No clinical advice · Aggregate, modelled estimates only</span>
      </footer>
    </div>
  );
}
