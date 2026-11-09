import { formatDelta, formatGap, formatLapTime } from "../lib/format.js";
import type { ViewerModel } from "../lib/model.js";

export function Classification({ model, onClose }: { model: ViewerModel; onClose: () => void }) {
  const ref = model.replay.header.referenceLap;
  const rows = model.replay.classification;
  const fastest = rows.reduce<number | null>(
    (m, r) => (r.bestLap != null && (m === null || r.bestLap < m) ? r.bestLap : m),
    null,
  );
  return (
    <div className="overlay">
      <button type="button" className="backdrop" onClick={onClose} aria-label="Close" />
      <div
        className="card panel classification"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
        role="dialog"
      >
        <div className="card-head">
          <span className="brand">GRAND PROMPT</span>
          <h2>Final classification</h2>
          <span className="card-sub">
            {model.replay.track.name} · {model.totalLaps} laps
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Pos</th>
              <th className="l">Driver program</th>
              <th>Time</th>
              <th>Gap</th>
              <th>Best lap</th>
              {ref != null ? <th>Δ ref</th> : null}
              <th>Pen.</th>
              <th className="l">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const out = r.status !== "FINISHED";
              return (
                <tr key={r.id} className={out ? "out" : ""}>
                  <td className="pos">{out && r.status.startsWith("DNF") ? "DNF" : r.position}</td>
                  <td className="l">
                    <span className="driver">
                      <span className="swatch" style={{ background: r.color }} />
                      {r.name}
                    </span>
                  </td>
                  <td>{formatLapTime(r.totalTime)}</td>
                  <td>
                    {r.position === 1
                      ? ""
                      : r.gap != null
                        ? formatGap(r.gap)
                        : r.status !== "FINISHED"
                          ? ""
                          : "--"}
                  </td>
                  <td className={r.bestLap != null && r.bestLap === fastest ? "purple" : ""}>
                    {formatLapTime(r.bestLap)}
                  </td>
                  {ref != null ? <td>{r.bestLap != null ? formatDelta(r.bestLap - ref) : ""}</td> : null}
                  <td>{r.penalties > 0 ? `+${r.penalties}s` : ""}</td>
                  <td className="l status">{r.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ref != null ? <p className="hint">Reference lap (house driver): {formatLapTime(ref)}</p> : null}
        <p className="hint">Press C to close</p>
      </div>
    </div>
  );
}
