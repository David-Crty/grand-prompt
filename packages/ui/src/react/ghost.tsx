import type { Entry } from "../entries.js";
import { EntryChip } from "./primitives.js";

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
