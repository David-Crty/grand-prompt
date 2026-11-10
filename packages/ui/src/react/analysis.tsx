import type * as React from "react";
import { type Entry, entryVar } from "../entries.js";
import { cx, EntryChip } from "./primitives.js";

const MINUS = "−";
const signed = (v: number, d = 2) => `${v < 0 ? MINUS : "+"}${Math.abs(v).toFixed(d)}`;

/** A timed lap to pick in the analysis: the chip, then a native select of the entries. */
export function EntrySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Entry;
  options: { entry: Entry; text: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="gp-pick">
      <EntryChip entry={value} />
      <select aria-label={label} value={value.id} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.entry.id} value={o.entry.id}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface CornerRow {
  n: number;
  /** Time lost (positive) or gained against the reference over the corner's stretch. */
  dt: number;
  /** |dt| as a share of the largest in the table, for the bar. */
  share: number;
  apexKmh: number;
  /** Apex speed minus the reference's, km/h. */
  apexDiff: number;
  /** Where and how hard the car brakes against the reference. */
  braking: string;
}

/**
 * The pair corner by corner, grouped by sector: time against the reference (a bar either side of zero), apex
 * speed and braking. A row zooms the charts into its corner; the selected row again goes back to the whole lap.
 */
export function CornerTable({
  sectors,
  reference,
  gap,
  top,
  selected,
  onSelect,
}: {
  sectors: { sector: number; dt: number; rows: CornerRow[] }[];
  reference: Entry;
  gap: number;
  top: { car: number; ref: number };
  /** Selected corner number. */
  selected: number | null;
  onSelect: (n: number | null) => void;
}) {
  const tone = (v: number) => (v >= 0 ? "is-behind" : "is-ahead");
  return (
    <table className="gp-ctable">
      <thead>
        <tr>
          <th>Turn</th>
          <th>Time to {reference.code}</th>
          <th className="n">Apex km/h</th>
          <th>Braking vs {reference.code}</th>
        </tr>
      </thead>
      <tbody>
        {sectors.map((g) => (
          <CornerSector key={g.sector} g={g} tone={tone} selected={selected} onSelect={onSelect} />
        ))}
        <tr className="gp-ctable__total">
          <td>Lap</td>
          <td>
            <span className="gp-dbar gp-dbar--none" />
            <span className={cx("gp-ctable__dt", tone(gap))}>{signed(gap, 3)}</span>
          </td>
          <td className="n gp-faint" colSpan={2}>
            top speed {Math.round(top.car)} vs {Math.round(top.ref)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function CornerSector({
  g,
  tone,
  selected,
  onSelect,
}: {
  g: { sector: number; dt: number; rows: CornerRow[] };
  tone: (v: number) => string;
  selected: number | null;
  onSelect: (n: number | null) => void;
}) {
  return (
    <>
      <tr className="gp-ctable__sector">
        <td colSpan={4}>
          Sector {g.sector + 1}
          <span className={tone(g.dt)}>{signed(g.dt)}</span>
        </td>
      </tr>
      {g.rows.map((r) => (
        <tr key={r.n} className={cx("gp-ctable__row", selected === r.n && "is-selected")}>
          <td>
            <button
              type="button"
              className="gp-ctable__turn"
              aria-pressed={selected === r.n}
              aria-label={`Turn ${r.n}: zoom in`}
              onClick={() => onSelect(selected === r.n ? null : r.n)}
            >
              T{r.n}
            </button>
          </td>
          <td>
            <span className="gp-dbar">
              <i
                className={r.dt >= 0 ? "is-loss" : "is-gain"}
                style={{ width: `${(r.share * 50).toFixed(1)}%` }}
              />
            </span>
            <span className={cx("gp-ctable__dt", tone(r.dt))}>{signed(r.dt)}</span>
          </td>
          <td className="n">
            {Math.round(r.apexKmh)}
            <small className={r.apexDiff < 0 ? "is-behind" : r.apexDiff > 0 ? "is-ahead" : "gp-faint"}>
              {r.apexDiff === 0 ? "±0" : `${r.apexDiff > 0 ? "+" : MINUS}${Math.abs(r.apexDiff)}`}
            </small>
          </td>
          <td className="gp-ctable__brake">{r.braking}</td>
        </tr>
      ))}
    </>
  );
}

export interface FieldRow {
  entry: Entry;
  /** Per corner: time lost to the fastest car through it, 0 for the fastest. */
  loss: number[];
  /** Per corner: tint strength in percent (see lossTint). */
  tint: number[];
  /** The lap time for pole, the gap for the others. */
  lap: string;
}

/**
 * Every timed lap through every corner, against the fastest car through each: purple is the fastest, the orange
 * deepens with the time lost. A car's chip analyses that car; a cell also zooms into that corner.
 */
export function FieldGrid({
  rows,
  corners,
  carId,
  refId,
  selected,
  onCar,
  onCell,
}: {
  rows: FieldRow[];
  /** Corner number and sector index per column. */
  corners: { n: number; sector: number }[];
  carId: string;
  refId: string;
  selected: number | null;
  onCar: (id: string) => void;
  onCell: (id: string, n: number) => void;
}) {
  const spans: { sector: number; n: number }[] = [];
  for (const c of corners) {
    const last = spans[spans.length - 1];
    if (last && last.sector === c.sector) last.n++;
    else spans.push({ sector: c.sector, n: 1 });
  }
  return (
    <table className="gp-fgrid">
      <thead>
        <tr>
          <th />
          {spans.map((s) => (
            <th key={s.sector} colSpan={s.n} className="gp-fgrid__sector">
              Sector {s.sector + 1}
            </th>
          ))}
          <th />
        </tr>
        <tr>
          <th />
          {corners.map((c) => (
            <th key={c.n} className={cx(selected === c.n && "is-selected")}>
              T{c.n}
            </th>
          ))}
          <th className="n">Lap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.entry.id} className={cx(r.entry.id === carId && "is-car")}>
            <td className="gp-fgrid__car">
              <button
                type="button"
                className="gp-fgrid__pick"
                aria-pressed={r.entry.id === carId}
                title={`Analyse ${r.entry.name}`}
                onClick={() => onCar(r.entry.id)}
              >
                <EntryChip entry={r.entry} />
              </button>
              {r.entry.id === refId ? <span className="gp-fgrid__ref">ref</span> : null}
            </td>
            {corners.map((c, k) => {
              const loss = r.loss[k]!;
              const best = loss <= 1e-9;
              return (
                <td key={c.n} className={cx(selected === c.n && "is-selected")}>
                  <button
                    type="button"
                    className={cx("gp-fgrid__cell", best && "is-best", r.tint[k]! > 45 && "is-deep")}
                    style={best ? undefined : ({ "--loss": `${r.tint[k]}%` } as React.CSSProperties)}
                    title={
                      best
                        ? `${r.entry.name}: fastest through T${c.n}`
                        : `${r.entry.name}: ${loss.toFixed(2)} s slower than the fastest through T${c.n}`
                    }
                    onClick={() => onCell(r.entry.id, c.n)}
                  >
                    {best ? "best" : `+${loss.toFixed(2)}`}
                  </button>
                </td>
              );
            })}
            <td className="n gp-fgrid__lap">{r.lap}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The circuit in stretches, one per corner, each drawn in the colour of the fastest car through it. */
export function CornerMap({
  width,
  height,
  stretches,
  labels,
  start,
  selected,
}: {
  width: number;
  height: number;
  stretches: { n: number; d: string; entry: Entry }[];
  labels: { n: number; x: number; y: number }[];
  start: [number, number, number, number];
  selected: number | null;
}) {
  const sel = stretches.find((s) => s.n === selected);
  return (
    <svg
      className="gp-map gp-cmap"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Track map coloured by the fastest car through each corner"
    >
      {stretches.map((s) => (
        <path key={`e${s.n}`} className="edge" d={s.d} strokeWidth={10} />
      ))}
      {stretches.map((s) => (
        <path
          key={s.n}
          className="gp-cmap__stretch"
          d={s.d}
          strokeWidth={6}
          style={{ stroke: entryVar(s.entry) }}
        />
      ))}
      {sel ? (
        <>
          <path className="gp-cmap__halo" d={sel.d} strokeWidth={12} />
          <path
            className="gp-cmap__stretch"
            d={sel.d}
            strokeWidth={6}
            style={{ stroke: entryVar(sel.entry) }}
          />
        </>
      ) : null}
      <line className="start" x1={start[0]} y1={start[1]} x2={start[2]} y2={start[3]} />
      {labels.map((l) => (
        <text
          key={l.n}
          className={cx("gp-cmap__label", l.n === selected && "is-selected")}
          x={l.x}
          y={l.y + 3}
        >
          T{l.n}
        </text>
      ))}
    </svg>
  );
}

/** How many corners each car is fastest through, most first. */
export function CornerOwners({ owners }: { owners: { entry: Entry; count: number }[] }) {
  return (
    <div className="gp-owners">
      {owners.map((o) => (
        <span key={o.entry.id}>
          <EntryChip entry={o.entry} /> {o.count} corner{o.count > 1 ? "s" : ""}
        </span>
      ))}
    </div>
  );
}
