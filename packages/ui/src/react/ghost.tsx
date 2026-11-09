import type { Entry } from "../entries.js";
import { EntryChip, entryStyle } from "./primitives.js";

/**
 * One label for a pack of overlapping ghost cars, in running order; cars at the same place are joined by "=" and
 * marked "same line". The followed car keeps its own label.
 */
export function PackLabel({
  title,
  groups,
  layout = "list",
}: {
  title: string;
  /** In running order; a group of two or more is an identical position. */
  groups: Entry[][];
  /** `row`: one line of chips (phone). */
  layout?: "list" | "row";
}) {
  const count = groups.reduce((n, g) => n + g.length, 0);
  const chips = (g: Entry[]) =>
    g.map((e, k) => (
      <span key={e.id} className="gp-pack__item">
        {k > 0 ? <span className="gp-pack__eq">=</span> : null}
        <EntryChip entry={e} />
      </span>
    ));
  if (layout === "row")
    return (
      <div className="gp-pack gp-pack--row">
        <span className="gp-label gp-pack__count">{count}</span>
        {groups.map((g) => (
          <span key={g[0]!.id} className="gp-pack__row">
            {chips(g)}
          </span>
        ))}
      </div>
    );
  return (
    <div className="gp-pack">
      <div className="gp-pack__head">
        <span className="gp-label">{title}</span>
        <span className="gp-label gp-pack__count">{count}</span>
      </div>
      {groups.map((g) => (
        <div key={g[0]!.id} className="gp-pack__row">
          {chips(g)}
          {g.length > 1 ? <span className="gp-pack__same">same line</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Distance of each car from the line during a ghost start, with identical launches called out. */
export function StartBoard({
  t,
  rows,
  scale,
  same,
  title = "Launch · distance from the line",
}: {
  t: number;
  rows: { entry: Entry; distance: number }[];
  scale: number;
  same: Entry[][];
  title?: string;
}) {
  const pct = (d: number) => `${Math.min(100, (d / scale) * 100).toFixed(1)}%`;
  return (
    <section className="gp-launch gp-panel" aria-label="Start board">
      <div className="gp-launch__head">
        <span className="gp-label gp-launch__title">{title}</span>
        <span className="gp-label">{t.toFixed(1)} s</span>
      </div>
      {rows.map((r) => (
        <div key={r.entry.id} className="gp-launch__row" style={entryStyle(r.entry)}>
          <EntryChip entry={r.entry} />
          <div className="gp-launch__lane">
            <i className="gp-launch__run" style={{ width: pct(r.distance) }} />
            <i className="gp-launch__car" style={{ left: pct(r.distance) }} />
          </div>
          <span className="gp-launch__m">{r.distance.toFixed(1)} m</span>
        </div>
      ))}
      <div className="gp-launch__scale">
        <span>0</span>
        <span>{scale / 2} m</span>
        <span>{scale} m</span>
      </div>
      {same.map((g) => (
        <div key={g[0]!.id} className="gp-launch__same">
          {g.map((e) => e.code).join(" = ")}: identical launch so far
        </div>
      ))}
    </section>
  );
}
