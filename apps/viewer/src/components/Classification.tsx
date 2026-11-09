import { formatLapTime } from "@bench/ui";
import {
  Button,
  CaveatBanner,
  ClassificationTable,
  type ClassRow,
  IconButton,
  ResultList,
  StatusBadge,
  Wordmark,
} from "@bench/ui/react";
import { useMemo, useState } from "react";
import prices from "../../../../prices.json";
import type { ViewerModel } from "../lib/model.js";
import {
  caveat,
  classificationRows,
  type EventResults,
  fastestLap,
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
                practice: b.practiceRuns != null ? `${b.practiceRuns}/${b.practiceLimit}` : "–",
              }
            : null,
        },
      ];
    });
    const limit = results?.rows.find((r) => r.manifest?.settings?.timeLimitMin)?.manifest?.settings
      ?.timeLimitMin;
    const notes = ["Purple: fastest lap of the race."];
    if (rows.some((r) => r.build?.cost?.estimated))
      notes.push(
        "≈ est.: estimated from tokens × list price (prices.json, not cache-adjusted, so an upper bound).",
      );
    if (rows.some((r) => r.build && !r.build.cost))
      notes.push(
        "Cost –: the CLI reports tokens but not cost, and prices.json has no list price for the model yet.",
      );
    if (rows.some((r) => r.build))
      notes.push(
        `Build = wall time of the agentic build${limit ? `, ${limit} min limit` : ""}. Points 10-8-6-5-4-3-2-1.`,
      );
    return {
      rows: view,
      fastest: fastestLap(rows),
      caveat: caveat(results),
      full: rows.some((r) => r.build),
      foot: notes.join(" "),
    };
  }, [model, results]);
}

/** A link to this replay at the finish, for sharing the result. */
function resultLink(duration: number): string {
  const u = new URL(window.location.href);
  u.searchParams.set("t", String(Math.ceil(duration)));
  u.searchParams.set("cam", "tv");
  u.searchParams.delete("car");
  return u.toString();
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
  const [copied, setCopied] = useState(false);
  const share = () => {
    const url = resultLink(model.duration);
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (layout === "sheet" && navigator.share) navigator.share({ url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(done, () => {});
  };
  const event = results?.event.name ?? null;
  const sub = [model.replay.track.name, event, `${model.totalLaps} laps`, model.ghost ? "ghost race" : ""]
    .filter(Boolean)
    .join(" · ");
  const winner = c.rows[0];
  if (layout === "sheet")
    return (
      <div className="result-sheet">
        <div className="result-sheet__head">
          <h2 className="gp-x">Result</h2>
          {c.caveat ? <StatusBadge kind="trial">Trial</StatusBadge> : null}
          <IconButton icon="share" label="Share result" size="touch" iconSize={20} onClick={share} />
        </div>
        {c.caveat ? <CaveatBanner title="Trial.">{c.caveat}</CaveatBanner> : null}
        <ResultList rows={c.rows} fastestLap={c.fastest} showBuild={c.full} />
        <p className="gp-table__foot">{c.foot}</p>
      </div>
    );
  return (
    <div className="overlay">
      <button type="button" className="backdrop" onClick={onClose} aria-label="Close" />
      <section className="gp-panel gp-panel--solid classif" aria-label="Final classification">
        <div className="classif__head">
          <Wordmark size="s" />
          <span className="gp-vrule" />
          <h2 className="gp-x">Final classification</h2>
          <span className="gp-faint classif__sub">{sub}</span>
          <span className="gp-flex" />
          {c.caveat ? <StatusBadge kind="trial">Trial</StatusBadge> : null}
          <Button icon="share" onClick={share} title="Copy a link to this result">
            {copied ? "Link copied" : "Share result"}
          </Button>
          <IconButton icon="cross" label="Close (C)" onClick={onClose} />
        </div>
        <div className="classif__body">
          {c.caveat ? <CaveatBanner title="Trial result.">{c.caveat}</CaveatBanner> : null}
          <ClassificationTable rows={c.rows} fastestLap={c.fastest} columns={c.full ? "full" : "race"} />
          <p className="gp-table__foot">{c.foot}</p>
          {winner && !winner.out && winner.totalTime != null ? (
            <span className="sr-only">
              {winner.entry.name} wins in {formatLapTime(winner.totalTime)}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
