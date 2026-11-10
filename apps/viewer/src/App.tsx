import type { Replay } from "@bench/sim";
import { Icon } from "@bench/ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Home } from "./components/Home.js";
import { fetchEventResults, fetchReplay } from "./lib/load.js";
import { buildModel } from "./lib/model.js";
import { parseParams } from "./lib/params.js";
import type { EventResults } from "./lib/results.js";
import { parseRoute, raceReplayUrl } from "./lib/route.js";
import { PHONE_QUERY } from "./usePhone.js";
import { Viewer } from "./Viewer.js";

export function App() {
  const params = useMemo(() => parseParams(window.location.search), []);
  const replayUrl = useMemo(() => {
    const route = parseRoute(window.location.pathname);
    return route.page === "race" ? raceReplayUrl(route.id) : null;
  }, []);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EventResults | null>(null);
  // StrictMode runs effects twice in development; fetch the race once.
  const requested = useRef(false);

  useEffect(() => {
    if (!replayUrl || requested.current) return;
    requested.current = true;
    fetchEventResults(replayUrl).then(setResults);
    fetchReplay(replayUrl)
      .then(setReplay)
      .catch((e: Error) => setError(e.message));
  }, [replayUrl]);

  // Phones draw half the trees, for frame rate; decided once, so a resize never rebuilds the scene.
  const trees = useMemo(() => (window.matchMedia?.(PHONE_QUERY).matches ? 700 : 1400), []);
  const model = useMemo(() => (replay ? buildModel(replay, trees) : null), [replay, trees]);

  if (!replayUrl) return <Home />;
  if (model)
    return <Viewer model={model} backHref="/" backLabel="All races" params={params} results={results} />;
  return (
    <div className="race-load">
      <div className="race-load__card panel">
        <div className="brand">LLM RACING</div>
        {error ? <p className="error">{error}</p> : <p>Loading the race…</p>}
        <a className="race-load__back" href="/">
          <Icon name="back" />
          All races
        </a>
      </div>
    </div>
  );
}
