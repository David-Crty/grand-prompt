import { formatLapTime, kmh } from "../lib/format.js";
import { tracePath } from "../lib/laps.js";
import type { ViewerModel } from "../lib/model.js";

const W = 860;
const H = 300;

export function Analysis({
  model,
  cursorS,
  onClose,
}: {
  model: ViewerModel;
  cursorS: number | null;
  onClose: () => void;
}) {
  const traces = model.traces;
  const length = model.layout.length;
  let vmax = 0;
  for (const tr of traces) for (const v of tr.speed) vmax = Math.max(vmax, v);
  const top = Math.ceil((vmax * 3.6) / 50) * 50;
  const vmaxMs = top / 3.6;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += 50) ticks.push(v);
  const sectors = model.replay.track.sectors;
  return (
    <div className="analysis panel">
      <div className="analysis-head">
        <h3>Best lap speed trace</h3>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <svg
        viewBox={`-44 -10 ${W + 60} ${H + 40}`}
        className="chart"
        role="img"
        aria-label="Speed against distance"
      >
        {ticks.map((v) => {
          const y = H - (v / top) * H;
          return (
            <g key={v}>
              <line x1={0} x2={W} y1={y} y2={y} className="grid" />
              <text x={-8} y={y + 4} className="tick" textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}
        {sectors.map((s, k) => (
          <g key={s}>
            <line x1={(s / length) * W} x2={(s / length) * W} y1={0} y2={H} className="sector" />
            <text x={(s / length) * W + 4} y={12} className="tick">
              S{k + 2}
            </text>
          </g>
        ))}
        {traces.map((tr) => (
          <polyline
            key={tr.carId}
            points={tracePath(tr, length, 0, vmaxMs, W, H)}
            fill="none"
            stroke={tr.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {cursorS !== null ? (
          <line x1={(cursorS / length) * W} x2={(cursorS / length) * W} y1={0} y2={H} className="cursor" />
        ) : null}
        <text x={W} y={H + 26} className="tick" textAnchor="end">
          distance (m) · {Math.round(length)} m lap
        </text>
        <text x={0} y={H + 26} className="tick">
          km/h
        </text>
      </svg>
      <div className="legend">
        {traces.map((tr) => (
          <span key={tr.carId}>
            <span className="swatch" style={{ background: tr.color }} />
            {tr.name} · lap {tr.lap} · {formatLapTime(tr.time)} · top {kmh(Math.max(...tr.speed))} km/h
          </span>
        ))}
      </div>
    </div>
  );
}
