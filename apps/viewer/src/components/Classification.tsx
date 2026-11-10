import { formatLapTime } from "@bench/ui";
import { ClassificationTable, type ClassRow, IconButton, ResultList } from "@bench/ui/react";
import { useMemo } from "react";
import prices from "../../../../prices.json";
import type { ViewerModel } from "../lib/model.js";
import {
  classificationRows,
  type EventResults,
  formatBuildTime,
  formatTokens,
  type Prices,
} from "../lib/results.js";

const PRICES = prices as Prices;

export function useClassification(model: ViewerModel, results: EventResults | null) {
  return useMemo(() => {
    const rows = classificationRows(model.replay.classification, model.incidents, results, PRICES);
    const view: ClassRow[] = rows.flatMap((r) => {
      const entry = model.entries.get(r.id);
      if (!entry) return [];
      const b = r.build;
      return [
        {
          ...r,
          entry,
          build: b
            ? {
                cost: b.cost,
                tokens: formatTokens(b.tokensIn + b.tokensOut),
                buildTime: formatBuildTime(b.wallTimeS),
              }
            : null,
        },
      ];
    });
    const limit = results?.rows.find((r) => r.manifest?.settings?.timeLimitMin)?.manifest?.settings
      ?.timeLimitMin;
    const notes = ["Purple: the fastest lap and the fastest time in each sector. Off-track deletes the lap."];
    if (rows.some((r) => r.build?.cost?.estimated))
      notes.push(
        "≈ est.: estimated from tokens × list price (prices.json, not cache-adjusted, so an upper bound).",
      );
    if (rows.some((r) => r.build && !r.build.cost)) notes.push("Cost –: no price is known for that model.");
    if (rows.some((r) => r.build))
      notes.push(`Build = wall time of the agentic build${limit ? `, ${limit} min limit` : ""}.`);
    return {
      rows: view,
      full: rows.some((r) => r.build),
      sectors: model.replay.track.sectors.length + 1,
      foot: notes.join(" "),
    };
  }, [model, results]);
}

export function Classification({
  model,
  results,
  layout = "card",
  onClose,
}: {
  model: ViewerModel;
  results: EventResults | null;
  layout?: "card" | "sheet";
  onClose: () => void;
}) {
  const c = useClassification(model, results);
  const event = results?.event.name ?? null;
  const sub = [model.replay.track.name, event].filter(Boolean).join(" · ");
  const pole = c.rows[0];
  if (layout === "sheet")
    return (
      <div className="result-sheet">
        <div className="result-sheet__head">
          <h2 className="gp-x">Result</h2>
        </div>
        <ResultList rows={c.rows} showBuild={c.full} />
        <p className="gp-table__foot">{c.foot}</p>
      </div>
    );
  return (
    <div className="overlay">
      <button type="button" className="backdrop" onClick={onClose} aria-label="Close" />
      <section className="gp-panel gp-panel--solid classif" aria-label="Final classification">
        <div className="classif__head">
          <h2 className="gp-x">Final classification</h2>
          <span className="gp-faint classif__sub">{sub}</span>
          <span className="gp-flex" />
          <IconButton icon="cross" label="Close (C)" onClick={onClose} />
        </div>
        <div className="classif__body">
          <ClassificationTable rows={c.rows} columns={c.full ? "full" : "lap"} sectors={c.sectors} />
          <p className="gp-table__foot">{c.foot}</p>
          {pole?.lapTime != null ? (
            <span className="sr-only">
              {pole.entry.name} on pole in {formatLapTime(pole.lapTime)}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
