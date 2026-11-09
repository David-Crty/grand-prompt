import type * as React from "react";
import type { Entry } from "../entries.js";
import { formatGap, formatLapTime } from "../format.js";
import { Icon } from "./icons.js";
import { EntryChip, EntryName, PositionBox, StatusBadge } from "./primitives.js";

export interface ClassRow {
  entry: Entry;
  position: number | null;
  out: boolean;
  totalTime: number | null;
  gap: number | null;
  bestLap: number | null;
  bestLapNumber: number | null;
  penalties: number;
  /** "Crashed · L1 · T2". */
  outText: string | null;
  build: {
    cost: { usd: number; estimated: boolean } | null;
    tokens: string;
    buildTime: string;
    practice: string;
  } | null;
  points: number;
}

const dash = "–";
const money = (v: number) => `$${v.toFixed(2)}`;

export function Cost({ cost }: { cost: { usd: number; estimated: boolean } | null }) {
  if (!cost) return <>{dash}</>;
  return cost.estimated ? (
    <span className="gp-est" title="Estimated from tokens × list price">
      {money(cost.usd)} <StatusBadge kind="est">est</StatusBadge>
    </span>
  ) : (
    <>{money(cost.usd)}</>
  );
}

export function CaveatBanner({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="gp-caveat" role="note">
      <Icon name="warn" />
      <span>
        <b>{title}</b> {children}
      </span>
    </div>
  );
}

/** The final classification; `full` adds what each driver program cost to build. */
export function ClassificationTable({
  rows,
  fastestLap,
  columns,
}: {
  rows: ClassRow[];
  fastestLap: number | null;
  columns: "race" | "full";
}) {
  return (
    <div className="gp-table__wrap">
      <table className="gp-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Driver program</th>
            <th className="n">Time</th>
            <th className="n">Gap</th>
            <th className="n">Best lap</th>
            <th className="n">Pen</th>
            <th>Status</th>
            {columns === "full" ? (
              <>
                <th className="n">Cost</th>
                <th className="n">Tokens</th>
                <th className="n">Build</th>
                <th className="n">Practice</th>
                <th className="n">Pts</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.id} className={r.out ? "is-out" : undefined}>
              <td>
                {r.out ? (
                  <StatusBadge kind="outline">DNF</StatusBadge>
                ) : (
                  <PositionBox position={r.position} leader={r.position === 1} />
                )}
              </td>
              <td>
                <EntryName entry={r.entry} meta />
              </td>
              <td className="n">{r.totalTime != null ? formatLapTime(r.totalTime) : dash}</td>
              <td className="n">{r.gap != null ? formatGap(r.gap) : r.out ? dash : ""}</td>
              <td className={`n${r.bestLap != null && r.bestLap === fastestLap ? " is-fastest" : ""}`}>
                {r.bestLap != null ? formatLapTime(r.bestLap) : dash}
                {r.bestLap != null && r.bestLapNumber != null ? (
                  <span className="gp-faint gp-lapno"> L{r.bestLapNumber}</span>
                ) : null}
              </td>
              <td className="n">{r.penalties > 0 ? `+${r.penalties}s` : dash}</td>
              <td>
                {r.out ? (
                  <>
                    <StatusBadge kind="dnf">DNF</StatusBadge>{" "}
                    <span className="gp-faint gp-outtext">{r.outText}</span>
                  </>
                ) : (
                  <span className="gp-faint">Finished</span>
                )}
              </td>
              {columns === "full" ? (
                <>
                  <td className="n">
                    <Cost cost={r.build?.cost ?? null} />
                  </td>
                  <td className="n">{r.build?.tokens ?? dash}</td>
                  <td className="n">{r.build?.buildTime ?? dash}</td>
                  <td className="n">{r.build?.practice ?? dash}</td>
                  <td className="n">{r.points}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The phone's classification: one block per car, the times on the right, build facts underneath. */
export function ResultList({
  rows,
  fastestLap,
  showBuild,
}: {
  rows: ClassRow[];
  fastestLap: number | null;
  showBuild: boolean;
}) {
  return (
    <div className="gp-rlist">
      {rows.map((r, k) => (
        <div key={r.entry.id} className={`gp-ritem${r.out ? " is-out" : ""}`}>
          <PositionBox position={r.position} leader={r.position === 1} out={r.out} />
          <div className="gp-ritem__main">
            <EntryChip entry={r.entry} />
            <span className="gp-entry__name gp-trunc">{r.entry.name}</span>
          </div>
          <div className="gp-ritem__time">
            {r.out ? (
              <StatusBadge kind="dnf">DNF</StatusBadge>
            ) : k === 0 || r.gap == null ? (
              formatLapTime(r.totalTime)
            ) : (
              formatGap(r.gap)
            )}
          </div>
          <div className="gp-ritem__sub">
            {r.out ? (
              <span>{r.outText}</span>
            ) : (
              <span>
                Best{" "}
                <b className={r.bestLap === fastestLap ? "gp-fastest" : undefined}>
                  {formatLapTime(r.bestLap)}
                </b>
              </span>
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
  sectors: { time: number; kind: "fastest" | "personal" | "slower" }[];
  time: number;
  ideal: number;
}

const KIND_TITLE = {
  fastest: "Fastest of anyone so far",
  personal: "Personal best",
  slower: "Slower than own best",
};

export function SectorTable({
  rows,
  lap,
  names = true,
}: {
  rows: SectorTableRow[];
  lap: number;
  names?: boolean;
}) {
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
            <th className="n">Ideal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.id}>
              <td>{names ? <EntryName entry={r.entry} /> : <EntryChip entry={r.entry} />}</td>
              {r.sectors.map((s, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a sector's place in the lap is its identity
                <td key={k} className="n">
                  <span className={`gp-sector gp-sector--${s.kind}`} title={KIND_TITLE[s.kind]}>
                    {formatLapTime(s.time)}
                  </span>
                </td>
              ))}
              <td className="n">{formatLapTime(r.time)}</td>
              <td className="n gp-muted">{formatLapTime(r.ideal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="gp-table__foot">
        <span className="gp-sector gp-sector--fastest gp-sector--key">S</span> fastest of anyone so far{" "}
        <span className="gp-sector gp-sector--personal gp-sector--key">S</span> personal best{" "}
        <span className="gp-sector gp-sector--slower gp-sector--key">S</span> slower than own best. Lap {lap}.
      </p>
    </>
  );
}
