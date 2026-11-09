export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Wrap a distance along a closed loop of length `len` to [0, len). */
export function wrapS(s: number, len: number): number {
  s = s % len;
  return s < 0 ? s + len : s;
}

/** Signed shortest difference b - a on a loop of length `len`, in (-len/2, len/2]. */
export function loopDelta(a: number, b: number, len: number): number {
  let d = (b - a) % len;
  if (d > len / 2) d -= len;
  else if (d <= -len / 2) d += len;
  return d;
}

/** sfc32: small, fast, seedable PRNG. Deterministic across platforms (pure 32-bit integer ops). */
export class Prng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 15; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Standard normal (Box-Muller). */
  gaussian(): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

/**
 * Incremental 64-bit-ish hash (two interleaved 32-bit multiply-xorshift lanes) over float64 bit patterns
 * and strings. Pure TS so it runs identically in Node and the browser. Not cryptographic.
 */
export class Hasher {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;
  private readonly buf = new DataView(new ArrayBuffer(8));

  private mix(k: number): void {
    this.h1 = Math.imul(this.h1 ^ k, 2654435761);
    this.h2 = Math.imul(this.h2 ^ k, 1597334677);
  }

  number(v: number): this {
    this.buf.setFloat64(0, v);
    this.mix(this.buf.getUint32(0));
    this.mix(this.buf.getUint32(4));
    return this;
  }

  string(s: string): this {
    for (let i = 0; i < s.length; i++) this.mix(s.charCodeAt(i));
    this.mix(s.length);
    return this;
  }

  digest(): string {
    let h1 = this.h1;
    let h2 = this.h2;
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }
}

export function hashString(s: string): string {
  return new Hasher().string(s).digest();
}

/** Stable JSON stringify (sorted keys) for hashing configuration objects. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}
