import { type Entry, entryVar, formatGap, formatLapTime } from "@bench/ui";
import {
  BuildFactsHelp,
  ClassificationTable,
  type ClassRow,
  Dropdown,
  EntryChip,
  EntryName,
  Icon,
  PositionBox,
  ResultList,
} from "@bench/ui/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { racePoints } from "../lib/drivers.js";
import { eventEntries } from "../lib/entries.js";
import { fetchRaceResults } from "../lib/load.js";
import { formatLength, pickEvent, type RaceEntry, type RaceIndex, trackEvents } from "../lib/races.js";
import {
  alsoRaced,
  circuitDrivers,
  circuits,
  eventEffort,
  fieldSummary,
  formatSpeed,
  formatTick,
  labelLanes,
  type RaceResults,
  type StripScale,
  stripAt,
  stripScale,
} from "../lib/result-page.js";
import { classificationRows } from "../lib/results.js";
import { routeHref } from "../lib/route.js";
import { usePhone } from "../usePhone.js";
import { useWidth } from "../useWidth.js";
import { buildHelp, PRICES, toClassRows } from "./Classification.js";
import { TrackOutline } from "./TrackOutline.js";

/** A label on the strip is this wide, in px, and the strip stacks them in up to this many rows. */
const LABEL_W = 40;
const LANES = 3;
/** Below this many px between ticks, only every other one is labelled. */
const TICK_GAP = 44;

const EXTRAS = [{ label: "Top speed" }, { label: "Off-track" }, { label: "Pts" }];

