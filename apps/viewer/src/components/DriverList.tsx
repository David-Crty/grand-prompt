import { Cost, EntryName, Popover, SourceLink } from "@bench/ui/react";
import type * as React from "react";
import { useMemo } from "react";
import prices from "../../../../prices.json";
import {
  type DriverEntry,
  type DriverResult,
  formatEffort,
  formatResult,
  raceTracks,
  standings,
} from "../lib/drivers.js";
import { eventEntries } from "../lib/entries.js";
import { buildCost, formatBuildTime, formatTokens, type Prices } from "../lib/results.js";
import { driverSourceUrl } from "../lib/route.js";

const PRICES = prices as Prices;

/** A driver's place in each race, one mark per circuit in the columns' order; each names its circuit. */
function Results({
  results,
  tracks,
}: {
  results: DriverResult[];
  tracks: { track: string; trackName: string }[];
}) {
  return (
    <span className="dl-results">
      {tracks.map((t) => {
        const r = results.find((x) => x.track === t.track);
        const text = r ? formatResult(r) : "–";
        const cls = !r
          ? undefined
          : r.lapTime == null
            ? "rl-dnf"
            : r.position === 1
              ? "is-fastest"
              : undefined;
        return (
          <span key={t.track} className="dl-result">
            <Popover label={`${t.trackName}: ${text}`} trigger={<span className={cls}>{text}</span>} hover>
              {t.trackName}
            </Popover>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Every model that built a driver for one event: how it was built, where it finished on each circuit and its
 * points, in standings order. `picker` chooses the event.
 */
export function DriverList({ drivers, picker }: { drivers: DriverEntry[]; picker?: React.ReactNode }) {
  const entries = useMemo(() => eventEntries(drivers), [drivers]);
  const tracks = useMemo(() => raceTracks(drivers), [drivers]);
  const rows = useMemo(() => standings(drivers), [drivers]);
  return (
    <>
      <div className="home-head">
        <h1>Drivers</h1>
        <div className="home-tools">{picker}</div>
      </div>
      {drivers.length === 0 ? (
        <p className="home-note">
          No races under results/ yet. Run <code>pnpm bench race …</code> to make some.
        </p>
      ) : (
        <>
          <p className="home-note">
            Each model wrote one driving program in its own coding CLI. Points: 10-8-6-5-4-3-2-1 in every
            race, for a valid lap.
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
                  <th>Results</th>
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
                        <span className="dl-result">{d.place}</span>
                      </td>
                      <td>
                        <span className="dl-driver">
                          <EntryName entry={entries.get(d.id)!} meta />
                          <SourceLink
                            href={driverSourceUrl(d.event, d.id)}
                            file="driver.js"
                            label={`${d.name}'s driver program on GitHub`}
                          />
                        </span>
                      </td>
                      <td>{formatEffort(d.effort)}</td>
                      <td className="n">{formatBuildTime(u?.wallTimeS ?? null)}</td>
                      <td className="n">{tokens != null ? formatTokens(tokens) : "–"}</td>
                      <td className="n">
                        <Cost cost={buildCost(d.id, u ?? undefined, PRICES)} />
                      </td>
                      <td className="n">{u?.practiceRuns != null ? `${u.practiceRuns} runs` : "–"}</td>
                      <td>
                        <Results results={d.results} tracks={tracks} />
                      </td>
                      <td className="n">
                        <span className="dl-result">{d.points}</span>
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
