import { type Entry, entryVar, formatGap, formatLapTime } from "@bench/ui";
import { EntryChip } from "@bench/ui/react";
import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from "react";
import { eventEntries } from "../lib/entries.js";
import {
  fieldSpread,
  filterRaces,
  formatDate,
  formatLength,
  type RaceEntry,
  timedField,
} from "../lib/races.js";
import { routeHref } from "../lib/route.js";
import { TrackOutline } from "./TrackOutline.js";

function Chevron() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
      <path d="M1.5 1.5 6 6l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Podium({ r, entries }: { r: RaceEntry; entries: Map<string, Entry> }) {
  const top = timedField(r).slice(0, 3);
  return (
    <span className="rl-podium">
      {top.map((d, i) => {
        const e = entries.get(d.id);
        return (
          <span key={d.id} className="rl-podium__cell">
            <span className="rl-podium__pos">
              P{i + 1}
              {e ? <EntryChip entry={e} /> : null}
            </span>
            <span className={i === 0 ? "rl-time is-fastest" : "rl-time"}>
              {i === 0 ? formatLapTime(d.time) : formatGap(d.gap)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Spread({ r, entries }: { r: RaceEntry; entries: Map<string, Entry> }) {
  const { dots, span } = fieldSpread(r);
  const untimed = r.drivers.length - dots.length;
  return (
    <span className="rl-spread">
      <svg className="rl-spread__strip" aria-hidden="true">
        <line x1="4%" x2="96%" y1="8" y2="8" />
        {[...dots].reverse().map((d) => (
          <circle
            key={d.id}
            cx={`${(4 + d.at * 92).toFixed(2)}%`}
            cy="8"
            r="4.5"
            style={{ "--dot": entryVar(entries.get(d.id)) } as CSSProperties}
          />
        ))}
      </svg>
      <span className="rl-spread__ends">
        <span>Pole</span>
        <span>
          {dots.length ? `${formatGap(span)}s` : "No lap"}
          {untimed > 0 ? <span className="rl-dnf"> · {untimed} no time</span> : null}
        </span>
      </span>
    </span>
  );
}

function Row({
  r,
  active,
  shown,
  onActivate,
}: {
  r: RaceEntry;
  active: boolean;
  shown: boolean;
  onActivate: () => void;
}) {
  const entries = useMemo(() => eventEntries(r.drivers), [r.drivers]);
  return (
    <a
      className={active ? "rl-row is-active" : "rl-row"}
      href={routeHref({ page: "race", id: r.id })}
      onMouseEnter={onActivate}
      onFocus={onActivate}
    >
      <span className="rl-thumb">
        {r.outline ? <TrackOutline outline={r.outline} running={active} /> : null}
      </span>
      <span className="rl-main">
        <span className="rl-track">{r.trackName}</span>
        <span className="rl-sub">
          {r.outline ? <span>{formatLength(r.outline.length)}</span> : null}
          <span>
            {r.drivers.length} {r.drivers.length === 1 ? "car" : "cars"}
          </span>
          <span>{formatDate(r.time)}</span>
        </span>
      </span>
      <span className={shown ? "rl-results" : "rl-results is-concealed"} aria-hidden={!shown}>
        <Podium r={r} entries={entries} />
        <Spread r={r} entries={entries} />
      </span>
      <span className="rl-watch">
        Watch
        <Chevron />
      </span>
    </a>
  );
}

/** Home page: every replay under `results/`, newest first. */
export function RaceList({ races, shown }: { races: RaceEntry[]; shown: boolean }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterRaces(races, query), [races, query]);
  const activeId = visible.some((r) => r.id === active) ? active : (visible[0]?.id ?? null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll<HTMLAnchorElement>(".rl-row") ?? [])];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
    const next = at < 0 ? 0 : (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus();
  };

  return (
    <>
      <div className="home-head">
        <h1>Races</h1>
        {races.length > 0 ? (
          <input
            id="race-search"
            className="home-search"
            type="search"
            placeholder="Filter by circuit"
            aria-label="Filter races by circuit"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : null}
      </div>
      {races.length === 0 ? (
        <p className="home-note">
          No races under results/ yet. Run <code>pnpm bench race …</code> to make some.
        </p>
      ) : null}
      {races.length > 0 && visible.length === 0 ? (
        <p className="home-note">No circuit matches “{query}”.</p>
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the row links inside. */}
      <div className="rl-rows" ref={list} onKeyDown={onKeyDown}>
        {visible.map((r) => (
          <Row key={r.id} r={r} active={r.id === activeId} shown={shown} onActivate={() => setActive(r.id)} />
        ))}
      </div>
    </>
  );
}
