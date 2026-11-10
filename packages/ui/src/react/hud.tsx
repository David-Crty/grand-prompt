import * as React from "react";
import { CAMERA_LABEL, CAMERA_MODES, type CameraMode } from "../cameras.js";
import { type Entry, entryVar } from "../entries.js";
import { formatClock, formatGap, formatLapTime, kmh } from "../format.js";
import { mergeMarkers, type TimelineMarker } from "../timeline.js";
import { lapOrDash, type TimingRow } from "../timing.js";
import { Icon, type IconName, MarkerIcon } from "./icons.js";
import {
  cx,
  EntryChip,
  EntryName,
  entryStyle,
  IconButton,
  PositionBox,
  SegmentedControl,
  Stat,
  StatusBadge,
} from "./primitives.js";
import { GapText } from "./timing.js";

// ------------------------------------------------------------------ telemetry and focus card

/** Telemetry of one car at one instant. Speed in m/s; surface 0 track, 1 kerb, 2 grass, 3 gravel, 4 barrier. */
export interface TelemetrySample {
  speed: number;
  throttle: number;
  brake: number;
  steer: number;
  surface: number;
  ended: boolean;
}

const SURFACES = ["TRACK", "KERB", "GRASS", "GRAVEL", "BARRIER"];
const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;

export function TelemetryGauge({ sample }: { sample: TelemetrySample | null }) {
  const live = sample && !sample.ended ? sample : null;
  const surface = sample?.surface ?? 0;
  return (
    <div className="gp-gauges">
      <div className="gp-vbar gp-vbar--thr">
        <div className="gp-vbar__track">
          <i className="gp-vbar__fill" style={{ height: pct(live?.throttle ?? 0) }} />
        </div>
        <span className="gp-vbar__k">THR</span>
      </div>
      <div className="gp-vbar gp-vbar--brk">
        <div className="gp-vbar__track">
          <i className="gp-vbar__fill" style={{ height: pct(live?.brake ?? 0) }} />
        </div>
        <span className="gp-vbar__k">BRK</span>
      </div>
      <div className="gp-steer">
        <div className="gp-steer__row">
          <span className="gp-vbar__k">STEER</span>
          <span className={cx("gp-surface", surface >= 2 && "gp-surface--off")}>
            {SURFACES[surface] ?? "TRACK"}
          </span>
        </div>
        <div className="gp-steer__track">
          <i className="gp-steer__tick" style={{ left: `${50 - (live?.steer ?? 0) * 50}%` }} />
        </div>
      </div>
    </div>
  );
}

export function FocusCard({
  row,
  entry,
  sample,
  lap,
  fastest,
}: {
  row: TimingRow;
  entry: Entry;
  sample: TelemetrySample | null;
  /** Running time since the line, and the lap time once it is timed. */
  lap: { current: number | null; time: number | null };
  fastest: boolean;
}) {
  const speed = !sample || sample.ended || row.out ? 0 : kmh(sample.speed);
  return (
    <section className={cx("gp-focus gp-panel", row.out && "is-out")} aria-label="Followed car">
      <div className="gp-focus__band" style={entryStyle(entry)}>
        <PositionBox position={row.position} out={row.out} />
        <EntryName entry={entry} meta />
        <span className="gp-flex" />
        {row.out ? (
          <StatusBadge kind="dnf">DNF</StatusBadge>
        ) : row.deleted ? (
          <StatusBadge kind="warn">DEL</StatusBadge>
        ) : row.finished ? (
          <StatusBadge kind="fin">FIN</StatusBadge>
        ) : null}
      </div>
      <div className="gp-focus__body">
        <div className="gp-speed">
          <span className="gp-speed__v">{speed}</span>
          <span className="gp-speed__u">KM/H</span>
        </div>
        <TelemetryGauge sample={sample} />
      </div>
      <div className="gp-focus__laps">
        <Stat
          k="Lap"
          v={row.out || row.finished ? "–" : lapOrDash(lap.current, (t) => formatLapTime(t, 1))}
        />
        <Stat
          k="Time"
          v={row.deleted ? "No time" : lapOrDash(lap.time, (t) => formatLapTime(t))}
          fastest={fastest}
        />
        <Stat k="Gap" v={row.position === 1 || row.gap == null ? "–" : formatGap(row.gap)} />
      </div>
    </section>
  );
}

