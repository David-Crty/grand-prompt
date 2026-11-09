import { useMemo } from "react";
import { TV_ZOOM_MAX, TV_ZOOM_MIN } from "../lib/camera.js";
import { contrastText } from "../lib/color.js";
import { formatClock, formatLapTime, kmh, nameTag, statusShort } from "../lib/format.js";
import type { CarSample, LapInfo } from "../lib/frames.js";
import type { RaceMessage } from "../lib/messages.js";
import { buildMinimap } from "../lib/minimap.js";
import type { ViewerModel } from "../lib/model.js";
import { CAMERA_MODES, type CameraMode, SPEEDS } from "../lib/params.js";
import type { StandingRow } from "../lib/timing.js";

export interface HudSnapshot {
  t: number;
  playing: boolean;
  speed: number;
  rows: StandingRow[];
  focusId: string;
  focus: CarSample | null;
  /** Every car's sample, in model order, for the track map. */
  samples: CarSample[];
  lap: LapInfo | null;
  fastestId: string | null;
  messages: RaceMessage[];
  fpsMs: number;
  stats: { jsMs: number; calls: number; tris: number };
}

const MODE_LABEL: Record<CameraMode, string> = { tv: "TV", chase: "Chase", onboard: "Onboard", map: "Map" };

export function TimingTower({
  model,
  snap,
  showInterval,
  onFocus,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  showInterval: boolean;
  onFocus: (id: string) => void;
}) {
  const leader = snap.rows[0];
  const lap = leader ? (leader.finished ? model.totalLaps : leader.lap) : 1;
  const allDone = snap.rows.every((r) => r.finished || r.out);
  return (
    <div className="tower panel">
      <div className="tower-head">
        <span className="brand">GRAND PROMPT</span>
        <span className="tower-lap">{allDone ? "FINAL" : `LAP ${lap}/${model.totalLaps}`}</span>
      </div>
      {snap.rows.map((r) => {
        const st = statusShort(r.status);
        return (
          <button
            type="button"
            key={r.id}
            className={`tower-row${r.id === snap.focusId ? " focused" : ""}${r.out ? " out" : ""}`}
            onClick={() => onFocus(r.id)}
            title={r.name}
          >
            <span className="pos">{r.position}</span>
            <span className="swatch" style={{ background: r.color }} />
            <span className="name">{r.name}</span>
            <span
              className={snap.fastestId === r.id ? "fastest" : ""}
              title={snap.fastestId === r.id ? "Fastest lap" : undefined}
            />
            <span className={`gap${r.position === 1 ? " lead" : ""}`}>
              {showInterval ? r.intervalText : r.gapText}
            </span>
            <span className="lapcol">
              {st === "FIN" ? (
                <Chequer />
              ) : st ? (
                <span className={`badge b-${st.toLowerCase()}`}>{st}</span>
              ) : (
                `L${r.lap}`
              )}
            </span>
          </button>
        );
      })}
      <div className="tower-foot">{showInterval ? "INTERVAL" : "GAP TO LEADER"}</div>
      <TrackMap model={model} snap={snap} onFocus={onFocus} />
    </div>
  );
}

const MAP_WIDTH = 340;
const MAP_MAX_HEIGHT = 190;

function TrackMap({
  model,
  snap,
  onFocus,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  onFocus: (id: string) => void;
}) {
  const map = useMemo(() => buildMinimap(model.layout, MAP_WIDTH, MAP_MAX_HEIGHT), [model]);
  const position = new Map(snap.rows.map((r) => [r.id, r]));
  const order = model.cars
    .map((c, k) => ({ c, k, row: position.get(c.car.id) }))
    .filter((e) => snap.samples[e.k])
    .sort((a, b) => (b.row?.position ?? 0) - (a.row?.position ?? 0));
  const focused = order.find((e) => e.c.car.id === snap.focusId);
  const drawn = focused ? [...order.filter((e) => e !== focused), focused] : order;
  return (
    <svg className="trackmap" viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="Track map">
      <path className="tm-track" d={map.path} />
      <path className="tm-line" d={map.path} />
      <line className="tm-start" x1={map.start[0]} y1={map.start[1]} x2={map.start[2]} y2={map.start[3]} />
      {drawn.map(({ c, k, row }) => {
        const s = snap.samples[k]!;
        const [x, y] = map.project(s.x, s.y);
        const isFocus = c.car.id === snap.focusId;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: the tower rows are the accessible way to pick a car
          <g
            key={c.car.id}
            className={`tm-car${isFocus ? " focused" : ""}${row?.out ? " out" : ""}`}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
            onClick={() => onFocus(c.car.id)}
          >
            <title>{`P${row?.position ?? "?"} ${c.car.name}`}</title>
            <circle r={isFocus ? 6.5 : 4.5} fill={c.car.color} />
          </g>
        );
      })}
    </svg>
  );
}

