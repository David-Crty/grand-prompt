import type { GapMode, TimelineMarker } from "@bench/ui";
import {
  Button,
  CAMERA_LABEL,
  type CameraMode,
  CarLabel,
  FocusCard,
  GhostNote,
  IncidentBanner,
  IncidentCard,
  IncidentPin,
  IncidentTrace,
  MiniMap,
  PackLabel,
  RaceToast,
  SessionHeader,
  StartBoard,
  TimingTower,
  ToastStack,
  TransportBar,
  type TransportFlag,
} from "@bench/ui/react";
import { useMemo } from "react";
import { formatClock } from "../lib/format.js";
import type { CarSample, LapInfo } from "../lib/frames.js";
import { mapCars, mapPins } from "../lib/hud.js";
import { type Incident, incidentTitle } from "../lib/incidents.js";
import { type RaceMessage, TOAST_KIND } from "../lib/messages.js";
import { buildMinimap } from "../lib/minimap.js";
import type { ViewerModel } from "../lib/model.js";
import { type LaunchBoard, type Pack, packGroups } from "../lib/pack.js";
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
  /** The pack of ghost cars drawn with one label, if any. */
  pack: (Pack & { others: string[] }) | null;
  /** The start board while it is up (ghost start). */
  launch: LaunchBoard | null;
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
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: GapMode;
  onMode: (m: GapMode) => void;
  onFocus: (id: string) => void;
  onPin: (id: string) => void;
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
            onPin={onPin}
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
  incident,
  onReplay,
  onMap,
  onCloseIncident,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  backHref?: string;
  backLabel?: string;
  ghostOpen: boolean;
  onGhost: () => void;
  onWhy: (carId: string) => void;
  incident: Incident | null;
  onReplay: (inc: Incident) => void;
  onMap: () => void;
  onCloseIncident: () => void;
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
      {incident ? (
        <IncidentPanel
          model={model}
          incident={incident}
          onReplay={onReplay}
          onMap={onMap}
          onClose={onCloseIncident}
        />
      ) : snap.toasts.length ? (
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
  incident,
  onReplay,
  onMap,
  onClose,
  layout = "card",
}: {
  layout?: "card" | "sheet";
  model: ViewerModel;
  incident: Incident;
  onReplay: (inc: Incident) => void;
  onMap: () => void;
  onClose: () => void;
}) {
  const entry = model.entries.get(incident.carId);
  if (!entry) return null;
  const marks = incident.spins.map((s, k) => ({ t: s.t, label: k ? "SPIN 2" : "SPIN" }));
  return (
    <IncidentCard
      title={incidentTitle(incident)}
      where={incident.where}
      entry={entry}
      sentence={incident.error ? `${incident.sentence} ${incident.error}` : incident.sentence}
      trace={<IncidentTrace window={incident.window} marks={marks} entry={entry} />}
      facts={[
        { k: "Out at", v: formatClock(incident.t) },
        { k: "Impact", v: incident.impactKmh !== null ? `${incident.impactKmh} km/h` : "–" },
        { k: "Cause", v: incident.cause },
      ]}
      actions={
        <>
          <Button variant="primary" icon="back5" onClick={() => onReplay(incident)}>
            Replay from {formatClock(incident.replayFrom)}
          </Button>
          <Button icon="map" onClick={onMap}>
            Map
          </Button>
        </>
      }
      onClose={layout === "sheet" ? onClose : undefined}
      layout={layout}
    />
  );
}

/** Top centre during an incident replay: whose incident, and how long until it ends. */
export function IncidentMode({
  model,
  snap,
  incident,
  onExit,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  incident: Incident;
  onExit: () => void;
}) {
  const name = model.entries.get(incident.carId)?.name ?? incident.carId;
  const dt = incident.t - snap.t;
  const what = incident.impactKmh !== null ? "impact" : "retirement";
  const text = `${name} · ${dt > 0 ? `${dt.toFixed(1)} s to ${what}` : `${what} ${(-dt).toFixed(1)} s ago`}`;
  return (
    <div className="hud-banner">
      <IncidentBanner text={text} onExit={onExit} />
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
  const groups = snap.pack
    ? packGroups(snap.pack, snap.pack.others).map((g) => g.flatMap((id) => model.entries.get(id) ?? []))
    : [];
  const more = snap.pack && snap.pack.others.length < snap.pack.ids.length;
  return (
    <div className="labels">
      <div className="label-anchor" ref={registerPack} style={{ display: "none" }}>
        {groups.length ? (
          <PackLabel
            title={more ? `Pack · ${snap.pack!.others.length} more` : "Pack"}
            groups={groups}
            layout={phone ? "row" : "list"}
          />
        ) : null}
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

export function Start({ model, snap }: { model: ViewerModel; snap: HudSnapshot }) {
  const b = snap.launch;
  if (!b) return null;
  const rows = b.rows.flatMap((r) => {
    const entry = model.entries.get(r.id);
    return entry ? [{ entry, distance: r.distance }] : [];
  });
  const same = b.same.map((g) => g.flatMap((id) => model.entries.get(id) ?? []));
  return (
    <div className="hud-start">
      <StartBoard t={snap.t} rows={rows} scale={b.scale} same={same} />
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