/** The phone's followed-car row: position, chip, name, speed, pedals and gap on one line. */
export function FocusRow({
  row,
  entry,
  sample,
}: {
  row: TimingRow;
  entry: Entry;
  sample: TelemetrySample | null;
}) {
  const live = sample && !sample.ended && !row.out ? sample : null;
  return (
    <div className="gp-frow" style={entryStyle(entry)}>
      <PositionBox position={row.position} out={row.out} />
      <EntryChip entry={entry} out={row.out} />
      <span className="gp-entry__name gp-trunc gp-frow__name">{entry.name}</span>
      <span className="gp-frow__speed gp-c">{live ? kmh(live.speed) : 0}</span>
      <span className="gp-speed__u">KM/H</span>
      <span className="gp-frow__pedals" aria-hidden="true">
        <i className="thr" style={{ height: `${Math.max(2, (live?.throttle ?? 0) * 24)}px` }} />
        <i className="brk" style={{ height: `${Math.max(2, (live?.brake ?? 0) * 24)}px` }} />
      </span>
      <GapText row={row} className="gp-c gp-frow__gap" />
    </div>
  );
}

// ------------------------------------------------------------------ race messages

export type ToastKind = "dnf" | "warn" | "fastest" | "finish" | "info";
const TOAST_ICON: Record<ToastKind, IconName> = {
  dnf: "cross",
  warn: "warn",
  fastest: "stopwatch",
  finish: "flag",
  info: "info",
};

