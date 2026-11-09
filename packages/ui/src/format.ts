/** 83.456 -> "1:23.456", 9.5 -> "9.500". Negative or non-finite -> "--". */
export function formatLapTime(t: number | null | undefined, digits = 3): string {
  if (t == null || !Number.isFinite(t) || t < 0) return "--";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sec = s.toFixed(digits);
  return m > 0 ? `${m}:${sec.padStart(digits > 0 ? digits + 3 : 2, "0")}` : sec;
}

/** Session clock: 3725.4 -> "1:02:05", 83.4 -> "1:23". */
export function formatClock(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatGap(gap: number | null | undefined, digits = 3): string {
  if (gap == null || !Number.isFinite(gap)) return "";
  return `+${gap.toFixed(digits)}`;
}

export function formatLapsDown(n: number): string {
  return n === 1 ? "+1 LAP" : `+${n} LAPS`;
}

/** Signed delta, e.g. vs a reference lap: "+0.532" / "-0.104". */
export function formatDelta(d: number | null | undefined, digits = 3): string {
  if (d == null || !Number.isFinite(d)) return "";
  const sign = d < 0 ? "-" : "+";
  return `${sign}${Math.abs(d).toFixed(digits)}`;
}

export function kmh(ms: number): number {
  return Math.round(ms * 3.6);
}

/** Short status label for the timing tower. */
export function statusShort(status: string): string {
  if (status === "RUNNING") return "";
  if (status === "FINISHED") return "FIN";
  if (status.startsWith("DNF")) return "DNF";
  if (status === "TIME UP") return "TIME";
  return status.slice(0, 4).toUpperCase();
}

/** Two-to-four letter tag from a name, e.g. "Reference 97%" -> "R97", "DDK baseline" -> "DDK". */
export function nameTag(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return "???";
  const digits = name.match(/\d+/)?.[0] ?? "";
  if (digits) return (words[0]![0]!.toUpperCase() + digits).slice(0, 4);
  const first = words[0]!;
  if (words.length === 1 || first.length <= 4) return first.slice(0, 3).toUpperCase();
  return words
    .map((w) => w[0]!)
    .join("")
    .slice(0, 3)
    .toUpperCase();
}
