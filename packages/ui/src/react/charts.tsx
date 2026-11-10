import * as React from "react";
import { fitRange, linear, niceStep, niceTop, pathOf, spreadLabels, ticksIn, valueAt } from "../charts.js";
import { type Entry, entryVar } from "../entries.js";
import { EntryChip } from "./primitives.js";

export interface ChartTrack {
  length: number;
  /** Sector boundaries (m). */
  sectors: number[];
  corners: { n: number; sStart: number; sEnd: number; sApex: number }[];
}

/** The stretch of lap a chart shows (m): the whole lap, or one corner when zoomed. */
export type ChartRange = [number, number];

const PAD = { l: 36, r: 44, t: 12, b: 20 };

function useClipId(): string {
  return `gpc${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

function wholeLap(track: ChartTrack, range: ChartRange): boolean {
  return range[0] <= 0 && range[1] >= track.length;
}

/** Corner bands, turn numbers and sector lines along the distance axis. */
function DistanceAxis({
  track,
  range,
  sx,
  top,
  bottom,
  labelY,
  sectorLabels = false,
}: {
  track: ChartTrack;
  range: ChartRange;
  sx: (s: number) => number;
  top: number;
  bottom: number;
  labelY: number | null;
  sectorLabels?: boolean;
}) {
  const [a0, a1] = range;
  return (
    <>
      {track.corners.map((c) =>
        c.sEnd > a0 && c.sStart < a1 ? (
          <g key={c.n}>
            <rect
              className="band"
              x={sx(Math.max(c.sStart, a0))}
              y={top}
              width={Math.max(0, sx(Math.min(c.sEnd, a1)) - sx(Math.max(c.sStart, a0)))}
              height={bottom - top}
            />
            {labelY != null && c.sApex > a0 && c.sApex < a1 ? (
              <text className="axis" x={sx(c.sApex)} y={labelY} textAnchor="middle">
                T{c.n}
              </text>
            ) : null}
          </g>
        ) : null,
      )}
      {track.sectors.map((x, k) =>
        x > a0 + 1 && x < a1 - 1 ? (
          <g key={x}>
            <line className="sector" x1={sx(x)} x2={sx(x)} y1={top} y2={bottom} />
            {sectorLabels ? (
              <text className="axis" x={sx(x) + 4} y={top + 10}>
                S{k + 2}
              </text>
            ) : null}
          </g>
        ) : null,
      )}
    </>
  );
}

function EndLabel({ x, y, entry }: { x: number; y: number; entry: Entry }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${(y - 7).toFixed(1)})`}>
      <rect width={30} height={14} rx={2} style={{ fill: entryVar(entry) }} />
      <text x={15} y={10.5} textAnchor="middle" className="gp-chart__code">
        {entry.code}
      </text>
    </g>
  );
}

export interface SpeedLine {
  entry: Entry;
  s: number[];
  v: number[];
}

/** Where a car brakes for the zoomed corner, and its apex speed. */
export interface SpeedMarks {
  brakeS: number | null;
  apexS: number;
  apexKmh: number;
}

/**
 * Speed against distance on the timed lap: the car solid, the reference dashed, each labelled at its end. Zoomed
 * on a corner, the scale fits the corner and both braking points and apex speeds are marked.
 */
