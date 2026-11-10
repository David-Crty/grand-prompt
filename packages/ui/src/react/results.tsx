import { CircleDollarSign, Cpu, Hourglass } from "lucide-react";
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
  /** The cells of the table's `extras` columns, in their order. */
  extra?: React.ReactNode[];
}

/** A column after the sectors; a `result` one is concealed with the others. */
export interface ExtraColumn {
  label: string;
  result?: boolean;
}

/** In place of a result while results are hidden: the same blurred mark in every cell, so no width tells. */
function Concealed({ mark = "0:00.000" }: { mark?: string }) {
  return (
    <span className="gp-concealed" aria-hidden="true">
      {mark}
    </span>
  );
}

const dash = "–";
const money = (v: number) => `$${v.toFixed(2)}`;

export function Cost({ cost }: { cost: { usd: number; estimated: boolean } | null }) {
  if (!cost) return dash;
  return cost.estimated ? (
    <span className="gp-est" title="Estimated from tokens × list price">
      {money(cost.usd)}
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
  { key: "buildTime", label: "Build time", Icon: Hourglass },
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
 * The final classification: the driver program and, with `full`, what it took to build, then the lap, its
 * sectors and any `extras`. A car without a time shows why in place of its lap time. `concealed` hides every
 * result (place, lap, gap, sectors, result extras) and leaves the rows in the order given.
 */
export function ClassificationTable({
  rows,
  columns,
  sectors = 3,
  buildHelp,
  extras = [],
  concealed = false,
}: {
  rows: ClassRow[];
  columns: "lap" | "full";
  sectors?: number;
  /** The driver build column's "?" popover. */
  buildHelp?: React.ReactNode;
  extras?: ExtraColumn[];
  concealed?: boolean;
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
            {extras.map((x) => (
              <th key={x.label} className="n">
                {x.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.id} className={r.lapTime == null && !concealed ? "is-out" : undefined}>
              <td>
                {concealed ? (
                  <Concealed mark="00" />
                ) : r.position == null ? (
                  <StatusBadge kind="outline">{r.out ? "DNF" : "–"}</StatusBadge>
                ) : (
                  <PositionBox position={r.position} />
                )}
              </td>
              <td>
                <EntryName entry={r.entry} />
              </td>
              {full ? <td>{r.build ? <BuildFacts build={r.build} /> : null}</td> : null}
              {concealed ? (
                <>
                  <td className="n">
                    <Concealed />
                  </td>
                  <td className="n">
                    <Concealed mark="+0.000" />
                  </td>
                  {names.map((n) => (
                    <td key={n} className="n">
                      <Concealed mark="00.000" />
                    </td>
                  ))}
                </>
              ) : r.lapTime != null ? (
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
              {extras.map((x, k) => (
                <td key={x.label} className="n">
                  {concealed && x.result ? <Concealed mark="000" /> : r.extra?.[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The phone's classification: one block per car, the time on the right, build facts underneath. `concealed`
 * hides the place and the times and leaves the rows in the order given.
 */
export function ResultList({
  rows,
  showBuild,
  concealed = false,
}: {
  rows: ClassRow[];
  showBuild: boolean;
  concealed?: boolean;
}) {
  return (
    <div className="gp-rlist">
      {rows.map((r) =>
        concealed ? (
          <div key={r.entry.id} className="gp-ritem">
            <Concealed mark="00" />
            <div className="gp-ritem__main">
              <EntryChip entry={r.entry} />
              <span className="gp-entry__name gp-trunc">{r.entry.name}</span>
            </div>
            <div className="gp-ritem__time">
              <Concealed mark="+0.000" />
            </div>
            <div className="gp-ritem__sub">
              <Concealed />
              {showBuild && r.build ? <BuildFacts build={r.build} /> : null}
            </div>
          </div>
        ) : (
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
        ),
      )}
    </div>
  );
}
