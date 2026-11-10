import type { Entry } from "../entries.js";
import { formatGap, formatLapTime } from "../format.js";
import { EntryChip, EntryName, PositionBox, StatusBadge } from "./primitives.js";

export interface ClassRow {
  entry: Entry;
  /** Null for a car without a time. */
  position: number | null;
  out: boolean;
  /** Finished on a deleted lap. */
  deleted: boolean;
  lapTime: number | null;
  gap: number | null;
  /** "Crashed · T2", "Lap deleted", "Time up". */
  outText: string | null;
  /** The timed lap's sectors; `fastest` is the quickest anyone set in that sector. */
  sectors: { time: number; fastest: boolean }[] | null;
  build: {
    cost: { usd: number; estimated: boolean } | null;
    tokens: string;
    buildTime: string;
  } | null;
}

const dash = "–";
const money = (v: number) => `$${v.toFixed(2)}`;

export function Cost({ cost }: { cost: { usd: number; estimated: boolean } | null }) {
  if (!cost) return dash;
  return cost.estimated ? (
    <span className="gp-est" title="Estimated from tokens × list price">
      {money(cost.usd)} <StatusBadge kind="est">est</StatusBadge>
    </span>
  ) : (
    money(cost.usd)
  );
}

function NoTime({ row }: { row: ClassRow }) {
  return row.out ? (
    <StatusBadge kind="dnf">DNF</StatusBadge>
  ) : (
    <StatusBadge kind="warn">{row.deleted ? "DEL" : "TIME"}</StatusBadge>
  );
}

/**
 * The final classification: the lap and its sectors on track, then, with `full`, what each driver program cost to
 * build. A car without a time shows why in place of its lap time.
 */
export function ClassificationTable({
  rows,
  columns,
  sectors = 3,
}: {
  rows: ClassRow[];
  columns: "lap" | "full";
  sectors?: number;
}) {
  const full = columns === "full";
  const names = Array.from({ length: sectors }, (_, k) => `S${k + 1}`);
  return (
    <div className="gp-table__wrap">
      <table className="gp-table">
        <thead>
          {full ? (
            <tr className="gp-table__groups">
              <th colSpan={2} />
              <th colSpan={2 + sectors}>On track</th>
              <th colSpan={3} className="gp-table__group">
                The build
              </th>
            </tr>
          ) : null}
          <tr>
            <th>Pos</th>
            <th>Driver program</th>
            <th className="n">Lap time</th>
            <th className="n">Gap</th>
            {names.map((n) => (
              <th key={n} className="n">
                {n}
              </th>
            ))}
            {full ? (
              <>
                <th className="n gp-table__group">Cost</th>
                <th className="n">Tokens</th>
                <th className="n">Build</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.id} className={r.lapTime == null ? "is-out" : undefined}>
              <td>
                {r.position == null ? (
                  <StatusBadge kind="outline">{r.out ? "DNF" : "–"}</StatusBadge>
                ) : (
                  <PositionBox position={r.position} />
                )}
              </td>
              <td>
                <EntryName entry={r.entry} meta />
              </td>
              {r.lapTime != null ? (
                <>
                  <td className={`n${r.position === 1 ? " is-fastest" : ""}`}>{formatLapTime(r.lapTime)}</td>
                  <td className="n">{r.gap != null ? formatGap(r.gap) : ""}</td>
                  {names.map((n, k) => {
                    const s = r.sectors?.[k];
                    return (
                      <td key={n} className={`n${s?.fastest ? " is-fastest" : ""}`}>
                        {s ? formatLapTime(s.time) : dash}
                      </td>
                    );
                  })}
                </>
              ) : (
                <td colSpan={2 + sectors} className="gp-table__why">
                  <NoTime row={r} /> <span className="gp-faint gp-outtext">{r.outText}</span>
                </td>
              )}
              {full ? (
                <>
                  <td className="n gp-table__group">
                    <Cost cost={r.build?.cost ?? null} />
                  </td>
                  <td className="n">{r.build?.tokens ?? dash}</td>
                  <td className="n">{r.build?.buildTime ?? dash}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The phone's classification: one block per car, the time on the right, build facts underneath. */
export function ResultList({ rows, showBuild }: { rows: ClassRow[]; showBuild: boolean }) {
  return (
    <div className="gp-rlist">
      {rows.map((r) => (
        <div key={r.entry.id} className={`gp-ritem${r.lapTime == null ? " is-out" : ""}`}>
          <PositionBox position={r.position} out={r.lapTime == null} />
          <div className="gp-ritem__main">
            <EntryChip entry={r.entry} />
            <span className="gp-entry__name gp-trunc">{r.entry.name}</span>
          </div>
          <div className="gp-ritem__time">
            {r.lapTime == null ? (
              <NoTime row={r} />
            ) : r.position === 1 || r.gap == null ? (
              <b className="gp-fastest">{formatLapTime(r.lapTime)}</b>
            ) : (
              formatGap(r.gap)
            )}
          </div>
          <div className="gp-ritem__sub">
            {r.lapTime == null ? (
              <span>{r.outText}</span>
            ) : (
              <span>{r.position === 1 ? "Pole" : formatLapTime(r.lapTime)}</span>
            )}
            {showBuild && r.build ? (
              <>
                <span>
                  <Cost cost={r.build.cost} />
                </span>
                <span>{r.build.tokens} tok</span>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface SectorTableRow {
  entry: Entry;
  sectors: { time: number; kind: "fastest" | "slower" }[];
  time: number;
}

const KIND_TITLE = {
  fastest: "Fastest of anyone",
  slower: "Slower than the fastest",
};

export function SectorTable({ rows }: { rows: SectorTableRow[] }) {
  const n = Math.max(0, ...rows.map((r) => r.sectors.length));
  return (
    <>
      <table className="gp-table gp-table--dense">
        <thead>
          <tr>
            <th>Entry</th>
            {Array.from({ length: n }, (_, k) => `S${k + 1}`).map((name) => (
              <th key={name} className="n">
                {name}
              </th>
            ))}
            <th className="n">Lap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.id}>
              <td>
                <EntryChip entry={r.entry} />
              </td>
              {r.sectors.map((s, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a sector's place in the lap is its identity
                <td key={k} className="n">
                  <span className={`gp-sector gp-sector--${s.kind}`} title={KIND_TITLE[s.kind]}>
                    {formatLapTime(s.time)}
                  </span>
                </td>
              ))}
              <td className="n">{formatLapTime(r.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="gp-table__foot">
        <span className="gp-sector gp-sector--fastest gp-sector--key">S</span> fastest of anyone{" "}
        <span className="gp-sector gp-sector--slower gp-sector--key">S</span> slower.
      </p>
    </>
  );
}
