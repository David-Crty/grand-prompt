/** Playback clock in replay seconds. Wall time drives it; nothing here knows about rendering. */
export class PlaybackClock {
  t = 0;
  speed = 1;
  playing = true;
  readonly duration: number;

  constructor(duration: number, opts: { t?: number; speed?: number; playing?: boolean } = {}) {
    this.duration = Math.max(0, duration);
    this.t = this.clampT(opts.t ?? 0);
    this.speed = opts.speed ?? 1;
    this.playing = opts.playing ?? true;
  }

  private clampT(t: number): number {
    return Math.min(this.duration, Math.max(0, Number.isFinite(t) ? t : 0));
  }

  /** Advance by a wall-clock delta (s). Stops at the end. Returns the new time. */
  advance(wallDt: number): number {
    if (!this.playing) return this.t;
    this.t = this.clampT(this.t + Math.min(wallDt, 0.25) * this.speed);
    if (this.t >= this.duration) this.playing = false;
    return this.t;
  }

  seek(t: number): void {
    this.t = this.clampT(t);
  }

  seekBy(dt: number): void {
    this.seek(this.t + dt);
  }

  toggle(): void {
    if (!this.playing && this.t >= this.duration) this.t = 0;
    this.playing = !this.playing;
  }

  get atEnd(): boolean {
    return this.t >= this.duration;
  }
}
