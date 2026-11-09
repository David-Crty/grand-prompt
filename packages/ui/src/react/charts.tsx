import { linear, niceTop, pathOf, spreadLabels } from "../charts.js";
import { type Entry, entryVar } from "../entries.js";

export interface ChartTrack {
  length: number;
  /** Sector boundaries (m). */
  sectors: number[];
  corners: { n: number; sApex: number }[];
}

const PAD = { l: 36, r: 40, t: 10, b: 22 };

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

/** Best-lap speed against distance; the followed car drawn last and thicker, each line labelled at its end. */
export function SpeedTrace({
  series,
  focusId,
  track,
  cursor = null,
  zoom,
  width,
  height,
}: {
  series: { entry: Entry; s: number[]; v: number[] }[];
  focusId: string;
  track: ChartTrack;
  cursor?: number | null;
  zoom?: [number, number];
  width: number;
  height: number;
}) {
  const [a0, a1] = zoom ?? [0, track.length];
  const top = niceTop(Math.max(100, ...series.flatMap((s) => s.v)), 50);
  const sx = linear(a0, a1, PAD.l, width - PAD.r);
  const sy = linear(0, top, height - PAD.b, PAD.t);
  const ordered = [...series].sort(
    (p, q) => (p.entry.id === focusId ? 1 : 0) - (q.entry.id === focusId ? 1 : 0),
  );
  const ends = series.map((s) => {
    let k = s.s.length - 1;
    while (k > 0 && s.s[k]! > a1) k--;
    return sy(s.v[k] ?? 0);
  });
  const labels = spreadLabels(ends, 14);
  const grid = [];
  for (let v = 0; v <= top; v += 100) grid.push(v);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Best-lap speed against distance">
      {grid.map((v) => (
        <g key={v}>
          <line className="grid" x1={PAD.l} x2={width - PAD.r} y1={sy(v)} y2={sy(v)} />
          <text className="axis" x={PAD.l - 6} y={sy(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {track.sectors.map((x, k) =>
        x > a0 && x < a1 ? (
          <g key={x}>
            <line className="sector" x1={sx(x)} x2={sx(x)} y1={PAD.t} y2={height - PAD.b} />
            <text className="axis" x={sx(x) + 4} y={PAD.t + 10}>
              S{k + 2}
            </text>
          </g>
        ) : null,
      )}
      {track.corners.map((c) =>
        c.sApex > a0 && c.sApex < a1 ? (
          <text key={c.n} className="axis" x={sx(c.sApex)} y={height - 6} textAnchor="middle">
            T{c.n}
          </text>
        ) : null,
      )}
      {ordered.map((s) => (
        <path
          key={s.entry.id}
          d={pathOf(s.s, s.v, sx, sy, a0, a1)}
          className={`gp-chart__line${s.entry.id === focusId ? " is-focus" : ""}`}
          style={{ stroke: entryVar(s.entry) }}
        />
      ))}
      {series.map((s, k) => (
        <EndLabel key={s.entry.id} x={width - PAD.r + 4} y={labels[k]!} entry={s.entry} />
      ))}
      {cursor != null && cursor > a0 && cursor < a1 ? (
        <line className="cursor" x1={sx(cursor)} x2={sx(cursor)} y1={PAD.t} y2={height - PAD.b} />
      ) : null}
      <text className="axis" x={PAD.l} y={PAD.t - 2}>
        km/h
      </text>
    </svg>
  );
}

/** Time to the reference at the same distance: below the line is slower; each line ends at the lap-time gap. */
export function DeltaChart({
  series,
  reference,
  track,
  width,
  height,
}: {
  series: { entry: Entry; s: number[]; dt: number[] }[];
  reference: Entry;
  track: ChartTrack;
  width: number;
  height: number;
}) {
  const mx = Math.max(1, Math.ceil(Math.max(...series.flatMap((s) => s.dt.map(Math.abs)), 0)));
  const sx = linear(0, track.length, PAD.l, width - PAD.r);
  const b = 16;
  const sy = linear(-mx, mx, PAD.t, height - b);
  const mid = sy(0);
  const ends = spreadLabels(
    series.map((s) => sy(s.dt[s.dt.length - 1] ?? 0) - 4),
    12,
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Time to ${reference.name} at the same distance`}
    >
      <rect
        x={PAD.l}
        y={PAD.t}
        width={width - PAD.l - PAD.r}
        height={mid - PAD.t}
        className="gp-chart__ahead"
      />
      <rect
        x={PAD.l}
        y={mid}
        width={width - PAD.l - PAD.r}
        height={height - b - mid}
        className="gp-chart__behind"
      />
      <line className="zero" x1={PAD.l} x2={width - PAD.r} y1={mid} y2={mid} />
      <text className="axis" x={PAD.l - 6} y={sy(-mx) + 3} textAnchor="end">
        −{mx}s
      </text>
      <text className="axis" x={PAD.l - 6} y={sy(mx) + 3} textAnchor="end">
        +{mx}s
      </text>
      <text className="axis gp-chart__ahead-label" x={PAD.l + 6} y={PAD.t + 11}>
        FASTER THAN {reference.code}
      </text>
      <text className="axis" x={PAD.l + 6} y={height - b - 4}>
        SLOWER
      </text>
      {track.sectors.map((x) => (
        <line key={x} className="sector" x1={sx(x)} x2={sx(x)} y1={PAD.t} y2={height - b} />
      ))}
      {series.map((s, k) => {
        const last = s.dt[s.dt.length - 1] ?? 0;
        return (
          <g key={s.entry.id}>
            <path
              d={pathOf(s.s, s.dt, sx, sy)}
              className="gp-chart__line"
              style={{ stroke: entryVar(s.entry) }}
            />
            <text
              x={width - PAD.r}
              y={ends[k]}
              textAnchor="end"
              className="axis gp-chart__end"
              style={{ fill: entryVar(s.entry) }}
            >
              {last >= 0 ? "+" : "−"}
              {Math.abs(last).toFixed(2)}s {s.entry.code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Throttle and brake lanes for one car, the reference dashed on top. */
export function InputLanes({
  trace,
  reference,
  track,
  width,
  height,
}: {
  trace: { s: number[]; throttle: number[]; brake: number[] };
  reference?: { s: number[]; throttle: number[]; brake: number[] } | null;
  track: ChartTrack;
  width: number;
  height: number;
}) {
  const sx = linear(0, track.length, PAD.l, width - PAD.r);
  const lh = (height - 8 - 12) / 2;
  const lanes = [
    { k: "THR", key: "throttle" as const, cls: "thr" },
    { k: "BRK", key: "brake" as const, cls: "brk" },
  ];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Throttle and brake against distance">
      {lanes.map((lane, n) => {
        const y0 = 4 + n * (lh + 12);
        const sy = linear(0, 1, y0 + lh, y0);
        const area = `${pathOf(trace.s, trace[lane.key], sx, sy)} L${sx(trace.s.at(-1) ?? 0).toFixed(1)} ${(y0 + lh).toFixed(1)} L${sx(trace.s[0] ?? 0).toFixed(1)} ${(y0 + lh).toFixed(1)} Z`;
        return (
          <g key={lane.k}>
            <rect x={PAD.l} y={y0} width={width - PAD.l - PAD.r} height={lh} className="gp-chart__lane" />
            <text className="axis" x={PAD.l - 6} y={y0 + lh / 2 + 3} textAnchor="end">
              {lane.k}
            </text>
            {trace.s.length ? <path d={area} className={`gp-chart__fill ${lane.cls}`} /> : null}
            {reference ? (
              <path d={pathOf(reference.s, reference[lane.key], sx, sy)} className="gp-chart__ref" />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
