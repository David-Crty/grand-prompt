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

export function kmh(ms: number): number {
  return Math.round(ms * 3.6);
}