function Chequer() {
  const cells = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++)
      if ((r + c) % 2 === 0) cells.push(<rect key={`${r}${c}`} x={c * 4} y={r * 4} width={4} height={4} />);
  return (
    <svg className="chequer" viewBox="0 0 16 12" width="16" height="12" aria-label="Finished">
      <rect width="16" height="12" fill="#fff" />
      <g fill="#111">{cells}</g>
    </svg>
  );
}

export function SessionInfo({
  model,
  snap,
  mode,
  backHref,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  backHref?: string;
}) {
  return (
    <div className="session panel">
      {backHref ? (
        <a className="session-back" href={backHref}>
          ← All races
        </a>
      ) : null}
      <div className="session-track">{model.replay.track.name}</div>
      <div className="session-row">
        <span className="session-type">{model.replay.header.session.type.toUpperCase()}</span>
        <span className="clock">{formatClock(snap.t)}</span>
        <span className={`speed-badge${snap.speed !== 1 ? " fast" : ""}`}>{snap.speed}×</span>
      </div>
      <div className="session-cam">{MODE_LABEL[mode]}</div>
    </div>
  );
}

export function Telemetry({ model, snap }: { model: ViewerModel; snap: HudSnapshot }) {
  const f = snap.focus;
  const row = snap.rows.find((r) => r.id === snap.focusId);
  const car = model.cars.find((c) => c.car.id === snap.focusId)?.car;
  if (!f || !row || !car) return null;
  const lap = snap.lap;
  const cur = lap && !row.finished && !row.out ? snap.t - lap.currentLapStart : null;
  const off = f.surface >= 2 && !f.ended;
  return (
    <div className="telemetry panel">
      <div className="tel-head" style={{ background: car.color, color: contrastText(car.color) }}>
        <span className="tel-pos">P{row.position}</span>
        <span className="tel-name">{car.name}</span>
      </div>
      <div className="tel-body">
        <div className="tel-speed">
          <span className="tel-kmh">{f.ended ? 0 : kmh(f.speed)}</span>
          <span className="tel-unit">KM/H</span>
        </div>
        <div className="tel-bars">
          <Bar label="THR" value={f.ended ? 0 : f.throttle} cls="thr" />
          <Bar label="BRK" value={f.ended ? 0 : f.brake} cls="brk" />
        </div>
        <div className="tel-steer">
          <div className="steer-track">
            <div className="steer-dot" style={{ left: `${50 - f.steer * 50}%` }} />
          </div>
          <span>STEER</span>
        </div>
      </div>
      <div className="tel-laps">
        <div>
          <span className="k">LAP</span>
          <span className="v">
            {cur !== null ? formatLapTime(cur, 1) : row.status === "FINISHED" ? "FIN" : "--"}
          </span>
        </div>
        <div>
          <span className="k">LAST</span>
          <span className={`v${lap?.lastValid === false ? " invalid" : ""}`}>{formatLapTime(lap?.last)}</span>
        </div>
        <div>
          <span className="k">BEST</span>
          <span className={`v${snap.fastestId === car.id ? " purple" : ""}`}>{formatLapTime(lap?.best)}</span>
        </div>
      </div>
      {off ? <div className="tel-off">{["", "", "GRASS", "GRAVEL", "BARRIER"][f.surface]}</div> : null}
    </div>
  );
}