/** The events at the circuit, one tab each: its effort, its field and its pole. */
function EventTabs({
  races,
  event,
  efforts,
  entries,
  onPick,
}: {
  races: RaceEntry[];
  event: string;
  efforts: Map<string, string | null>;
  entries: Map<string, Entry>;
  onPick: (event: string) => void;
}) {
  return (
    <div className="rp-tabs" role="tablist" aria-label="Event">
      {races.map((r) => {
        const pole = r.drivers.find((d) => d.time != null);
        const e = pole ? entries.get(pole.id) : undefined;
        const effort = efforts.get(r.event);
        return (
          <button
            key={r.event}
            type="button"
            role="tab"
            aria-selected={r.event === event}
            className="rp-tab"
            onClick={() => onPick(r.event)}
          >
            <span className="rp-tab__top">
              <span className="rp-tab__name">{r.event}</span>
              <span className="rp-tab__meta">
                {effort ? `${effort} effort · ` : ""}
                {r.drivers.length} {r.drivers.length === 1 ? "car" : "cars"}
              </span>
            </span>
            <span className="rp-tab__pole">
              <span className="gp-faint">P1</span>
              {e ? <EntryChip entry={e} /> : null}
              <span className="is-fastest">{pole?.time != null ? formatLapTime(pole.time) : "No lap"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Podium({ race, entries }: { race: RaceEntry; entries: Map<string, Entry> }) {
  const timed = race.drivers.filter((d): d is typeof d & { time: number } => d.time != null).slice(0, 3);
  const pole = timed[0]?.time ?? 0;
  return (
    <div className="rp-podium">
      {timed.map((d, i) => {
        const e = entries.get(d.id);
        return e ? (
          <div key={d.id} className="rp-podium__cell gp-panel gp-panel--solid">
            <PositionBox position={i + 1} />
            <span className="rp-podium__who">
              <EntryName entry={e} />
              <span className={i === 0 ? "rp-podium__time is-fastest" : "rp-podium__time"}>
                {i === 0 ? formatLapTime(d.time) : formatGap(d.time - pole)}
              </span>
            </span>
          </div>
        ) : null;
      })}
    </div>
  );
}

/**
 * The field on one time axis for every event at the circuit: a car keeps its dot from event to event, so
 * switching slides it to its lap time there. Cars without a time sit apart.
 */
function FieldStrip({
  race,
  scale,
  entries,
  trackName,
}: {
  race: RaceEntry;
  scale: StripScale | null;
  entries: Map<string, Entry>;
  trackName: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const timed = race.drivers.filter((d): d is typeof d & { time: number } => d.time != null);
  const untimed = race.drivers.filter((d) => d.time == null);
  const at = (t: number) => (scale ? stripAt(t, scale) : 0);
  const steps = (scale?.ticks.length ?? 1) - 1;
  const every = width > 0 && steps > 0 && width / steps < TICK_GAP ? 2 : 1;
  const lanes = labelLanes(
    timed.map((d) => at(d.time) * width),
    LABEL_W,
    LANES,
  );
  return (
    <section className="rp-strip gp-panel gp-panel--solid" aria-label="The field">
      <div className="rp-strip__head">
        <span className="gp-label">Field</span>
        <span className="gp-faint">
          One scale for every event at {trackName}: switching moves the cars, not the axis.
        </span>
      </div>
      <div className="rp-strip__body">
        <div className="rp-strip__axis" ref={ref}>
          <span className="rp-strip__line" />
          {scale?.ticks.map((t, k) =>
            k % every === 0 ? (
              <span key={t} className="rp-strip__tick" style={{ left: `${at(t) * 100}%` }}>
                {formatTick(t)}
              </span>
            ) : null,
          )}
          {timed.map((d, i) => {
            const e = entries.get(d.id);
            return e ? (
              <span
                key={d.id}
                className="rp-strip__car"
                title={`${e.name}: ${formatLapTime(d.time)}`}
                style={
                  {
                    left: `${at(d.time) * 100}%`,
                    "--dot": entryVar(e),
                    "--lane": lanes[i],
                  } as CSSProperties
                }
              >
                <span className="rp-strip__dot" />
                <EntryChip entry={e} />
              </span>
            ) : null;
          })}
        </div>
        <div className="rp-strip__none">
          <span className="gp-label">No time</span>
          {untimed.map((d) => {
            const e = entries.get(d.id);
            return e ? <EntryChip key={d.id} entry={e} out /> : null;
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * One race's results, beside the circuit's other events: a tab per event, the podium, the field on an axis shared
 * by every event there, and the full classification.
 */
export function ResultPage({
  index,
  track,
  event,
  onOpen,
}: {
  index: RaceIndex;
  track: string;
  event: string;
  /** Go to another race's results, by circuit and event. */
  onOpen: (track: string, event: string) => void;
}) {
  const phone = usePhone();
  const events = useMemo(() => trackEvents(index.races, track), [index, track]);
  const races = useMemo(
    () => events.flatMap((ev) => index.races.filter((r) => r.track === track && r.event === ev)),
    [index, track, events],
  );
  const race = races.find((r) => r.event === event) ?? null;
  const info = races[0] ?? null;
  const entries = useMemo(() => eventEntries(circuitDrivers(races)), [races]);
  const scale = useMemo(
    () => stripScale(races.flatMap((r) => r.drivers.flatMap((d) => (d.time != null ? [d.time] : [])))),
    [races],
  );

  const [loaded, setLoaded] = useState<Map<string, RaceResults | string>>(() => new Map());
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const ev of events) {
      const key = `${track}/${ev}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      fetchRaceResults(track, ev)
        .then((r) => setLoaded((m) => new Map(m).set(key, r)))
        .catch((e: Error) => setLoaded((m) => new Map(m).set(key, e.message)));
    }
  }, [track, events]);
  const current = loaded.get(`${track}/${event}`);
  const efforts = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const ev of events) {
      const r = loaded.get(`${track}/${ev}`);
      out.set(ev, typeof r === "object" ? eventEffort(r.results) : null);
    }
    return out;
  }, [loaded, track, events]);

  const table = useMemo(() => {
    if (typeof current !== "object") return null;
    const cars = new Map(current.classification.map((c) => [c.id, c]));
    const rows: ClassRow[] = toClassRows(
      classificationRows(current.classification, [], current.results, PRICES),
      entries,
    ).map((r) => {
      const c = cars.get(r.entry.id);
      return {
        ...r,
        extra: [
          c ? formatSpeed(c.maxSpeed) : "–",
          c ? String(c.offTracks) : "–",
          String(racePoints(r.position, r.lapTime)),
        ],
      };
    });
    return {
      rows,
      full: rows.some((r) => r.build),
      sectors: Math.max(1, ...current.classification.map((c) => c.lap?.sectors.length ?? 0)),
      help: buildHelp(current.results),
    };
  }, [current, entries]);

  const allRaces = routeHref({
    page: "races",
    ...(event !== index.defaultEvent ? { event } : {}),
  });
  const pickCircuit = (to: string) =>
    onOpen(to, pickEvent(event, trackEvents(index.races, to), index.defaultEvent) ?? event);

  if (!info)
    return (
      <p className="home-note">
        No race at {track}. <a href={allRaces}>All races</a>
      </p>
    );
  const summary = race ? fieldSummary(race.drivers) : null;
  const also = alsoRaced(races, event);
  return (
    <div className="rp">
      <a className="rp-back" href={allRaces}>
        <Icon name="back" />
        All races
      </a>
      <header className="rp-head">
        <span className="rp-thumb">{info.outline ? <TrackOutline outline={info.outline} /> : null}</span>
        <div className="rp-title">
          <span className="gp-label">Results</span>
          <h1>{info.trackName}</h1>
          <span className="rp-sub">
            {info.outline ? <span>{formatLength(info.outline.length)}</span> : null}
            <span>
              {events.length} {events.length === 1 ? "event" : "events"}
            </span>
            <span>One flying lap, each car alone</span>
          </span>
        </div>
        <Dropdown
          options={circuits(index.races).map((c) => ({ value: c.track, label: c.name }))}
          value={track}
          onChange={pickCircuit}
          label="Circuit"
          icon="map"
        />
      </header>
      <EventTabs
        races={races}
        event={event}
        efforts={efforts}
        entries={entries}
        onPick={(ev) => onOpen(track, ev)}
      />
      {race ? (
        <>
          <div className="rp-actions">
            <a className="gp-btn gp-btn--primary" href={routeHref({ page: "race", track, event })}>
              <Icon name="play" />
              Watch {event} in 3D
            </a>
            <a className="gp-btn gp-btn--secondary" href={routeHref({ page: "drivers", event })}>
              Drivers in {event}
            </a>
            <span className="gp-flex" />
            {summary ? (
              <span className="rp-summary">
                <b>
                  {summary.valid} of {summary.cars}
                </b>{" "}
                set a valid lap
                {summary.spread != null ? (
                  <>
                    {" "}
                    · field spread <b>{formatLapTime(summary.spread)} s</b>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          {!phone ? <Podium race={race} entries={entries} /> : null}
          <FieldStrip race={race} scale={scale} entries={entries} trackName={info.trackName} />
          {typeof current === "string" ? <p className="home-note error">{current}</p> : null}
          {current === undefined ? <p className="home-note">Loading the results…</p> : null}
          {table ? (
            phone ? (
              <ResultList rows={table.rows} showBuild={table.full} />
            ) : (
              <ClassificationTable
                rows={table.rows}
                columns={table.full ? "full" : "lap"}
                sectors={table.sectors}
                buildHelp={<BuildFactsHelp {...table.help} />}
                extras={EXTRAS}
              />
            )
          ) : null}
          <p className="gp-table__foot">
            Purple: the fastest lap and the fastest time in each sector. Off-track deletes the lap. Points:
            10-8-6-5-4-3-2-1 for a valid lap. Lap times compare across events: same seed, car and circuit,
            each car alone.
          </p>
          {also.length ? (
            <div className="rp-also">
              <span className="gp-label">Raced here in another event, not in {event}</span>
              <span className="rp-also__list">
                {also.map((m) => {
                  const e = entries.get(m.id);
                  return e ? (
                    <span key={m.id} className="rp-also__item">
                      <EntryName entry={e} />
                      <span className="gp-faint">{m.events.join(", ")}</span>
                    </span>
                  ) : null;
                })}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <p className="home-note">
          {event} did not race at {info.trackName}: pick one of its events above.
        </p>
      )}
    </div>
  );
}
