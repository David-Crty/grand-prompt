import {
  CAMERA_LABEL,
  CAMERA_MODES,
  type CameraMode,
  type GapMode,
  type TimelineMarker,
  towerFinal,
} from "@bench/ui";
import {
  Button,
  CAMERA_ICON,
  Dropdown,
  FocusRow,
  IconButton,
  RaceToast,
  SegmentedControl,
  SessionBar,
  Sheet,
  Timeline,
  TimingTower,
  TowerStrip,
} from "@bench/ui/react";
import { ghostLine } from "../lib/hud.js";
import type { Incident } from "../lib/incidents.js";
import { TOAST_KIND } from "../lib/messages.js";
import type { ViewerModel } from "../lib/model.js";
import type { EventResults } from "../lib/results.js";
import { Analysis } from "./Analysis.js";
import { Classification } from "./Classification.js";
import type { HudSnapshot } from "./Hud.js";
import { IncidentPanel } from "./Hud.js";

export type PhoneSheet = "tower" | "result" | "incident" | "analysis";

/** Height of the incident sheet: the TV camera frames the car in the space above it. */
export const INCIDENT_SHEET_PX = 180;

/**
 * The phone layout (below 600 px): header bar, collapsed tower strip, one message at a time, and a dock with the
 * followed car, a touch timeline, play, speed and cameras. Everything else opens as a bottom sheet.
 */
export function PhoneHud({
  model,
  snap,
  mode,
  gapMode,
  sheet,
  incident,
  results,
  backHref,
  backLabel,
  onSheet,
  onFocus,
  onGapMode,
  onMode,
  onToggle,
  onSpeed,
  onSeek,
  onWatch,
  onMarker,
  onWhy,
  onReplay,
  onExitIncident,
  onRestart,
}: {
  model: ViewerModel;
  snap: HudSnapshot;
  mode: CameraMode;
  gapMode: GapMode;
  sheet: PhoneSheet | null;
  incident: Incident | null;
  results: EventResults | null;
  backHref?: string;
  backLabel?: string;
  onSheet: (s: PhoneSheet | null) => void;
  onFocus: (id: string) => void;
  onGapMode: (m: GapMode) => void;
  onMode: (m: CameraMode) => void;
  onToggle: () => void;
  onSpeed: () => void;
  onSeek: (t: number) => void;
  /** Play the replay from this time (the analysis' Watch). */
  onWatch: (t: number) => void;
  onMarker: (m: TimelineMarker) => void;
  onWhy: (carId: string) => void;
  onReplay: (inc: Incident) => void;
  onExitIncident: () => void;
  onRestart: () => void;
}) {
  const final = towerFinal(snap.rows);
  const row = snap.rows.find((r) => r.id === snap.focusId);
  const entry = model.entries.get(snap.focusId);
  // One message at a time: a retirement or the result while it lasts, otherwise the latest.
  const toast =
    [...snap.toasts].reverse().find((m) => TOAST_KIND[m.kind] === "dnf" || m.kind === "chequered") ??
    snap.toasts.at(-1);
  return (
    <div className="phone">
      <SessionBar
        backHref={backHref}
        backLabel={backLabel}
        track={model.replay.track.name}
        sub={ghostLine(model.cars.length)}
        final={final}
        t={snap.t}
      />
      <div className="phone-strip">
        <TowerStrip
          rows={snap.rows}
          entries={model.entries}
          focusId={snap.focusId}
          onExpand={() => onSheet("tower")}
        />
      </div>
      {toast ? (
        <div className="phone-toast">
          <RaceToast
            compact
            kind={TOAST_KIND[toast.kind]}
            entry={model.entries.get(toast.carId) ?? null}
            text={toast.short ?? toast.text}
            action={
              TOAST_KIND[toast.kind] === "dnf"
                ? { label: "Why", onClick: () => onWhy(toast.carId) }
                : toast.kind === "chequered"
                  ? { label: "Result", onClick: () => onSheet("result") }
                  : null
            }
          />
        </div>
      ) : null}
      <div className="gp-dock">
        <div className="gp-sheet__grab" />
        {row && entry ? (
          <button
            type="button"
            className="phone-focus"
            onClick={() => onSheet("analysis")}
            aria-label={`${entry.name}, open the analysis`}
          >
            <FocusRow row={row} entry={entry} sample={snap.focus} />
          </button>
        ) : null}
        <div className="gp-dock__timeline">
          <Timeline
            size="touch"
            duration={model.duration}
            t={snap.t}
            markers={model.markers}
            activeT={incident?.t ?? null}
            onSeek={onSeek}
            onMarker={onMarker}
          />
        </div>
        <div className="gp-dock__controls">
          <IconButton
            icon={snap.playing ? "pause" : "play"}
            iconSize={20}
            size="touch"
            variant="primary"
            label={snap.playing ? "Pause" : "Play"}
            onClick={onToggle}
          />
          <Button size="touch" className="gp-dock__speed" onClick={onSpeed} title="Playback speed">
            {snap.speed}×
          </Button>
          <span className="gp-flex" />
          <Dropdown<CameraMode>
            size="touch"
            placement="up"
            caps
            label="Camera"
            icon="camera"
            value={mode}
            onChange={onMode}
            options={CAMERA_MODES.map((c) => ({ value: c, label: CAMERA_LABEL[c], icon: CAMERA_ICON[c] }))}
          />
        </div>
      </div>
      {sheet === "tower" ? (
        <Sheet top={180} label="Timing" onClose={() => onSheet(null)}>
          <div className="phone-sheet__head">
            <span className="gp-label phone-sheet__title">Timing · {final ? "Final" : "Flying lap"}</span>
            <SegmentedControl<GapMode>
              size="touch"
              label="Gap or interval"
              value={gapMode}
              onChange={onGapMode}
              options={[
                { value: "gap", label: "Gap" },
                { value: "interval", label: "Interval" },
              ]}
            />
          </div>
          <TimingTower
            layout="sheet"
            rows={snap.rows}
            entries={model.entries}
            focusId={snap.focusId}
            fastestId={snap.fastestId}
            mode={gapMode}
            justOut={snap.justOut}
            onFocus={(id) => {
              onFocus(id);
              onSheet(null);
            }}
            onMode={onGapMode}
          />
          <p className="gp-faint phone-sheet__hint">
            Tap a car to follow it. Swipe the scene left or right to change car.
          </p>
        </Sheet>
      ) : null}
      {sheet === "incident" && incident ? (
        <Sheet
          top={`calc(100% - ${INCIDENT_SHEET_PX}px)`}
          label="Incident"
          dim={false}
          onClose={onExitIncident}
        >
          <IncidentPanel
            layout="sheet"
            model={model}
            snap={snap}
            incident={incident}
            onReplay={onReplay}
            onClose={onExitIncident}
          />
        </Sheet>
      ) : null}
      {sheet === "result" ? (
        <Sheet top={96} label="Result" onClose={() => onSheet(null)}>
          <Classification
            model={model}
            results={results}
            layout="sheet"
            onClose={() => onSheet(null)}
            onRestart={onRestart}
            onAnalysis={() => onSheet("analysis")}
            backHref={backHref}
          />
        </Sheet>
      ) : null}
      {sheet === "analysis" ? (
        <Sheet top={52} label="Analysis" onClose={() => onSheet(null)}>
          <Analysis
            model={model}
            focusId={snap.focusId}
            cursorS={snap.focus?.s ?? null}
            layout="sheet"
            onClose={() => onSheet(null)}
            onFocus={onFocus}
            onWatch={(t) => {
              onWatch(t);
              onSheet(null);
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
