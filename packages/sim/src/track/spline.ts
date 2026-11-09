/**
 * Periodic (closed) interpolating cubic spline, C2-continuous, chord-length parameterized.
 * Used to turn a coarse closed polyline into a smooth curve with continuous curvature.
 */
export class PeriodicSpline {
  readonly n: number;
  readonly t: Float64Array; // knot parameters, t[0] = 0, length n + 1 (t[n] = period)
  readonly period: number;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly mx: Float64Array;
  private readonly my: Float64Array;

  constructor(xs: ArrayLike<number>, ys: ArrayLike<number>) {
    const n = xs.length;
    if (n < 4) throw new Error("PeriodicSpline needs at least 4 points");
    this.n = n;
    this.x = Float64Array.from(xs);
    this.y = Float64Array.from(ys);
    this.t = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const h = Math.hypot(this.x[j]! - this.x[i]!, this.y[j]! - this.y[i]!);
      if (h < 1e-9) throw new Error(`Duplicate consecutive points at index ${i}`);
      this.t[i + 1] = this.t[i]! + h;
    }
    this.period = this.t[n]!;
    this.mx = this.solve(this.x);
    this.my = this.solve(this.y);
  }

  private h(i: number): number {
    return this.t[i + 1]! - this.t[i]!;
  }

  /** Solve the cyclic tridiagonal system for second derivatives (Sherman-Morrison). */
  private solve(v: Float64Array): Float64Array {
    const n = this.n;
    const a = new Float64Array(n); // sub-diagonal
    const b = new Float64Array(n); // diagonal
    const c = new Float64Array(n); // super-diagonal
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const hp = this.h((i - 1 + n) % n);
      const hi = this.h(i);
      a[i] = hp;
      b[i] = 2 * (hp + hi);
      c[i] = hi;
      const vn = v[(i + 1) % n]!;
      const vp = v[(i - 1 + n) % n]!;
      d[i] = 6 * ((vn - v[i]!) / hi - (v[i]! - vp) / hp);
    }
    const alpha = c[n - 1]!; // corner element (n-1, 0)
    const beta = a[0]!; // corner element (0, n-1)
    const gamma = -b[0]!;
    const bb = Float64Array.from(b);
    bb[0] = b[0]! - gamma;
    bb[n - 1] = b[n - 1]! - (alpha * beta) / gamma;
    const xs = thomas(a, bb, c, d);
    const u = new Float64Array(n);
    u[0] = gamma;
    u[n - 1] = alpha;
    const z = thomas(a, bb, c, u);
    const fact = (xs[0]! + (beta * xs[n - 1]!) / gamma) / (1 + z[0]! + (beta * z[n - 1]!) / gamma);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = xs[i]! - fact * z[i]!;
    return out;
  }

  private segment(u: number): number {
    // binary search for segment i with t[i] <= u < t[i+1]
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.t[mid]! <= u) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Evaluate position, first and second derivatives at parameter u (wrapped to the period). */
  eval(u: number): {
    x: number;
    y: number;
    dx: number;
    dy: number;
    ddx: number;
    ddy: number;
    seg: number;
    f: number;
  } {
    u %= this.period;
    if (u < 0) u += this.period;
    const i = this.segment(u);
    const j = (i + 1) % this.n;
    const h = this.h(i);
    const A = (this.t[i + 1]! - u) / h;
    const B = (u - this.t[i]!) / h;
    const ev = (v: Float64Array, m: Float64Array) => {
      const vi = v[i]!;
      const vj = v[j]!;
      const mi = m[i]!;
      const mj = m[j]!;
      const p = A * vi + B * vj + ((A * A * A - A) * mi + (B * B * B - B) * mj) * ((h * h) / 6);
      const dp = (vj - vi) / h - ((3 * A * A - 1) * h * mi) / 6 + ((3 * B * B - 1) * h * mj) / 6;
      const ddp = A * mi + B * mj;
      return [p, dp, ddp] as const;
    };
    const [x, dx, ddx] = ev(this.x, this.mx);
    const [y, dy, ddy] = ev(this.y, this.my);
    return { x, y, dx, dy, ddx, ddy, seg: i, f: B };
  }
}

function thomas(a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array): Float64Array {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = c[0]! / b[0]!;
  dp[0] = d[0]! / b[0]!;
  for (let i = 1; i < n; i++) {
    const m = b[i]! - a[i]! * cp[i - 1]!;
    cp[i] = c[i]! / m;
    dp[i] = (d[i]! - a[i]! * dp[i - 1]!) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = dp[n - 1]!;
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i]! - cp[i]! * x[i + 1]!;
  return x;
}