function Bar({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bar">
      <div className="bar-track">
        <div
          className={`bar-fill ${cls}`}
          style={{ height: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      </div>
      <span>{label}</span>
    </div>
  );
}

export function Messages({ snap }: { snap: HudSnapshot }) {
  if (snap.messages.length === 0) return null;
  return (
    <div className="messages">
      {snap.messages.map((m) => (
        <div key={`${m.t}-${m.carId}-${m.kind}`} className={`msg panel m-${m.kind}`}>
          <span className="swatch" style={{ background: m.color }} />
          <span className="msg-name">{nameTag(m.name)}</span>
          <span className="msg-text">{m.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Controls({
  model,
  snap,
  mode,
  trails,
  zoom,
  onZoom,
  onToggle,
  onSeek,
  onSpeed,
  onMode,
  onTrails,
  onAnalysis,
  onHelp,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  trails: boolean;
  zoom: number;
  onZoom: (z: number) => void;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: (dir: 1 | -1) => void;
  onMode: (m: CameraMode) => void;
  onTrails: () => void;
  onAnalysis: () => void;
  onHelp: () => void;
}) {
  return (
    <div className="controls panel">
      <button type="button" className="play" onClick={onToggle} aria-label={snap.playing ? "Pause" : "Play"}>
        {snap.playing ? (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" fill="currentColor" />
            <rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 2 L14 8 L4 14 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="time">
        {formatClock(snap.t)} / {formatClock(model.duration)}
      </span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={model.duration}
        step={0.02}
        value={snap.t}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek"
      />
      <div className="seg speed">
        <button
          type="button"
          onClick={() => onSpeed(-1)}
          disabled={snap.speed <= SPEEDS[0]}
          aria-label="Slower"
          title="Slower (key − or ↓)"
        >
          −
        </button>
        <span className="speed-value">{snap.speed}×</span>
        <button
          type="button"
          onClick={() => onSpeed(1)}
          disabled={snap.speed >= SPEEDS[SPEEDS.length - 1]!}
          aria-label="Faster"
          title="Faster (key + or ↑)"
        >
          +
        </button>
      </div>
      <div className="seg">
        {CAMERA_MODES.map((m, k) => (
          <button
            type="button"
            key={m}
            className={mode === m ? "on" : ""}
            onClick={() => onMode(m)}
            title={`Key ${k + 1}`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {mode === "tv" ? (
        <label className="zoom" title="Mouse wheel or keys Z / X, double-click to reset">
          <span>Zoom {zoom.toFixed(1)}×</span>
          <input
            type="range"
            min={Math.log2(TV_ZOOM_MIN)}
            max={Math.log2(TV_ZOOM_MAX)}
            step={0.01}
            value={Math.log2(zoom)}
            onChange={(e) => onZoom(2 ** Number(e.target.value))}
            onDoubleClick={() => onZoom(1)}
            aria-label="TV zoom"
          />
        </label>
      ) : null}
      <div className="seg">
        <button type="button" className={trails ? "on" : ""} onClick={onTrails} title="Key T">
          Trails
        </button>
        <button type="button" onClick={onAnalysis} title="Key A">
          Analysis
        </button>
        <button type="button" onClick={onHelp} title="Key ?">
          ?
        </button>
      </div>
    </div>
  );
}

export function Labels({
  model,
  snap,
  register,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  register: (k: number, el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="labels">
      {model.cars.map((c, k) => {
        const row = snap.rows.find((r) => r.id === c.car.id);
        return (
          <div key={c.car.id} className="label-anchor" ref={(el) => register(k, el)}>
            <div className={`label${c.car.id === snap.focusId ? " focused" : ""}`}>
              <span
                className="label-pos"
                style={{ background: c.car.color, color: contrastText(c.car.color) }}
              >
                {row?.position ?? ""}
              </span>
              <span className="label-name">{c.car.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const KEYS: [string, string][] = [
  ["1 2 3 4", "TV, chase, onboard, map"],
  ["Tab / ] and Shift+Tab / [", "Next / previous car (or click one in the timing tower)"],
  ["Space", "Play / pause"],
  ["← →", "Seek 5 s (Shift: 30 s)"],
  ["↑ ↓  or  + −", "Playback speed"],
  ["Home / End", "Start / end of the race"],
  ["Z / X  or  wheel", "TV zoom in / out (double-click the slider to reset)"],
  ["G", "Gap to leader / interval"],
  ["T", "Trails"],
  ["A", "Analysis: best-lap speed traces"],
  ["C", "Classification"],
  ["H", "Hide / show HUD"],
  ["F", "FPS readout"],
  ["?", "This help"],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay">
      <button type="button" className="backdrop" onClick={onClose} aria-label="Close" />
      <div className="card panel help">
        <h2>Keyboard</h2>
        <table>
          <tbody>
            {KEYS.map(([k, v]) => (
              <tr key={k}>
                <td className="key">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Drop a replay.json or replay.json.gz anywhere to load it.</p>
      </div>
    </div>
  );
}
