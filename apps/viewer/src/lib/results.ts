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
        practiceRuns?: number;
      };
      settings?: { cli?: string; effort?: string; timeLimitMin?: number; practiceLimit?: number };
      provider?: string;
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
  practiceRuns: number | null;
  practiceLimit: number;
  effort: string | null;
  cli: string | null;
}

/** Shared practice runs per build (D21), unless a manifest says otherwise. */
export const PRACTICE_LIMIT = 10;

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
    practiceRuns: u.practiceRuns ?? null,
    practiceLimit: m.settings?.practiceLimit ?? PRACTICE_LIMIT,
    effort: m.settings?.effort ?? null,
    cli: m.settings?.cli ?? null,
  };
}

/** Points by position for a timed lap (display only; the design's proposal until season standings exist). */
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

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
  build: BuildFacts | null;
  points: number;
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
      build: buildFacts(r.id, results, prices),
      points: position !== null ? (POINTS[position - 1] ?? 0) : 0,
    };
  });
}

/**
 * What makes this result a trial rather than a ranking, from differences between the builds: reasoning effort,
 * time limit or practice budget not the same for every build, or a field from one provider only.
 */
export function caveat(results: EventResults | null): string | null {
  const ms = (results?.rows ?? []).flatMap((r) => (r.manifest ? [r.manifest] : []));
  if (ms.length < 2) return null;
  const notes: string[] = [];
  const efforts = new Set(ms.map((m) => m.settings?.effort ?? "unset"));
  if (efforts.size > 1) {
    const byCli = new Map<string, Set<string>>();
    for (const m of ms) {
      const cli = m.settings?.cli ?? "other";
      byCli.set(cli, (byCli.get(cli) ?? new Set()).add(m.settings?.effort ?? "unset"));
    }
    const parts = [...byCli].map(([cli, e]) => {
      const list = [...e].map((x) => (x === "cli-default" ? "the CLI default" : x));
      const name = cli.charAt(0).toUpperCase() + cli.slice(1);
      return `${name} builds ran at ${list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0]}`;
    });
    notes.push(`Reasoning effort was not fixed: ${parts.join(", ")}.`);
  }
  const limits = new Set(ms.map((m) => m.settings?.timeLimitMin ?? null));
  if (limits.size > 1) notes.push("Builds had different time limits.");
  const budgets = new Set(ms.map((m) => m.settings?.practiceLimit ?? PRACTICE_LIMIT));
  if (budgets.size > 1) notes.push("Builds had different practice budgets.");
  const providers = new Set(ms.map((m) => m.provider ?? "other"));
  if (providers.size === 1) notes.push("Every entry is from one provider.");
  return notes.length ? `${notes.join(" ")} Read it as a dry run, not a ranking.` : null;
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
