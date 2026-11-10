import { Icon } from "@bench/ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home } from "./components/Home.js";
import { fetchEventResults, fetchReplay } from "./lib/load.js";
import { buildModel, type ViewerModel } from "./lib/model.js";
import { type CameraView, parseParams, restartSearch } from "./lib/params.js";
import { type RaceIndex, trackEvents } from "./lib/races.js";
import type { EventResults } from "./lib/results.js";
import { INDEX_URL, parseRoute, raceReplayUrl, routeHref } from "./lib/route.js";
import { PHONE_QUERY } from "./usePhone.js";
import { Viewer } from "./Viewer.js";

const readLocation = () => ({
  route: parseRoute(window.location.pathname),
  params: parseParams(window.location.search),
});

interface Loaded {
  key: string;
  model: ViewerModel;
  results: EventResults | null;
}

export function App() {
  const [loc, setLoc] = useState(readLocation);
  const race = loc.route.page === "race" ? loc.route : null;
  const key = race ? `${race.track}/${race.event}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<RaceIndex | null>(null);
  // StrictMode runs effects twice in development; fetch each race once.
  const requested = useRef<string | null>(null);
  const indexed = useRef(false);

  // Phones draw half the trees, for frame rate; decided once, so a resize never rebuilds the scene.
  const trees = useMemo(() => (window.matchMedia?.(PHONE_QUERY).matches ? 700 : 1400), []);

  useEffect(() => {
    const onPop = () => setLoc(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!race || !key || requested.current === key) return;
    requested.current = key;
    setError(null);
    const url = raceReplayUrl(race.track, race.event);
    // The race on screen stays until the next one is ready.
    Promise.all([fetchReplay(url), fetchEventResults(url)])
      .then(([replay, results]) => {
        if (requested.current === key) setLoaded({ key, model: buildModel(replay, trees), results });
      })
      .catch((e: Error) => {
        if (requested.current === key) setError(e.message);
      });
  }, [race, key, trees]);

  useEffect(() => {
    if (!race || indexed.current) return;
    indexed.current = true;
    fetch(INDEX_URL)
      .then((res) => (res.ok ? (res.json() as Promise<RaceIndex>) : null))
      .then(setIndex)
      .catch(() => setIndex(null));
  }, [race]);

  const switchEvent = useCallback(
    (event: string, view: CameraView) => {
      if (!race) return;
      const path = routeHref({ page: "race", track: race.track, event });
      window.history.pushState(null, "", path + restartSearch(window.location.search, view));
      setLoc(readLocation());
    },
    [race],
  );

  if (!race) return <Home />;
  const back = routeHref({
    page: "races",
    ...(race.event !== index?.defaultEvent ? { event: race.event } : {}),
  });
  const list = index ? trackEvents(index.races, race.track) : [];
  if (loaded && !error)
    return (
      <Viewer
        key={loaded.key}
        model={loaded.model}
        backHref={back}
        backLabel="All races"
        resultsHref={routeHref({ page: "result", track: race.track, event: race.event })}
        params={loc.params}
        results={loaded.results}
        events={{ list, current: race.event, onChange: switchEvent }}
      />
    );
  return (
    <div className="race-load">
      <div className="race-load__card panel">
        <div className="brand">LLM RACING</div>
        {error ? <p className="error">{error}</p> : <p>Loading the race…</p>}
        <a className="race-load__back" href={back}>
          <Icon name="back" />
          All races
        </a>
      </div>
    </div>
  );
}
