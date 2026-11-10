import { CircleDollarSign, Cpu, Timer } from "lucide-react";
import type * as React from "react";
import type { Entry } from "../entries.js";
import { formatGap, formatLapTime } from "../format.js";
import { EntryChip, EntryName, Popover, PositionBox, StatusBadge } from "./primitives.js";

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

const FACTS = [
  { key: "cost", label: "Cost", Icon: CircleDollarSign },
  { key: "tokens", label: "Tokens", Icon: Cpu },
  { key: "buildTime", label: "Build time", Icon: Timer },
] as const;

/**
 * What a driver program cost to build, one icon per value: cost, tokens, build time. Each value keeps its slot
 * when it is missing, so the values line up from row to row.
 */
export function BuildFacts({ build }: { build: NonNullable<ClassRow["build"]> }) {
  return (
    <span className="gp-facts">
      {FACTS.map(({ key, label, Icon: I }) => {
        const v = key === "cost" ? build.cost ? <Cost cost={build.cost} /> : null : build[key];
        return (
          <span key={key} className={`gp-fact gp-fact--${key}`} title={label}>
            {v != null ? (
              <>
                <I size={14} aria-hidden className="gp-fact__icon" />
                <span className="gp-visually-hidden">{label}: </span>
                {v}
              </>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** What the driver build column holds, for its "?" popover: one line per value, with its icon. */
export function BuildFactsHelp({
  cost,
  tokens,
  buildTime,
}: {
  cost: string;
  tokens: string;
  buildTime: string;
}) {
  const text = { cost, tokens, buildTime };
  return (
    <>
      <p>What it took the model to write this driver program, in one agentic session in a sandbox.</p>
      <ul className="gp-factshelp">
        {FACTS.map(({ key, label, Icon: I }) => (
          <li key={key}>
            <I size={14} aria-hidden className="gp-fact__icon" />
            <span>
              <b>{label}</b> {text[key]}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The final classification: the driver program and, with `full`, what it took to build, then the lap and its
 * sectors. A car without a time shows why in place of its lap time.
 */
export function ClassificationTable({
  rows,
  columns,
  sectors = 3,
  buildHelp,
}: {
  rows: ClassRow[];
  columns: "lap" | "full";
  sectors?: number;
  /** The driver build column's "?" popover. */
  buildHelp?: React.ReactNode;
}) {
  const full = columns === "full";
  const names = Array.from({ length: sectors }, (_, k) => `S${k + 1}`);
  return (
    <div className="gp-table__wrap">
      <table className="gp-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Driver program</th>
            {full ? (
              <th>
                <span className="gp-th-help">
                  Driver build
                  {buildHelp ? <Popover label="What the driver build is">{buildHelp}</Popover> : null}
                </span>
              </th>
            ) : null}
            <th className="n">Lap time</th>
            <th className="n">Gap</th>
            {names.map((n) => (
              <th key={n} className="n">
                {n}
              </th>
            ))}
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
                <EntryName entry={r.entry} />
              </td>
              {full ? <td>{r.build ? <BuildFacts build={r.build} /> : null}</td> : null}
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
            {showBuild && r.build ? <BuildFacts build={r.build} /> : null}
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
