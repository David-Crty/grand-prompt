import type { CarRun, TelemetryLog } from "./race.js";
import type { SessionResults } from "./session.js";

const COLUMNS: (keyof TelemetryLog)[] = [
  "t",
  "s",
  "speed",
  "throttle",
  "brake",
  "steer",
  "n",
  "surface",
  "ax",
  "ay",
];

export function telemetryCsv(log: TelemetryLog): string {
  const rows = [COLUMNS.join(",")];
  for (let i = 0; i < log.t.length; i++) {
    rows.push(
      COLUMNS.map((c) => {
        const v = log[c][i]!;
        if (typeof v === "string") return v;
        return (Math.round(v * 1000) / 1000).toString();
      }).join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

export function fmtTime(t: number | null): string {
  if (t === null || !Number.isFinite(t)) return "-";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

/** Human- and LLM-readable summary of a session. */
export function summarizeSession(res: SessionResults, runs: CarRun[]): string {
  const lines: string[] = [];
  const s = res.session;
  lines.push(
    `FLYING LAP on ${res.trackId} | launch ${(res.launchSpeed * 3.6).toFixed(0)} km/h at the line | seed=${s.seed} | sim ${res.simVersion} api ${res.apiVersion}`,
  );
  for (const r of res.classification) {
    const run = runs.find((x) => x.result.id === r.id);
    lines.push("");
    const gap = r.gap !== null ? ` gap +${r.gap.toFixed(3)}` : "";
    lines.push(`P${r.position} ${r.name} [${r.status}] lap ${fmtTime(r.lapTime)}${gap}`);
    lines.push(
      `   off-tracks ${r.offTracks}, strikes ${r.strikes}, top speed ${(r.maxSpeed * 3.6).toFixed(1)} km/h`,
    );
    const l = r.lap;
    if (l) {
      lines.push(
        `   lap: ${fmtTime(l.time)}  [${l.sectors.map((x) => x.toFixed(3)).join(" | ")}]${l.valid ? "" : "  INVALID (track limits), no time"}`,
      );
    }
    const notable = (run?.events ?? []).filter((e) =>
      ["offTrack", "impact", "crash", "strike", "status"].includes(e.type),
    );
    for (const e of notable.slice(0, 25)) {
      lines.push(
        `   t=${e.t.toFixed(2)} ${e.type}${e.value !== undefined ? ` ${e.value}` : ""}${e.detail ? ` ${e.detail}` : ""}`,
      );
    }
    if (notable.length > 25) lines.push(`   ... ${notable.length - 25} more events`);
    for (const err of r.errors.slice(0, 5)) lines.push(`   error: ${err}`);
  }
  return `${lines.join("\n")}\n`;
}