export function SpeedTrace({
  car,
  reference,
  track,
  range = [0, track.length],
  marks = null,
  cursor = null,
  width,
  height,
}: {
  car: SpeedLine;
  reference: SpeedLine | null;
  track: ChartTrack;
  range?: ChartRange;
  marks?: { car: SpeedMarks; ref: SpeedMarks | null } | null;
  cursor?: number | null;
  width: number;
  height: number;
}) {
  const clip = useClipId();
  const [a0, a1] = range;
  const lines = reference ? [reference, car] : [car];
  const whole = wholeLap(track, range);
  let lo = 0;
  let hi = niceTop(Math.max(100, ...car.v, ...(reference?.v ?? [])), 50);
  let step = 100;
  if (!whole) {
    [lo, hi] = fitRange(
      lines.map((l) => l.s),
      lines.map((l) => l.v),
      a0,
      a1,
      20,
      10,
    );
    if (hi - lo > 160) [lo, hi] = [Math.floor(lo / 50) * 50, Math.ceil(hi / 50) * 50];
    lo = Math.max(0, lo);
    step = hi - lo > 160 ? 50 : 20;
  }
  const top = PAD.t;
  const bottom = height - PAD.b;
  const sx = linear(a0, a1, PAD.l, width - PAD.r);
  const sy = linear(lo, hi, bottom, top);
  const endOf = (l: SpeedLine) => sy(valueAt(l.s, l.v, a1));
  const ends = spreadLabels(lines.map(endOf), 16);
  const pointMarks = marks
    ? [
        { entry: car.entry, m: marks.car },
        ...(marks.ref && reference ? [{ entry: reference.entry, m: marks.ref }] : []),
      ]
    : [];
  const byApex = [...pointMarks].sort((p, q) => p.m.apexKmh - q.m.apexKmh);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Speed on the timed lap against distance">
      <defs>
        <clipPath id={clip}>
          <rect x={PAD.l} y={top - 3} width={width - PAD.l - PAD.r} height={bottom - top + 6} />
        </clipPath>
      </defs>
      {ticksIn(lo, hi, step).map((v) => (
        <g key={v}>
          <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={sy(v)} y2={sy(v)} />
          <text className="axis" x={PAD.l - 6} y={sy(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <DistanceAxis
        track={track}
        range={range}
        sx={sx}
        top={top}
        bottom={bottom}
        labelY={height - 6}
        sectorLabels
      />
      <g clipPath={`url(#${clip})`}>
        {reference ? (
          <path
            d={pathOf(reference.s, reference.v, sx, sy, a0 - 10, a1 + 10)}
            className="gp-chart__line is-ref"
            style={{ stroke: entryVar(reference.entry) }}
          />
        ) : null}
        <path
          d={pathOf(car.s, car.v, sx, sy, a0 - 10, a1 + 10)}
          className="gp-chart__line is-focus"
          style={{ stroke: entryVar(car.entry) }}
        />
      </g>
      {pointMarks.map(({ entry, m }) =>
        m.brakeS != null && m.brakeS >= a0 && m.brakeS <= a1 ? (
          <g key={`b-${entry.id}`} style={{ fill: entryVar(entry), stroke: entryVar(entry) }}>
            <line className="gp-chart__brake" x1={sx(m.brakeS)} x2={sx(m.brakeS)} y1={top} y2={bottom} />
            <path d={`M${(sx(m.brakeS) - 5).toFixed(1)} ${top - 9}h10l-5 7z`} stroke="none" />
          </g>
        ) : null,
      )}
      {byApex.map(({ entry, m }, j) => {
        const x = sx(m.apexS);
        const y = sy(m.apexKmh);
        return (
          <g key={`a-${entry.id}`} style={{ fill: entryVar(entry) }}>
            <circle cx={x} cy={y} r={3.5} />
            <text
              className="gp-chart__apex"
              x={x}
              y={j === 0 && byApex.length > 1 ? Math.min(bottom - 2, y + 15) : Math.max(top + 10, y - 8)}
              textAnchor="middle"
            >
              {Math.round(m.apexKmh)}
            </text>
          </g>
        );
      })}
      {lines.map((l, k) => (
        <EndLabel key={l.entry.id} x={width - PAD.r + 6} y={ends[k]!} entry={l.entry} />
      ))}
      {cursor != null && cursor > a0 && cursor < a1 ? (
        <line className="cursor" x1={sx(cursor)} x2={sx(cursor)} y1={top} y2={bottom} />
      ) : null}
    </svg>
  );
}

/**
 * Time of the car minus the reference's at the same distance: below the zero line the car is behind. Over the
 * whole lap the line ends at the lap-time gap; zoomed on a corner it starts from zero, so it ends at the time
 * lost or gained in that corner. The scale fits the pair.
 */
export function GapChart({
  series,
  reference,
  track,
  range = [0, track.length],
  cursor = null,
  width,
  height,
}: {
  series: { entry: Entry; s: number[]; dt: number[] };
  reference: Entry;
  track: ChartTrack;
  range?: ChartRange;
  cursor?: number | null;
  width: number;
  height: number;
}) {
  const clip = useClipId();
  const [a0, a1] = range;
  const base = wholeLap(track, range) ? 0 : valueAt(series.s, series.dt, a0);
  const xs = [a0];
  for (const s of series.s) if (s > a0 && s < a1) xs.push(s);
  xs.push(a1);
  const ys = xs.map((s) => valueAt(series.s, series.dt, s) - base);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const pad = Math.max(0.03, (hi - lo) * 0.12);
  const top = PAD.t;
  const bottom = height - PAD.b;
  const sx = linear(a0, a1, PAD.l, width - PAD.r);
  const sy = linear(lo - pad, hi + pad, top, bottom);
  const y0 = sy(0);
  const line = pathOf(xs, ys, sx, sy);
  const area = `${line} L${sx(a1).toFixed(1)} ${y0.toFixed(1)} L${sx(a0).toFixed(1)} ${y0.toFixed(1)} Z`;
  const step = niceStep(hi - lo + 2 * pad);
  const end = ys[ys.length - 1]!;
  const fmt = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(step < 0.1 ? 2 : 1)}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Time to ${reference.name} at the same distance`}
    >
      <defs>
        <clipPath id={`${clip}a`}>
          <rect x={PAD.l} y={top} width={width - PAD.l - PAD.r} height={Math.max(0, y0 - top)} />
        </clipPath>
        <clipPath id={`${clip}b`}>
          <rect x={PAD.l} y={y0} width={width - PAD.l - PAD.r} height={Math.max(0, bottom - y0)} />
        </clipPath>
      </defs>
      <DistanceAxis track={track} range={range} sx={sx} top={top} bottom={bottom} labelY={height - 6} />
      {ticksIn(lo - pad, hi + pad, step).map((v) =>
        v === 0 ? null : (
          <g key={v}>
            <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="axis" x={PAD.l - 6} y={sy(v) + 3} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ),
      )}
      <text className="axis" x={PAD.l - 6} y={y0 + 3} textAnchor="end">
        0
      </text>
      <path d={area} className="gp-chart__ahead" clipPath={`url(#${clip}a)`} />
      <path d={area} className="gp-chart__behind" clipPath={`url(#${clip}b)`} />
      <line className="zero" x1={PAD.l} x2={width - PAD.r} y1={y0} y2={y0} />
      <path d={line} className="gp-chart__line is-focus" style={{ stroke: entryVar(series.entry) }} />
      <text
        x={width - PAD.r + 6}
        y={Math.min(bottom, Math.max(top + 8, sy(end) + 4))}
        className={`axis gp-chart__end ${end >= 0 ? "is-behind" : "is-ahead"}`}
      >
        {end >= 0 ? "+" : "−"}
        {Math.abs(end).toFixed(2)}s
      </text>
      {cursor != null && cursor > a0 && cursor < a1 ? (
        <line className="cursor" x1={sx(cursor)} x2={sx(cursor)} y1={top} y2={bottom} />
      ) : null}
    </svg>
  );
}

/** Throttle and brake lanes for one car, the reference dashed on top; zoomed, the peak brake of each. */
export function InputLanes({
  trace,
  reference,
  track,
  range = [0, track.length],
  peaks = null,
  width,
  height,
}: {
  trace: { s: number[]; throttle: number[]; brake: number[] };
  reference?: { s: number[]; throttle: number[]; brake: number[] } | null;
  track: ChartTrack;
  range?: ChartRange;
  /** Peak brake input (0 to 1) of the car and the reference, with their entries. */
  peaks?: { car: { entry: Entry; v: number }; ref: { entry: Entry; v: number } | null } | null;
  width: number;
  height: number;
}) {
  const clip = useClipId();
  const [a0, a1] = range;
  const sx = linear(a0, a1, PAD.l, width - PAD.r);
  const lh = (height - 8 - 12) / 2;
  const lanes = [
    { k: "THR", key: "throttle" as const, cls: "thr" },
    { k: "BRK", key: "brake" as const, cls: "brk" },
  ];
  const inside = trace.s.filter((s) => s >= a0 - 10 && s <= a1 + 10);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Throttle and brake against distance">
      <defs>
        <clipPath id={clip}>
          <rect x={PAD.l} y={0} width={width - PAD.l - PAD.r} height={height} />
        </clipPath>
      </defs>
      {lanes.map((lane, n) => {
        const y0 = 4 + n * (lh + 12);
        const sy = linear(0, 1, y0 + lh, y0);
        const first = inside[0] ?? a0;
        const last = inside[inside.length - 1] ?? a1;
        const area = `${pathOf(trace.s, trace[lane.key], sx, sy, a0 - 10, a1 + 10)} L${sx(last).toFixed(1)} ${(y0 + lh).toFixed(1)} L${sx(first).toFixed(1)} ${(y0 + lh).toFixed(1)} Z`;
        return (
          <g key={lane.k}>
            <rect x={PAD.l} y={y0} width={width - PAD.l - PAD.r} height={lh} className="gp-chart__lane" />
            <text className="axis" x={PAD.l - 6} y={y0 + lh / 2 + 3} textAnchor="end">
              {lane.k}
            </text>
            <g clipPath={`url(#${clip})`}>
              {inside.length ? <path d={area} className={`gp-chart__fill ${lane.cls}`} /> : null}
              {reference ? (
                <path
                  d={pathOf(reference.s, reference[lane.key], sx, sy, a0 - 10, a1 + 10)}
                  className="gp-chart__ref"
                />
              ) : null}
            </g>
            {lane.key === "brake" && peaks ? (
              <text className="axis gp-chart__peak" x={width - PAD.r + 6} y={y0 + 9}>
                <tspan x={width - PAD.r + 6}>peak</tspan>
                <tspan x={width - PAD.r + 6} dy={11} style={{ fill: entryVar(peaks.car.entry) }}>
                  {pct(peaks.car.v)}
                </tspan>
                {peaks.ref ? (
                  <tspan x={width - PAD.r + 6} dy={11} style={{ fill: entryVar(peaks.ref.entry) }}>
                    {pct(peaks.ref.v)}
                  </tspan>
                ) : null}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** How a legend item is drawn: as the line, area or marker it stands for in the chart. */
export type LegendMark =
  | "line"
  | "dash"
  | "pedals"
  | "ref-dash"
  | "behind"
  | "ahead"
  | "brake-point"
  | "apex";

function LegendSwatch({ mark, entry }: { mark: LegendMark; entry?: Entry }) {
  const stroke = entry ? entryVar(entry) : undefined;
  return (
    <svg className="gp-legend__swatch" viewBox="0 0 18 10" width={18} height={10} aria-hidden>
      {mark === "line" ? <line x1={1} x2={17} y1={5} y2={5} strokeWidth={2.4} style={{ stroke }} /> : null}
      {mark === "dash" ? (
        <line x1={1} x2={17} y1={5} y2={5} strokeWidth={1.6} strokeDasharray="4 2" style={{ stroke }} />
      ) : null}
      {mark === "ref-dash" ? <line className="gp-legend__ref" x1={1} x2={17} y1={5} y2={5} /> : null}
      {mark === "pedals" ? (
        <>
          <rect className="gp-legend__thr" x={1} y={1} width={8} height={8} rx={1} />
          <rect className="gp-legend__brk" x={9} y={1} width={8} height={8} rx={1} />
        </>
      ) : null}
      {mark === "behind" || mark === "ahead" ? (
        <rect className={`gp-legend__${mark}`} x={4} y={1} width={10} height={8} rx={1} />
      ) : null}
      {mark === "brake-point" ? <path className="gp-legend__mark" d="M4 1h10l-5 8z" /> : null}
      {mark === "apex" ? <circle className="gp-legend__mark" cx={9} cy={5} r={3.5} /> : null}
    </svg>
  );
}

/** A chart's title and its key: each item drawn as it appears in the chart, with the car's chip or a word. */
export function ChartLegend({
  title,
  items,
}: {
  title: string;
  items: { key: string; mark: LegendMark; entry?: Entry; label?: string }[];
}) {
  return (
    <div className="gp-legend">
      <span className="gp-label">{title}</span>
      {items.map((it) => (
        <span key={it.key} className="gp-legend__item">
          <LegendSwatch mark={it.mark} entry={it.entry} />
          {it.entry ? <EntryChip entry={it.entry} /> : null}
          {it.label ? <span>{it.label}</span> : null}
        </span>
      ))}
    </div>
  );
}
