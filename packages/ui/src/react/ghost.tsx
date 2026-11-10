import type { Entry } from "../entries.js";
import { EntryChip } from "./primitives.js";

/**
 * One label for a pack of overlapping ghost cars: one row in running order, cars at the same place joined by
 * "=", and "+N" for the cars past the ones listed. The followed car keeps its own label.
 */
export function PackLabel({
  groups,
  hidden = 0,
}: {
  /** In running order; a group of two or more is an identical position. */
  groups: Entry[][];
  /** Cars in the pack but not listed. */
  hidden?: number;
}) {
  return (
    <div className="gp-pack">
      <span className="gp-label">Pack</span>
      {groups.map((g) => (
        <span key={g[0]!.id} className="gp-pack__group">
          {g.map((e, k) => (
            <span key={e.id} className="gp-pack__item">
              {k > 0 ? <span className="gp-pack__eq">=</span> : null}
              <EntryChip entry={e} />
            </span>
          ))}
        </span>
      ))}
      {hidden > 0 ? <span className="gp-pack__more">+{hidden}</span> : null}
    </div>
  );
}
