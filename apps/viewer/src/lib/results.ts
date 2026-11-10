/**
 * The final classification with what each driver program cost to build, from the event's results and build
 * manifests when they sit next to the replay (`/results/<event>/event-results.json`). Without them the table
 * keeps the lap columns only.
 */
import type { ClassifiedResult } from "@bench/sim";
import type { Incident } from "./incidents.js";

/** The parts of `event-results.json` the viewer reads. */
export interface EventResults {
  event: { id: string; name: string };
  rows: {
    slug: string;
    manifest?: {
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        costUsd?: number;
        wallTimeS?: number;
      };
      settings?: { timeLimitMin?: number };
    } | null;
  }[];
}

/** List prices per million tokens, from the committed `prices.json`; dated, because they change. */
export interface Prices {
  models: Record<string, { inputPerM: number; outputPerM: number; date?: string; source?: string }>;
}

export interface Cost {
  usd: number;
  /** True when computed from tokens and list prices rather than reported by the CLI. */
  estimated: boolean;
}

export interface BuildFacts {
  tokensIn: number;
  tokensOut: number;
  cost: Cost | null;
  wallTimeS: number | null;
}

/** Cost as the CLI reported it, or tokens × list price, marked as an estimate (not cache-adjusted: an upper bound). */
export function buildCost(
  id: string,
  usage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined,
  prices: Prices,
): Cost | null {
  if (!usage) return null;
  if (usage.costUsd != null) return { usd: usage.costUsd, estimated: false };
  const p = prices.models[id];
  if (!p || usage.inputTokens == null || usage.outputTokens == null) return null;
  return {
    usd: (usage.inputTokens / 1e6) * p.inputPerM + (usage.outputTokens / 1e6) * p.outputPerM,
    estimated: true,
  };
}

export function buildFacts(id: string, results: EventResults | null, prices: Prices): BuildFacts | null {
  const m = results?.rows.find((r) => r.slug === id)?.manifest;
  if (!m?.usage) return null;
  const u = m.usage;
  return {
    tokensIn: u.inputTokens ?? 0,
    tokensOut: u.outputTokens ?? 0,
    cost: buildCost(id, u, prices),
    wallTimeS: u.wallTimeS ?? null,
  };
}

export interface ResultRow {
  id: string;
  /** Null for a car without a time. */
  position: number | null;
  status: string;
  out: boolean;
  /** Finished on a deleted lap. */
  deleted: boolean;
  lapTime: number | null;
  gap: number | null;
  /** "Crashed · T2", "Lap deleted", "Time up" for a car without a time. */
  outText: string | null;
  /** The timed lap's sectors; `fastest` marks the quickest anyone set in that sector. */
  sectors: { time: number; fastest: boolean }[] | null;
  build: BuildFacts | null;
}

function outWords(status: string, inc: Incident | undefined): string {
  const what = status.startsWith("DNF: CRASHED")
    ? "Crashed"
    : status.startsWith("DNF: ECU")
      ? "Driver failed"
      : status.startsWith("DNF: STALLED")
        ? "Stalled"
        : status === "TIME UP"
          ? "Time up"
          : status === "FINISHED"
            ? "Lap deleted: track limits"
            : status.replace(/^DNF:\s*/, "");
  if (!inc) return what;
  return [what, inc.corner !== null ? `T${inc.corner}` : ""].filter(Boolean).join(" · ");
}

export function classificationRows(
  classification: ClassifiedResult[],
  incidents: Incident[],
  results: EventResults | null,
  prices: Prices,
): ResultRow[] {
  const timedSectors = (r: ClassifiedResult) => (r.lapTime != null && r.lap ? r.lap.sectors : null);
  const best: number[] = [];
  for (const r of classification)
    timedSectors(r)?.forEach((t, k) => {
      if (best[k] === undefined || t < best[k]!) best[k] = t;
    });
  return classification.map((r) => {
    const timed = r.lapTime != null;
    const position = timed ? r.position : null;
    return {
      id: r.id,
      position,
      status: r.status,
      out: r.status.startsWith("DNF"),
      deleted: r.status === "FINISHED" && !timed,
      lapTime: r.lapTime,
      gap: timed && r.position !== 1 ? r.gap : null,
      outText: timed
        ? null
        : outWords(
            r.status,
            incidents.find((i) => i.carId === r.id),
          ),
      sectors: timedSectors(r)?.map((t, k) => ({ time: t, fastest: t === best[k] })) ?? null,
      build: buildFacts(r.id, results, prices),
    };
  });
}

/** "2.17M", "649k". */
export function formatTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`;
}

/** Build wall time: 882 s is "14m42". */
export function formatBuildTime(s: number | null): string {
  if (s == null) return "–";
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, "0")}`;
}
