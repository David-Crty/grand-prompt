import type { Entry } from "../entries.js";
import { EntryChip } from "./primitives.js";

/** One label for a pack of overlapping ghost cars: one row of chips, then "+N" for the cars not listed. */
export function PackLabel({ entries, hidden = 0 }: { entries: Entry[]; hidden?: number }) {
  return (
    <div className="gp-pack">
      <span className="gp-label">Pack</span>
      {entries.map((e) => (
        <EntryChip key={e.id} entry={e} />
      ))}
      {hidden > 0 ? <span className="gp-pack__more">+{hidden}</span> : null}
    </div>
  );
}
