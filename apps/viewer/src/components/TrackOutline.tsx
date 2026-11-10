import { useEffect, useRef } from "react";
import type { Outline } from "../lib/outline.js";

const LAP_MS = 6000;
const PAD = 8;

/** A circuit drawn from its outline; while `running`, a dot laps it (not under reduced motion). */
export function TrackOutline({ outline, running = false }: { outline: Outline; running?: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!running || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const tick = (now: number) => {
      const p = path.current;
      const d = dot.current;
      if (p && d) {
        const pt = p.getPointAtLength(((now % LAP_MS) / LAP_MS) * p.getTotalLength());
        d.setAttribute("cx", pt.x.toFixed(2));
        d.setAttribute("cy", pt.y.toFixed(2));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return (
    <svg
      className="rl-outline"
      viewBox={`${-PAD} ${-PAD} ${outline.width + 2 * PAD} ${outline.height + 2 * PAD}`}
      aria-hidden="true"
    >
      <path ref={path} className="rl-outline__base" d={outline.path} />
      <path className="rl-outline__line" d={outline.path} pathLength={1} />
      {running ? <circle ref={dot} className="rl-outline__dot" r={3.2} cx={-100} cy={-100} /> : null}
    </svg>
  );
}
