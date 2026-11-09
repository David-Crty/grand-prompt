import { formatDelta, formatGap, formatLapTime } from "../lib/format.js";
import type { ViewerModel } from "../lib/model.js";

export function Classification({ model, onClose }: { model: ViewerModel; onClose: () => void }) {
  const ref = model.replay.header.referenceLap;
  const rows = model.replay.classification;
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
          <span className="card-sub">{model.replay.track.name} · flying lap</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Pos</th>
              <th className="l">Driver program</th>
              <th>Lap time</th>
              <th>Gap</th>
              {ref != null ? <th>Δ ref</th> : null}
              <th className="l">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const out = r.lapTime == null;
              return (
                <tr key={r.id} className={out ? "out" : ""}>
                  <td className="pos">{r.status.startsWith("DNF") ? "DNF" : r.position}</td>
                  <td className="l">
                    <span className="driver">
                      <span className="swatch" style={{ background: r.color }} />
                      {r.name}
                    </span>
                  </td>
                  <td className={r.position === 1 && !out ? "purple" : ""}>{formatLapTime(r.lapTime)}</td>
                  <td>{r.position === 1 || r.gap == null ? "" : formatGap(r.gap)}</td>
                  {ref != null ? <td>{r.lapTime != null ? formatDelta(r.lapTime - ref) : ""}</td> : null}
                  <td className="l status">{r.status === "FINISHED" && out ? "LAP DELETED" : r.status}</td>
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