export function RaceToast({
  kind,
  entry,
  text,
  t,
  action,
  compact = false,
}: {
  kind: ToastKind;
  entry?: Entry | null;
  text: string;
  t?: number | null;
  action?: { label: string; onClick: () => void } | null;
  compact?: boolean;
}) {
  return (
    <div className={cx("gp-toast", `gp-toast--${kind}`, compact && "gp-toast--compact")} role="status">
      <span className="gp-toast__kind">
        <Icon name={TOAST_ICON[kind]} />
      </span>
      {entry ? <EntryChip entry={entry} /> : null}
      <span className="gp-toast__text">{text}</span>
      {action ? (
        <button type="button" className="gp-toast__more" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      {t != null && !compact ? <span className="gp-toast__t">{formatClock(t)}</span> : null}
    </div>
  );
}

export function ToastStack({ children }: { children: React.ReactNode }) {
  return (
    <div className="gp-toasts" aria-live="polite">
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ timeline and transport

/** Hook: the element's width, kept current with a ResizeObserver. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Timeline({
  duration,
  t,
  markers,
  activeT = null,
  onSeek,
  onMarker,
  size = "m",
}: {
  duration: number;
  t: number;
  markers: TimelineMarker[];
  /** A marker at this time is drawn active (incident replay). */
  activeT?: number | null;
  onSeek: (t: number) => void;
  onMarker?: (m: TimelineMarker) => void;
  size?: "m" | "touch";
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<TimelineMarker | null>(null);
  const merged = React.useMemo(
    () => mergeMarkers(markers, duration, width, size === "touch" ? 18 : 12),
    [markers, duration, width, size],
  );
  // The active marker may have merged with others: take the nearest within the merge distance.
  const tol = ((size === "touch" ? 18 : 12) / Math.max(1, width)) * duration + 0.5;
  const active =
    activeT == null
      ? null
      : (merged
          .filter((m) => Math.abs(m.t - activeT) <= tol)
          .sort((a, b) => Math.abs(a.t - activeT) - Math.abs(b.t - activeT))[0] ?? null);
  const at = (x: number) => `${(Math.min(1, Math.max(0, x / Math.max(1e-9, duration))) * 100).toFixed(3)}%`;
  const seekFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))) * duration);
  };
  return (
    <div
      ref={ref}
      className={cx("gp-timeline", size === "touch" && "gp-timeline--touch")}
      role="slider"
      tabIndex={0}
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={`${formatClock(t)} of ${formatClock(duration)}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFrom(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFrom(e);
      }}
    >
      <div className="gp-timeline__track" />
      <div className="gp-timeline__played" style={{ width: at(t) }} />
      {merged.map((m) => (
        <button
          type="button"
          key={`${m.kind}-${m.t}`}
          className={cx("gp-mark", `gp-mark--${m.kind}`, m === active && "is-active")}
          style={{ left: at(m.t) }}
          aria-label={m.label}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => setHover(m)}
          onPointerLeave={() => setHover((h) => (h === m ? null : h))}
          onFocus={() => setHover(m)}
          onBlur={() => setHover(null)}
          onClick={() => onMarker?.(m)}
        >
          <MarkerIcon kind={m.kind} />
        </button>
      ))}
      <span className="gp-timeline__head" style={{ left: at(t) }} />
      {(() => {
        const tip = hover ?? active;
        return tip ? (
          <span className="gp-tip" style={{ left: at(tip.t), top: -4 }}>
            {tip.label}
          </span>
        ) : null;
      })()}
    </div>
  );
}

export type TransportFlag = "trails" | "analysis" | "classification" | "help";

export function TransportBar({
  t,
  duration,
  playing,
  speed,
  canSlower,
  canFaster,
  camera,
  markers,
  activeT,
  toggles,
  onToggle,
  onSeek,
  onMarker,
  onSpeed,
  onCamera,
  onFlag,
}: {
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  canSlower: boolean;
  canFaster: boolean;
  camera: CameraMode;
  markers: TimelineMarker[];
  activeT?: number | null;
  toggles: { trails: boolean; analysis: boolean; classification: boolean };
  onToggle: () => void;
  onSeek: (t: number) => void;
  onMarker?: (m: TimelineMarker) => void;
  onSpeed: (dir: 1 | -1) => void;
  onCamera: (c: CameraMode) => void;
  onFlag: (f: TransportFlag) => void;
}) {
  return (
    <div className="gp-transport gp-panel gp-panel--solid">
      <IconButton
        icon={playing ? "pause" : "play"}
        iconSize={20}
        variant="primary"
        label={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={onToggle}
      />
      <span className="gp-transport__time">
        <b>{formatClock(t)}</b> / {formatClock(duration)}
      </span>
      <Timeline
        duration={duration}
        t={t}
        markers={markers}
        activeT={activeT}
        onSeek={onSeek}
        onMarker={onMarker}
      />
      <fieldset className="gp-seg" aria-label="Playback speed">
        <button
          type="button"
          aria-label="Slower"
          title="Slower (− or ↓)"
          disabled={!canSlower}
          onClick={() => onSpeed(-1)}
        >
          <Icon name="minus" />
        </button>
        <button type="button" aria-pressed="true" title="Playback speed">
          {speed}×
        </button>
        <button
          type="button"
          aria-label="Faster"
          title="Faster (+ or ↑)"
          disabled={!canFaster}
          onClick={() => onSpeed(1)}
        >
          <Icon name="plus" />
        </button>
      </fieldset>
      <SegmentedControl<CameraMode>
        label="Camera"
        value={camera}
        onChange={onCamera}
        options={CAMERA_MODES.map((c, k) => ({
          value: c,
          label: CAMERA_LABEL[c],
          title: `${CAMERA_LABEL[c]} (${k + 1})`,
        }))}
      />
      <fieldset className="gp-seg" aria-label="Overlays">
        <button
          type="button"
          aria-pressed={toggles.trails}
          aria-label="Trails"
          title="Trails (T)"
          onClick={() => onFlag("trails")}
        >
          <Icon name="trail" />
        </button>
        <button
          type="button"
          aria-pressed={toggles.analysis}
          aria-label="Analysis"
          title="Analysis (A)"
          onClick={() => onFlag("analysis")}
        >
          <Icon name="chart" />
        </button>
        <button
          type="button"
          aria-pressed={toggles.classification}
          aria-label="Classification"
          title="Classification (C)"
          onClick={() => onFlag("classification")}
        >
          <Icon name="list" />
        </button>
      </fieldset>
      <IconButton icon="help" label="Keyboard shortcuts (?)" onClick={() => onFlag("help")} />
    </div>
  );
}

// ------------------------------------------------------------------ in the scene

/** Label above a car. The viewer positions its wrapper every frame; this draws the tag itself. */
export function CarLabel({
  entry,
  position,
  focused = false,
  out = false,
  name = true,
}: {
  entry: Entry;
  position: number | null;
  focused?: boolean;
  out?: boolean;
  /** Show the name next to the code when focused (not on the map). */
  name?: boolean;
}) {
  return (
    <div className={cx("gp-clabel", focused && "is-focused", out && "is-out")} style={entryStyle(entry)}>
      {position !== null && !out ? <span className="gp-clabel__pos">{position}</span> : null}
      <span className="gp-clabel__code">{entry.code}</span>
      {focused && name ? <span className="gp-clabel__name">{entry.name}</span> : null}
    </div>
  );
}

/** Where a retired car stopped. */
export function IncidentPin({ label }: { label?: string }) {
  return (
    <div className="gp-pin gp-pin--dnf" title={label}>
      <span className="gp-pin__head">
        <Icon name="cross" />
      </span>
      <span className="gp-pin__stem" />
    </div>
  );
}

// ------------------------------------------------------------------ minimap

export interface MapCar {
  id: string;
  x: number;
  y: number;
  entry: Entry;
  focused: boolean;
}

export function MiniMap({
  width,
  height,
  path,
  start,
  cars = [],
  pins = [],
  stroke = 7,
  onFocus,
  onPin,
}: {
  width: number;
  height: number;
  /** SVG path of the centreline in map pixels. */
  path: string;
  /** Start line: x1, y1, x2, y2. */
  start: [number, number, number, number];
  /** Drawn back to front: put the leader last and the followed car after it. */
  cars?: MapCar[];
  pins?: { id: string; x: number; y: number; label: string }[];
  stroke?: number;
  onFocus?: (id: string) => void;
  /** A retired car's pin: open its incident. */
  onPin?: (id: string) => void;
}) {
  return (
    <svg
      className="gp-map"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Track map"
    >
      <path className="edge" d={path} strokeWidth={stroke + 3} />
      <path className="ribbon" d={path} strokeWidth={stroke} />
      <line className="start" x1={start[0]} y1={start[1]} x2={start[2]} y2={start[3]} />
      {pins.map((p) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the race messages' "Why" opens the same incident
        <g
          key={`pin-${p.id}`}
          transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
          className="gp-map__pin"
          onClick={() => onPin?.(p.id)}
        >
          <title>{p.label}</title>
          <rect x={-8} y={-24} width={16} height={16} rx={2} />
          <path d="M-4 -20l8 8M4 -20l-8 8" className="x" />
          <path d="M0 -8v6" className="stem" />
        </g>
      ))}
      {cars.map((c) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the tower rows are the accessible way to pick a car
        <g
          key={c.id}
          transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`}
          className={cx("gp-map__car", c.focused && "is-focused")}
          onClick={() => onFocus?.(c.id)}
        >
          <title>{c.entry.name}</title>
          <circle r={c.focused ? 6 : 4.5} style={{ fill: entryVar(c.entry) }} />
          {c.focused ? <circle r={8} className="ring" /> : null}
        </g>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ phone

/** The phone's header bar: back, track, the ghost line, and the clock. */
export function SessionBar({
  backHref,
  backLabel,
  track,
  sub,
  final = false,
  t,
}: {
  backHref?: string;
  backLabel?: string;
  track: string;
  /** "8 cars, each driving alone". */
  sub: string;
  /** Every car has finished or retired. */
  final?: boolean;
  t: number;
}) {
  return (
    <header className="gp-bar gp-panel gp-panel--solid">
      {backHref ? (
        <a
          href={backHref}
          className="gp-iconbtn gp-iconbtn--touch"
          aria-label={`Back to ${backLabel ?? "the race list"}`}
        >
          <Icon name="back" size={20} />
        </a>
      ) : null}
      <div className="gp-bar__track">
        <span className="gp-session__name">{track}</span>
        <span className="gp-session__sub">{sub}</span>
      </div>
      {final ? <span className="gp-c gp-bar__lap">FINAL</span> : null}
      <span className="gp-session__clock gp-c gp-bar__clock">{formatClock(t)}</span>
    </header>
  );
}

/**
 * A bottom sheet. `top` is where its top edge sits (px from the top of the screen), so the scene above stays
 * visible; tapping the handle or the dimmed area above closes it.
 */
export function Sheet({
  top,
  label,
  dim = true,
  onClose,
  children,
}: {
  /** px, or any CSS length ("calc(100% - 430px)"). */
  top: number | string;
  label: string;
  dim?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {dim ? (
        <button
          type="button"
          className="gp-sheet__scrim"
          aria-label="Close"
          onClick={onClose}
          style={{ height: top }}
        />
      ) : null}
      <section className="gp-sheet gp-sheet--open" style={{ top }} aria-label={label}>
        <button
          type="button"
          className="gp-sheet__handle"
          aria-label={`Close ${label.toLowerCase()}`}
          onClick={onClose}
        >
          <span className="gp-sheet__grab" />
        </button>
        <div className="gp-sheet__body">{children}</div>
      </section>
    </>
  );
}
