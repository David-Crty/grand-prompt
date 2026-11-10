import { formatLapTime } from "@bench/ui";
import {
  BuildFactsHelp,
  Button,
  ClassificationTable,
  type ClassRow,
  Icon,
  IconButton,
  ResultList,
} from "@bench/ui/react";
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
import { StarNote } from "./StarNote.js";

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
    const help = {
      cost: "as the model's CLI reported it, or estimated from its tokens at the provider's list prices, cache reads and writes at their own rates (marked ≈). Blank when no price is known for the model.",
      tokens: "input and output tokens the model used.",
      buildTime: `wall time of the session${limit ? `, out of a ${limit} min limit` : ""}.`,
    };
    const lap = "Purple: the fastest lap and the fastest time in each sector. Off-track deletes the lap.";
    const full = rows.some((r) => r.build);
    return {
      rows: view,
      full,
      sectors: model.replay.track.sectors.length + 1,
      help,
      foot: lap,
      phoneFoot: full
        ? `${lap} Cost: ${help.cost} Tokens: ${help.tokens} Build time: ${help.buildTime}`
        : lap,
    };
  }, [model, results]);
}

function Actions({
  onRestart,
  onAnalysis,
  backHref,
  touch = false,
}: {
  onRestart?: () => void;
  onAnalysis?: () => void;
  backHref?: string;
  touch?: boolean;
}) {
  if (!onRestart && !onAnalysis && !backHref) return null;
  return (
    <div className={touch ? "classif__actions classif__actions--touch" : "classif__actions"}>
      {backHref ? (
        <a href={backHref} className={`gp-btn gp-btn--secondary${touch ? " gp-btn--touch" : ""}`}>
          <Icon name="back" />
          All races
        </a>
      ) : null}
      {onAnalysis ? (
        <Button size={touch ? "touch" : "m"} icon="chart" onClick={onAnalysis}>
          Analysis
        </Button>
      ) : null}
      {onRestart ? (
        <Button variant="primary" size={touch ? "touch" : "m"} icon="restart" onClick={onRestart}>
          Restart
        </Button>
      ) : null}
    </div>
  );
}

export function Classification({
  model,
  results,
  layout = "card",
  onClose,
  onRestart,
  onAnalysis,
  backHref,
}: {
  model: ViewerModel;
  results: EventResults | null;
  layout?: "card" | "sheet";
  onClose: () => void;
  /** Play the race again from the start; no button without it. */
  onRestart?: () => void;
  /** Open the lap analysis in place of the classification; no button without it. */
  onAnalysis?: () => void;
  backHref?: string;
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
        <p className="gp-table__foot">{c.phoneFoot}</p>
        <Actions onRestart={onRestart} onAnalysis={onAnalysis} backHref={backHref} touch />
        <StarNote ask="Enjoyed the race?" />
      </div>
    );
  return (
    <div className="overlay overlay--clear">
      <button type="button" className="backdrop" onClick={onClose} aria-label="Close" />
      <section className="gp-panel classif" aria-label="Final classification">
        <div className="classif__head">
          <h2 className="gp-x">Final classification</h2>
          <span className="gp-faint classif__sub">{sub}</span>
          <span className="gp-flex" />
          <IconButton icon="cross" label="Close (C)" onClick={onClose} />
        </div>
        <div className="classif__body">
          <ClassificationTable
            rows={c.rows}
            columns={c.full ? "full" : "lap"}
            sectors={c.sectors}
            buildHelp={<BuildFactsHelp {...c.help} />}
          />
          <p className="gp-table__foot">{c.foot}</p>
          <Actions onRestart={onRestart} onAnalysis={onAnalysis} backHref={backHref} />
          <StarNote ask="Enjoyed the race?" />
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
