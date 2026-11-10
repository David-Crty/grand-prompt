import { type CameraMode, formatClock, type GapMode, type TimelineMarker } from "@bench/ui";
import {
  CarLabel,
  ControlPanel,
  FocusCard,
  IncidentCard,
  IncidentPin,
  MiniMap,
  PackLabel,
  RaceToast,
  RangeControl,
  TimingTower,
  ToastStack,
  TransportBar,
  type TransportFlag,
} from "@bench/ui/react";
import { useMemo } from "react";
import { sliderToZoom, TV_TILT, TV_TILT_MAX, TV_TILT_MIN, zoomToSlider } from "../lib/camera.js";
import type { CarSample } from "../lib/frames.js";
import { entriesOf, mapCars, mapPins } from "../lib/hud.js";
import { type Incident, impactText, incidentTitle, replayCountdown } from "../lib/incidents.js";
import { type RaceMessage, TOAST_KIND } from "../lib/messages.js";
import { buildMinimap } from "../lib/minimap.js";
import type { ViewerModel } from "../lib/model.js";
import { PACK_CHIPS, packChips } from "../lib/pack.js";
import { SPEEDS } from "../lib/params.js";
import type { StandingRow } from "../lib/timing.js";
import { StarNote } from "./StarNote.js";

export interface HudSnapshot {
  t: number;
  playing: boolean;
  speed: number;
  rows: StandingRow[];
  focusId: string;
  focus: CarSample | null;
  /** Every car's sample, in model order, for the track map. */
  samples: CarSample[];
  fastestId: string | null;
  toasts: RaceMessage[];
  /** Cars that retired in the last few seconds, tinted on the tower. */
  justOut: Set<string>;
  /** The pack of ghost cars drawn with one label, if any. */
  pack: { others: string[] } | null;
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
  onPin,
  backHref,
  backLabel,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: GapMode;
  onMode: (m: GapMode) => void;
  onFocus: (id: string) => void;
  onPin: (id: string) => void;
  backHref?: string;
  backLabel?: string;
}) {
  const map = useMemo(() => buildMinimap(model.layout, MAP_W, MAP_H), [model]);
  return (
    <div className="hud-tower">
      <TimingTower
        rows={snap.rows}
        entries={model.entries}
        focusId={snap.focusId}
        fastestId={snap.fastestId}
        mode={mode}
        justOut={snap.justOut}
        onFocus={onFocus}
        onMode={onMode}
        head={{ track: model.replay.track.name, backHref, backLabel }}
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
            onPin={onPin}
          />
        </div>
      </TimingTower>
    </div>
  );
}

/** Top right: the race messages, which give way to the incident card while it is open. */
export function TopRight({
  model,
  snap,
  onWhy,
  incident,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  onWhy: (carId: string) => void;
  incident: Incident | null;
}) {
  return (
    <div className="hud-topright">
      {!incident && snap.toasts.length ? (
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

export function IncidentPanel({
  model,
  snap,
  incident,
  onReplay,
  onClose,
  layout = "card",
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  incident: Incident;
  onReplay: (inc: Incident) => void;
  onClose: () => void;
  layout?: "card" | "sheet";
}) {
  const entry = model.entries.get(incident.carId);
  if (!entry) return null;
  return (
    <IncidentCard
      title={incidentTitle(incident)}
      where={incident.where}
      entry={entry}
      note={incident.error}
      facts={[
        { k: "Out at", v: formatClock(incident.t) },
        { k: "Impact", v: impactText(incident) },
        replayCountdown(incident, snap.t),
      ]}
      restartLabel={`Replay from ${formatClock(incident.replayFrom)}`}
      onRestart={() => onReplay(incident)}
      onClose={onClose}
      layout={layout}
    />
  );
}

/** Top centre during an incident replay. */
export function IncidentMode(props: {
  model: ViewerModel;
  snap: HudSnapshot;
  incident: Incident;
  onReplay: (inc: Incident) => void;
  onClose: () => void;
}) {
  return (
    <div className="hud-banner">
      <IncidentPanel {...props} />
    </div>
  );
}

export function Focus({ model, snap }: { model: ViewerModel; snap: HudSnapshot }) {
  const row = snap.rows.find((r) => r.id === snap.focusId);
  const entry = model.entries.get(snap.focusId);
  if (!row || !entry) return null;
  return (
    <div className="hud-focus">
      <FocusCard row={row} entry={entry} sample={snap.focus} />
    </div>
  );
}

/** The TV camera's zoom and tilt, bottom right; the wheel and Z / X move the same zoom. */
export function TvRig({
  zoom,
  tilt,
  onZoom,
  onTilt,
}: {
  zoom: number;
  tilt: number;
  onZoom: (z: number) => void;
  onTilt: (deg: number) => void;
}) {
  return (
    <div className="hud-rig">
      <ControlPanel label="TV camera">
        <RangeControl
          label="Zoom"
          value={zoomToSlider(zoom)}
          min={0}
          max={1}
          step={0.01}
          mark={zoomToSlider(1)}
          display={`${zoom.toFixed(1)}×`}
          title="Zoom (wheel, Z / X); double-click to reset"
          onChange={(f) => onZoom(sliderToZoom(f))}
        />
        <RangeControl
          label="Tilt"
          value={tilt}
          min={TV_TILT_MIN}
          max={TV_TILT_MAX}
          step={1}
          mark={TV_TILT}
          display={`${Math.round(tilt)}°`}
          title="Tilt off the vertical; double-click to reset"
          onChange={onTilt}
        />
      </ControlPanel>
    </div>
  );
}

export function Transport({
  model,
  snap,
  mode,
  toggles,
  activeT,
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
  activeT: number | null;
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
        activeT={activeT}
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
  phone = false,
  register,
  registerPack,
  onFocus,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  phone?: boolean;
  register: (k: number, el: HTMLDivElement | null) => void;
  registerPack: (el: HTMLDivElement | null) => void;
  onFocus: (id: string) => void;
}) {
  const rows = new Map(snap.rows.map((r) => [r.id, r]));
  const chips = packChips(
    snap.pack?.others ?? [],
    (id) => model.entries.get(id)?.code ?? id,
    phone ? PACK_CHIPS.phone : PACK_CHIPS.desktop,
  );
  const listed = entriesOf(chips.ids, model.entries);
  return (
    <div className="labels">
      <div className="label-anchor" ref={registerPack} style={{ display: "none" }}>
        {listed.length ? <PackLabel entries={listed} hidden={chips.hidden} /> : null}
      </div>
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
            <button
              type="button"
              className="label-hit"
              onClick={() => onFocus(c.car.id)}
              aria-label={`Follow ${entry.name}`}
            >
              <CarLabel
                entry={entry}
                position={row?.position ?? null}
                focused={c.car.id === snap.focusId}
                out={row?.out ?? false}
                name={mode !== "map" && !phone}
              />
            </button>
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
  ["Home / End", "Start / end of the replay"],
  ["Z / X  or  wheel", "TV zoom in / out"],
  ["G", "Gap to P1 / interval"],
  ["T", "Trails"],
  ["A", "Analysis: speed, pedals and sectors of the timed laps"],
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
        <h2>Ghost cars</h2>
        <p className="hint">
          Each car ran its flying lap alone, from the same run-up onto the line at the same speed. The replay
          overlays the runs, so the cars sit on top of each other until they spread out after the line;
          nothing is moved.
        </p>
        <StarNote ask="Enjoyed the race?" />
      </div>
    </div>
  );
}
