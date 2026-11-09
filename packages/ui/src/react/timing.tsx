import type * as React from "react";
import type { Entry } from "../entries.js";
import { type GapMode, gapLabel, statusCell, type TimingRow, towerFinal } from "../timing.js";
import {
  Chequer,
  EntryChip,
  entryStyle,
  PositionBox,
  SegmentedControl,
  StatusBadge,
  Wordmark,
} from "./primitives.js";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function GapText({
  row,
  mode = "gap",
  compact = false,
}: {
  row: TimingRow;
  mode?: GapMode;
  compact?: boolean;
}) {
  const g = gapLabel(row, mode, compact);
  return <span className={cx("gp-gap", g.kind !== "gap" && `gp-gap--${g.kind}`)}>{g.text}</span>;
}

function StatusCell({ row }: { row: TimingRow }) {
  const c = statusCell(row);
  if (c.kind === "fin") return <Chequer />;
  if (c.kind === "dnf") return <StatusBadge kind="dnf">DNF</StatusBadge>;
  if (c.kind === "del") return <StatusBadge kind="warn">DEL</StatusBadge>;
  if (c.kind === "time") return <StatusBadge kind="warn">TIME</StatusBadge>;
  return null;
}

export function TowerRow({
  row,
  entry,
  focused = false,
  fastest = false,
  justOut = false,
  mode = "gap",
  onFocus,
}: {
  row: TimingRow;
  entry: Entry;
  focused?: boolean;
  fastest?: boolean;
  /** Retired within the last few seconds: tinted red. */
  justOut?: boolean;
  mode?: GapMode;
  onFocus?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={cx("gp-trow", focused && "is-focused", row.out && "is-out", justOut && "is-just-out")}
      style={entryStyle(entry)}
      aria-label={`P${row.position} ${entry.name}`}
      aria-pressed={focused}
      title={entry.name}
      onClick={() => onFocus?.(row.id)}
    >
      <PositionBox position={row.position} leader={row.position === 1} out={row.out} />
      <EntryChip entry={entry} />
      <span className="gp-trow__name">{entry.name}</span>
      {fastest ? <span className="gp-trow__fl" role="img" aria-label="Fastest lap" /> : <span />}
      <span className="gp-trow__gap">
        <GapText row={row} mode={mode} />
      </span>
      <span className="gp-trow__lap">
        <StatusCell row={row} />
      </span>
    </button>
  );
}

export function TimingTower({
  rows,
  entries,
  focusId,
  fastestId,
  mode,
  justOut,
  onFocus,
  onMode,
  layout = "panel",
  children,
}: {
  rows: TimingRow[];
  entries: Map<string, Entry>;
  focusId: string | null;
  fastestId: string | null;
  mode: GapMode;
  justOut?: Set<string>;
  onFocus: (id: string) => void;
  onMode: (m: GapMode) => void;
  /** `sheet`: the phone's full tower, without the panel chrome and header. */
  layout?: "panel" | "sheet";
  /** Below the footer: the minimap on desktop. */
  children?: React.ReactNode;
}) {
  const final = towerFinal(rows);
  const dense = layout === "panel" && rows.length > 10;
  const seg = (
    <SegmentedControl<GapMode>
      label="Gap or interval"
      size={layout === "sheet" ? "touch" : "m"}
      value={mode}
      onChange={onMode}
      options={[
        { value: "gap", label: "Gap", title: "Gap to P1 (G)" },
        { value: "interval", label: "Interval", title: "Gap to the car ahead (G)" },
      ]}
    />
  );
  return (
    <section
      className={cx(
        "gp-tower",
        layout === "panel" && "gp-panel",
        dense && "gp-tower--dense",
        layout === "sheet" && "gp-tower--phone",
      )}
      aria-label="Timing tower"
    >
      {layout === "panel" ? (
        <div className="gp-tower__head">
          <Wordmark size="s" />
          <span className="gp-tower__lap gp-c">{final ? "FINAL" : "FLYING LAP"}</span>
        </div>
      ) : null}
      <div className="gp-tower__rows">
        {rows.map((r) => {
          const e = entries.get(r.id);
          return e ? (
            <TowerRow
              key={r.id}
              row={r}
              entry={e}
              focused={r.id === focusId}
              fastest={r.id === fastestId}
              justOut={justOut?.has(r.id) ?? false}
              mode={mode}
              onFocus={onFocus}
            />
          ) : null;
        })}
      </div>
      {layout === "panel" ? (
        <div className="gp-tower__foot">
          <span className="gp-label">{mode === "interval" ? "Interval" : "Gap to P1"}</span>
          {seg}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The phone's collapsed tower: the top `top` cars, a separator and the followed car if it is further back, and
 * how many are hidden. Tapping it opens the full tower.
 */
export function TowerStrip({
  rows,
  entries,
  focusId,
  top = 3,
  onExpand,
}: {
  rows: TimingRow[];
  entries: Map<string, Entry>;
  focusId: string | null;
  top?: number;
  onExpand: () => void;
}) {
  const head = rows.slice(0, top);
  const focus = rows.find((r) => r.id === focusId);
  const extra = focus && !head.includes(focus) ? focus : null;
  const hidden = rows.length - head.length - (extra ? 1 : 0);
  const line = (r: TimingRow) => {
    const e = entries.get(r.id);
    if (!e) return null;
    return (
      <span key={r.id} className={cx("gp-strip__row", r.id === focusId && "is-focused")}>
        <PositionBox position={r.position} leader={r.position === 1} out={r.out} />
        <EntryChip entry={e} out={r.out} />
        <GapText row={r} compact />
      </span>
    );
  };
  return (
    <button
      type="button"
      className="gp-strip gp-panel gp-panel--solid"
      aria-label="Timing tower"
      onClick={onExpand}
    >
      {head.map(line)}
      {extra ? (
        <>
          <span className="gp-strip__sep" />
          {line(extra)}
        </>
      ) : null}
      {hidden > 0 ? <span className="gp-strip__more">+{hidden} more</span> : null}
    </button>
  );
}
