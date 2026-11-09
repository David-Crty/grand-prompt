import { useEffect, useMemo, useState } from "react";
import { formatLapTime } from "../lib/format.js";
import {
  filterRaces,
  formatDate,
  type RaceEntry,
  type RaceIndex,
  sessionLabel,
  watchHref,
} from "../lib/races.js";

const INDEX_URL = "/results/index.json";

function Driver({ name, color }: { name: string; color: string }) {
  return (
    <span className="rl-driver">
      <span className="swatch" style={{ background: color }} />
      {name}
    </span>
  );
}

function Row({ r }: { r: RaceEntry }) {
  const dnf = r.cars - r.finished;
  return (
    <a className="rl-row" href={watchHref(r.replay)}>
      <div className="rl-main">
        <div className="rl-track">{r.trackName}</div>
        <div className="rl-sub">
          {sessionLabel(r)}
          {r.group !== r.type ? <span className="rl-group">{r.group}</span> : null}
          <span className="rl-id">{r.id}</span>
        </div>
      </div>
      <div className="rl-cell">
        <div className="rl-label">{r.type === "race" ? "Winner" : "P1"}</div>
        {r.winner ? (
          <>
            <Driver name={r.winner.name} color={r.winner.color} />
            <div className="rl-time">
              {r.winner.status === "FINISHED" || r.type !== "race"
                ? formatLapTime(r.winner.time)
                : r.winner.status}
            </div>
          </>
        ) : (
          <div className="rl-time">--</div>
        )}
      </div>
      <div className="rl-cell">
        <div className="rl-label">Fastest lap</div>
        {r.fastest ? (
          <>
            <Driver name={r.fastest.name} color={r.fastest.color} />
            <div className="rl-time purple">{formatLapTime(r.fastest.time)}</div>
          </>
        ) : (
          <div className="rl-time">--</div>
        )}
      </div>
      <div className="rl-cell rl-field">
        <div className="rl-label">Field</div>
        <div className="rl-swatches" title={r.drivers.map((d) => d.name).join(", ")}>
          {r.drivers.map((d) => (
            <span key={d.id} className="swatch" style={{ background: d.color }} />
          ))}
        </div>
        <div className="rl-time">
          {r.cars} {r.cars === 1 ? "car" : "cars"}
          {dnf > 0 ? <span className="rl-dnf"> · {dnf} not classified</span> : null}
        </div>
      </div>
      <div className="rl-cell rl-meta">
        <div>{formatDate(r.time)}</div>
        <div className="rl-sub">
          seed {r.seed} · sim {r.simVersion}
        </div>
      </div>
    </a>
  );
}

/** Home page: every replay under `results/`, newest first. */
export function RaceList({ error, loading }: { error: string | null; loading: string | null }) {
  const [index, setIndex] = useState<RaceIndex | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${INDEX_URL}`);
        return res.json() as Promise<RaceIndex>;
      })
      .then(setIndex)
      .catch((e: Error) => setFailed(e.message));
  }, []);

  const races = useMemo(() => filterRaces(index?.races ?? [], query), [index, query]);

  return (
    <div className="race-list">
      <header className="rl-head">
        <div>
          <div className="brand">GRAND PROMPT</div>
          <h1>Races</h1>
        </div>
        {index && index.races.length > 0 ? (
          <input
            className="rl-search"
            type="search"
            placeholder="Filter by track, driver, session…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : null}
      </header>
      {loading ? <p className="rl-note">Loading {loading}…</p> : null}
      {error ? <p className="rl-note error">{error}</p> : null}
      {failed ? <p className="rl-note error">Could not list races: {failed}</p> : null}
      {!index && !failed ? <p className="rl-note">Looking for races…</p> : null}
      {index && index.races.length === 0 ? (
        <p className="rl-note">
          No replays under results/ yet. Run <code>pnpm bench race …</code> to make one.
        </p>
      ) : null}
      {index && index.races.length > 0 && races.length === 0 ? (
        <p className="rl-note">No race matches “{query}”.</p>
      ) : null}
      <div className="rl-rows">
        {races.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </div>
      <p className="rl-note rl-foot">
        You can also drop a replay.json or replay.json.gz anywhere on this page, or open one with
        ?replay=&lt;url&gt;.
      </p>
    </div>
  );
}
