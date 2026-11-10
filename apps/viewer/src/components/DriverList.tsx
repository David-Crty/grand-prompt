import { Cost, EntryName } from "@bench/ui/react";
import type * as React from "react";
import { useMemo } from "react";
import prices from "../../../../prices.json";
import { type DriverEntry, formatEffort, formatResult, raceTracks, standings } from "../lib/drivers.js";
import { eventEntries } from "../lib/entries.js";
import { buildCost, formatBuildTime, formatTokens, type Prices } from "../lib/results.js";

const PRICES = prices as Prices;

/** A result, or while results are hidden the same blurred mark in every cell, so not even its width tells. */
function Hidden({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  return shown ? (
    <span className="dl-result">{children}</span>
  ) : (
    <span className="dl-result is-concealed" aria-hidden="true">
      P0
    </span>
  );
}

/**
 * Every model that built a driver: how it was built, where it finished on each circuit and its points, the
 * standings order, when results are shown.
 */
export function DriverList({ drivers, shown }: { drivers: DriverEntry[]; shown: boolean }) {
  const entries = useMemo(() => eventEntries(drivers), [drivers]);
  const tracks = useMemo(() => raceTracks(drivers), [drivers]);
  const rows = useMemo(() => standings(drivers, shown), [drivers, shown]);
  return (
    <>
      <div className="home-head">
        <h1>Drivers</h1>
      </div>
      {drivers.length === 0 ? (
        <p className="home-note">
          No races under results/ yet. Run <code>pnpm bench race …</code> to make some.
        </p>
      ) : (
        <>
          <p className="home-note">
            Each model wrote one driving program in its own coding CLI. Reasoning effort was not fixed between
            builds. Points: 10-8-6-5-4-3-2-1 in every race, for a valid lap.
          </p>
          <div className="dl-scroll">
            <table className="gp-table dl-table">
              <thead>
                <tr>
                  <th className="n">Pos</th>
                  <th>Driver</th>
                  <th>Effort</th>
                  <th className="n">Build time</th>
                  <th className="n">Tokens</th>
                  <th className="n">Cost</th>
                  <th className="n">Practice</th>
                  {tracks.map((t) => (
                    <th key={t.track} className="n">
                      {t.trackName}
                    </th>
                  ))}
                  <th className="n">Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const u = d.usage;
                  const tokens = u ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) : null;
                  return (
                    <tr key={d.id}>
                      <td className="n">
                        <Hidden shown={shown}>{d.place}</Hidden>
                      </td>
                      <td>
                        <EntryName entry={entries.get(d.id)!} meta />
                      </td>
                      <td>{formatEffort(d.effort)}</td>
                      <td className="n">{formatBuildTime(u?.wallTimeS ?? null)}</td>
                      <td className="n">{tokens != null ? formatTokens(tokens) : "–"}</td>
                      <td className="n">
                        <Cost cost={buildCost(d.id, u ?? undefined, PRICES)} />
                      </td>
                      <td className="n">{u?.practiceRuns != null ? `${u.practiceRuns} runs` : "–"}</td>
                      {tracks.map((t) => {
                        const r = d.results.find((x) => x.track === t.track);
                        const cls = !r
                          ? ""
                          : r.lapTime == null
                            ? "rl-dnf"
                            : r.position === 1
                              ? "is-fastest"
                              : "";
                        return (
                          <td key={t.track} className="n">
                            <Hidden shown={shown}>
                              <span className={cls}>{r ? formatResult(r) : "–"}</span>
                            </Hidden>
                          </td>
                        );
                      })}
                      <td className="n">
                        <Hidden shown={shown}>{d.points}</Hidden>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
