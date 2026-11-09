import type { GapMode, TimelineMarker } from "@bench/ui";
import {
  CAMERA_LABEL,
  type CameraMode,
  CarLabel,
  FocusCard,
  GhostNote,
  IncidentPin,
  MiniMap,
  RaceToast,
  SessionHeader,
  TimingTower,
  ToastStack,
  TransportBar,
  type TransportFlag,
} from "@bench/ui/react";
import { useMemo } from "react";
import type { CarSample, LapInfo } from "../lib/frames.js";
import { mapCars, mapPins } from "../lib/hud.js";
import { type RaceMessage, TOAST_KIND } from "../lib/messages.js";
import { buildMinimap } from "../lib/minimap.js";
import type { ViewerModel } from "../lib/model.js";
import { SPEEDS } from "../lib/params.js";
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
  toasts: RaceMessage[];
  /** Cars that retired in the last few seconds, tinted on the tower. */
  justOut: Set<string>;
  fpsMs: number;
  stats: { jsMs: number; calls: number; tris: number };
}

const MAP_W = 316;
const MAP_H = 150;

export function Tower({
  model,
  snap,
  mode,
  onMode,
  onFocus,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: GapMode;
  onMode: (m: GapMode) => void;
  onFocus: (id: string) => void;
}) {
  const map = useMemo(() => buildMinimap(model.layout, MAP_W, MAP_H), [model]);
  return (
    <div className="hud-tower">
      <TimingTower
        rows={snap.rows}
        entries={model.entries}
        totalLaps={model.totalLaps}
        focusId={snap.focusId}
        fastestId={snap.fastestId}
        mode={mode}
        justOut={snap.justOut}
        onFocus={onFocus}
        onMode={onMode}
      >
        <div className="hud-map">
          <MiniMap
            width={map.width}
            height={map.height}
            path={map.path}
            start={map.start}
            cars={mapCars(model, snap.rows, snap.samples, snap.focusId, map.project)}
            pins={mapPins(model, snap.t, map.project)}
            onFocus={onFocus}
          />
        </div>
      </TimingTower>
    </div>
  );
}

export function TopRight({
  model,
  snap,
  mode,
  backHref,
  backLabel,
  ghostOpen,
  onGhost,
  onWhy,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  backHref?: string;
  backLabel?: string;
  ghostOpen: boolean;
  onGhost: () => void;
  onWhy: (carId: string) => void;
}) {
  const s = model.replay.header.session;
  const sub = `${s.type === "race" ? "Race" : "Qualifying"} · ${model.totalLaps} ${model.totalLaps === 1 ? "lap" : "laps"} · ${CAMERA_LABEL[mode]}`;
  return (
    <div className="hud-topright">
      <SessionHeader
        backHref={backHref}
        backLabel={backLabel}
        track={model.replay.track.name}
        sub={sub}
        t={snap.t}
        speed={snap.speed}
        ghost={model.ghost}
        ghostOpen={ghostOpen}
        onGhost={onGhost}
      />
      {ghostOpen ? <GhostNote count={model.cars.length} onClose={onGhost} /> : null}
      {snap.toasts.length ? (
        <ToastStack>
          {snap.toasts.map((m) => {
            const kind = TOAST_KIND[m.kind];
            return (
              <RaceToast
                key={`${m.t}-${m.carId}-${m.kind}`}
                kind={kind}
                entry={model.entries.get(m.carId) ?? null}
                text={m.text}
                t={m.t}
                action={kind === "dnf" ? { label: "Why", onClick: () => onWhy(m.carId) } : null}
              />
            );
          })}
        </ToastStack>
      ) : null}
    </div>
  );
}

export function Focus({ model, snap }: { model: ViewerModel; snap: HudSnapshot }) {
  const row = snap.rows.find((r) => r.id === snap.focusId);
  const entry = model.entries.get(snap.focusId);
  if (!row || !entry) return null;
  const lap = snap.lap;
  const running = lap && !row.finished && !row.out;
  return (
    <div className="hud-focus">
      <FocusCard
        row={row}
        entry={entry}
        sample={snap.focus}
        fastest={snap.fastestId === row.id}
        laps={{
          lap: Math.min(model.totalLaps, (lap?.completed ?? 0) + 1),
          current: running ? snap.t - lap.currentLapStart : null,
          last: lap?.last ?? null,
          best: lap?.best ?? null,
        }}
      />
    </div>
  );
}

export function Transport({
  model,
  snap,
  mode,
  toggles,
  onToggle,
  onSeek,
  onMarker,
  onSpeed,
  onMode,
  onFlag,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  toggles: { trails: boolean; analysis: boolean; classification: boolean };
  onToggle: () => void;
  onSeek: (t: number) => void;
  onMarker: (m: TimelineMarker) => void;
  onSpeed: (dir: 1 | -1) => void;
  onMode: (m: CameraMode) => void;
  onFlag: (f: TransportFlag) => void;
}) {
  return (
    <div className="hud-transport">
      <TransportBar
        t={snap.t}
        duration={model.duration}
        playing={snap.playing}
        speed={snap.speed}
        canSlower={snap.speed > SPEEDS[0]}
        canFaster={snap.speed < SPEEDS[SPEEDS.length - 1]!}
        camera={mode}
        markers={model.markers}
        laps={model.laps}
        toggles={toggles}
        onToggle={onToggle}
        onSeek={onSeek}
        onMarker={onMarker}
        onSpeed={onSpeed}
        onCamera={onMode}
        onFlag={onFlag}
      />
    </div>
  );
}

export function Labels({
  model,
  snap,
  mode,
  register,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  register: (k: number, el: HTMLDivElement | null) => void;
}) {
  const rows = new Map(snap.rows.map((r) => [r.id, r]));
  return (
    <div className="labels">
      {model.cars.map((c, k) => {
        const row = rows.get(c.car.id);
        const entry = model.entries.get(c.car.id);
        if (!entry) return null;
        // On the map a retired car is a pin where it stopped; elsewhere it keeps a faded label.
        return row?.out && mode === "map" ? (
          <div key={c.car.id} className="label-anchor" ref={(el) => register(k, el)}>
            <IncidentPin label={`${entry.code} out`} />
          </div>
        ) : (
          <div key={c.car.id} className="label-anchor" ref={(el) => register(k, el)}>
            <CarLabel
              entry={entry}
              position={row?.position ?? null}
              focused={c.car.id === snap.focusId}
              out={row?.out ?? false}
              name={mode !== "map"}
            />
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
  [", .", "Previous / next event on the timeline"],
  ["↑ ↓  or  + −", "Playback speed"],
  ["Home / End", "Start / end of the race"],
  ["Z / X  or  wheel", "TV zoom in / out"],
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
