import { type GapMode, stepMarker, type TimelineMarker } from "@bench/ui";
import type { TransportFlag } from "@bench/ui/react";
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { Analysis } from "./components/Analysis.js";
import { Classification } from "./components/Classification.js";
import {
  Focus,
  Help,
  type HudSnapshot,
  IncidentMode,
  Labels,
  Start,
  TopRight,
  Tower,
  Transport,
} from "./components/Hud.js";
import { INCIDENT_SHEET_PX, PhoneHud, type PhoneSheet } from "./components/PhoneHud.js";
import { clampZoom, stepZoom } from "./lib/camera.js";
import { lapInfoAt, overallBestAt } from "./lib/frames.js";
import { cycleSpeed, pinchFactor, swipeDir } from "./lib/gestures.js";
import { justOut } from "./lib/hud.js";
import type { Incident } from "./lib/incidents.js";
import { visibleToasts } from "./lib/messages.js";
import type { ViewerModel } from "./lib/model.js";
import { launchBoard, startBoardVisible } from "./lib/pack.js";
import { CAMERA_MODES, type CameraMode, SPEEDS, stepSpeed, type ViewerParams } from "./lib/params.js";
import { PlaybackClock } from "./lib/playback.js";
import type { EventResults } from "./lib/results.js";
import { MARKER_LEAD } from "./lib/timeline.js";
import { Cars } from "./scene/Cars.js";
import { Driver } from "./scene/Driver.js";
import { IncidentRing } from "./scene/IncidentRing.js";
import type { LiveState } from "./scene/live.js";
import { World } from "./scene/World.js";
import { usePhone } from "./usePhone.js";

export function Viewer({
  model,
  params,
  backHref,
  backLabel,
  results = null,
}: {
  model: ViewerModel;
  params: ViewerParams;
  backHref?: string;
  backLabel?: string;
  /** The event's results and build manifests, when published next to the replay. */
  results?: EventResults | null;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const firstId = model.cars[0]!.car.id;
  const initialFocus = params.car && model.cars.some((c) => c.car.id === params.car) ? params.car : firstId;
  const live = useRef<LiveState>(null as unknown as LiveState);
  if (live.current === null) {
    live.current = {
      clock: new PlaybackClock(model.duration, {
        t: params.t ?? 0,
        speed: params.speed ?? 1,
        playing: params.play ?? params.t === null,
      }),
      mode: params.cam ?? "tv",
      focusId: initialFocus,
      trails: params.trails,
      tvZoom: clampZoom(params.zoom ?? 1),
      rows: [],
      samples: [],
      cars: [],
      labels: [],
      packs: [],
      labelPack: null,
      packLabel: null,
      insetBottom: null,
      cam: {
        pos: [0, 50, 50],
        look: [0, 0, 0],
        fov: 40,
        heading: 0,
        init: false,
        key: "",
        offset: [0, 0],
        span: 0,
        framed: [],
      },
      wheelSpin: [],
      fps: { frames: 0, acc: 0, avgMs: 0, lastLog: 0, jsAcc: 0, jsMs: 0, calls: 0, tris: 0 },
    };
  }
  const [mode, setModeState] = useState<CameraMode>(live.current.mode);
  const [trails, setTrails] = useState(params.trails);
  const setZoom = useCallback((z: number) => {
    live.current.tvZoom = clampZoom(z);
  }, []);
  const [hud, setHud] = useState(params.hud);
  const [analysis, setAnalysis] = useState(params.analysis);
  const [fps, setFps] = useState(params.fps);
  const [help, setHelp] = useState(false);
  const [gapMode, setGapMode] = useState<GapMode>("gap");
  // null: shown on its own while the start board is up; true or false once the viewer has toggled it.
  const [ghostOpen, setGhostOpen] = useState<boolean | null>(null);
  const [classif, setClassif] = useState(false);
  // Incident replay: the card, the banner, slow motion and the ring on the ground, until Exit.
  const [incident, setIncident] = useState<Incident | null>(null);
  const phone = usePhone();
  const [sheet, setSheet] = useState<PhoneSheet | null>(null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  live.current.insetBottom = phone && sheet === "incident" ? INCIDENT_SHEET_PX : null;
  const autoShown = useRef(false);
  const [snap, setSnap] = useState<HudSnapshot | null>(null);

  const setMode = useCallback((m: CameraMode) => {
    live.current.mode = m;
    setModeState(m);
  }, []);

  const toggleTrails = useCallback(() => {
    live.current.trails = !live.current.trails;
    setTrails(live.current.trails);
  }, []);

  const focusCar = useCallback((id: string) => {
    live.current.focusId = id;
  }, []);

  const cycleCar = useCallback(
    (dir: 1 | -1) => {
      const L = live.current;
      const order = L.rows.length ? L.rows.map((r) => r.id) : model.cars.map((c) => c.car.id);
      const k = order.indexOf(L.focusId);
      focusCar(order[(k + dir + order.length) % order.length]!);
    },
    [model, focusCar],
  );

  useEffect(() => {
    const tick = () => {
      const L = live.current;
      const t = L.clock.t;
      const k = model.cars.findIndex((c) => c.car.id === L.focusId);
      const best = overallBestAt(model.cars, t);
      const board =
        model.ghost && L.samples.length === model.cars.length
          ? launchBoard(model.cars.map((c, j) => ({ id: c.car.id, ...L.samples[j]! })))
          : null;
      setSnap({
        t,
        playing: L.clock.playing,
        speed: L.clock.speed,
        rows: L.rows,
        focusId: L.focusId,
        focus: L.samples[k] ?? null,
        samples: [...L.samples],
        lap: k >= 0 ? lapInfoAt(model.cars[k]!, t) : null,
        fastestId: best?.id ?? null,
        toasts: visibleToasts(model.messages, t, L.clock.speed, 3),
        justOut: justOut(model.cars, t),
        pack: L.labelPack,
        launch: board && startBoardVisible(t, board.spread) ? board : null,
        fpsMs: L.fps.avgMs,
        stats: { jsMs: L.fps.jsMs, calls: L.fps.calls, tris: L.fps.tris },
      });
      if (L.clock.atEnd && !autoShown.current) {
        autoShown.current = true;
        if (phoneRef.current) setSheet("result");
        else setClassif(true);
      }
    };
    const id = window.setInterval(tick, 66);
    tick();
    return () => window.clearInterval(id);
  }, [model]);

  const seekMarker = useCallback((m: TimelineMarker) => {
    live.current.clock.seek(Math.max(0, m.t - MARKER_LEAD));
  }, []);

  const stepEvent = useCallback(
    (dir: 1 | -1) => {
      const m = stepMarker(model.markers, live.current.clock.t + MARKER_LEAD, dir);
      if (m) seekMarker(m);
    },
    [model, seekMarker],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      const L = live.current;
      const c = L.clock;
      let handled = true;
      switch (e.key) {
        case "1":
        case "2":
        case "3":
        case "4":
          setMode(CAMERA_MODES[Number(e.key) - 1]!);
          break;
        case "Tab":
          cycleCar(e.shiftKey ? -1 : 1);
          break;
        case "]":
          cycleCar(1);
          break;
        case "[":
          cycleCar(-1);
          break;
        case " ":
          c.toggle();
          break;
        case "ArrowRight":
          c.seekBy(e.shiftKey ? 30 : 5);
          break;
        case "ArrowLeft":
          c.seekBy(e.shiftKey ? -30 : -5);
          break;
        case "ArrowUp":
        case "+":
        case "=":
          c.speed = stepSpeed(c.speed, 1);
          break;
        case "ArrowDown":
        case "-":
          c.speed = stepSpeed(c.speed, -1);
          break;
        case ",":
          stepEvent(-1);
          break;
        case ".":
          stepEvent(1);
          break;
        case "Home":
          c.seek(0);
          break;
        case "End":
          c.seek(c.duration);
          break;
        case "z":
        case "Z":
          setZoom(stepZoom(L.tvZoom, 1));
          break;
        case "x":
        case "X":
          setZoom(stepZoom(L.tvZoom, -1));
          break;
        case "t":
        case "T":
          toggleTrails();
          break;
        case "h":
        case "H":
          setHud((v) => !v);
          break;
        case "a":
        case "A":
          setAnalysis((v) => !v);
          break;
        case "c":
        case "C":
          setClassif((v) => !v);
          break;
        case "f":
        case "F":
          setFps((v) => !v);
          break;
        case "g":
        case "G":
          setGapMode((v) => (v === "gap" ? "interval" : "gap"));
          break;
        case "?":
          setHelp((v) => !v);
          break;
        case "Escape":
          setIncident(null);
          setHelp(false);
          setClassif(false);
          setAnalysis(false);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleCar, setMode, setZoom, stepEvent, toggleTrails]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (live.current.mode !== "tv" || !(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setZoom(live.current.tvZoom * 2 ** (-px / 600));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  const registerLabel = useCallback((k: number, el: HTMLDivElement | null) => {
    live.current.labels[k] = el;
  }, []);
  const registerPack = useCallback((el: HTMLDivElement | null) => {
    live.current.packLabel = el;
  }, []);
  const ghostShown = ghostOpen ?? snap?.launch != null;

  const onSeek = useCallback((t: number) => live.current.clock.seek(t), []);
  const cursorS = useMemo(() => snap?.focus?.s ?? null, [snap]);
  const onFlag = useCallback(
    (f: TransportFlag) => {
      if (f === "trails") toggleTrails();
      else if (f === "analysis") setAnalysis((v) => !v);
      else if (f === "classification") setClassif((v) => !v);
      else setHelp((v) => !v);
    },
    [toggleTrails],
  );
  const replayIncident = useCallback(
    (inc: Incident) => {
      const c = live.current.clock;
      focusCar(inc.carId);
      c.seek(inc.replayFrom);
      c.speed = 0.5;
      c.playing = true;
    },
    [focusCar],
  );
  const onWhy = useCallback(
    (carId: string) => {
      const inc = model.incidents.find((i) => i.carId === carId);
      if (!inc) return;
      setIncident(inc);
      if (phoneRef.current) setSheet("incident");
      replayIncident(inc);
    },
    [model, replayIncident],
  );
  const exitIncident = useCallback(() => {
    setIncident(null);
    setSheet((s) => (s === "incident" ? null : s));
    live.current.clock.speed = 1;
  }, []);

  // Phone gestures on the scene: a sideways flick changes car, two fingers zoom the TV camera.
  const touch = useRef<{
    pts: Map<number, { x: number; y: number }>;
    x0: number;
    y0: number;
    t0: number;
    d0: number;
  }>({
    pts: new Map(),
    x0: 0,
    y0: 0,
    t0: 0,
    d0: 0,
  });
  const spread = () => {
    const [a, b] = [...touch.current.pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!phone || !(e.target instanceof HTMLCanvasElement)) return;
    const g = touch.current;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pts.size === 1) Object.assign(g, { x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (g.pts.size === 2) g.d0 = spread();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = touch.current;
    if (!g.pts.has(e.pointerId)) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pts.size === 2 && live.current.mode === "tv") {
      const d = spread();
      setZoom(live.current.tvZoom * pinchFactor(g.d0, d));
      g.d0 = d;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = touch.current;
    if (!g.pts.has(e.pointerId)) return;
    const single = g.pts.size === 1;
    g.pts.delete(e.pointerId);
    if (!single) return;
    const dir = swipeDir(e.clientX - g.x0, e.clientY - g.y0, performance.now() - g.t0);
    if (dir) cycleCar(dir);
  };

  return (
    <div
      className={`viewer gp${phone ? " is-phone" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 40, near: 0.5, far: 9000, position: [0, 60, 80] }}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      >
        <World model={model} lightRef={lightRef} />
        <Cars model={model} live={live} />
        <Driver model={model} live={live} lightRef={lightRef} />
        {incident ? <IncidentRing x={incident.x} y={incident.y} /> : null}
      </Canvas>
      {snap ? (
        <Labels
          model={model}
          snap={snap}
          mode={mode}
          phone={phone}
          register={registerLabel}
          registerPack={registerPack}
          onFocus={focusCar}
        />
      ) : null}
      {snap && hud && phone ? (
        <PhoneHud
          model={model}
          snap={snap}
          mode={mode}
          gapMode={gapMode}
          sheet={sheet}
          incident={incident}
          results={results}
          backHref={backHref}
          backLabel={backLabel}
          ghostOpen={ghostShown}
          onGhost={() => setGhostOpen(!ghostShown)}
          onSheet={setSheet}
          onFocus={focusCar}
          onGapMode={setGapMode}
          onMode={setMode}
          onToggle={() => live.current.clock.toggle()}
          onSpeed={() => {
            const c = live.current.clock;
            c.speed = cycleSpeed(SPEEDS, c.speed);
          }}
          onSeek={onSeek}
          onMarker={seekMarker}
          onWhy={onWhy}
          onReplay={replayIncident}
          onExitIncident={exitIncident}
        />
      ) : null}
      {snap && hud && !phone ? (
        <>
          <Tower
            model={model}
            snap={snap}
            mode={gapMode}
            onMode={setGapMode}
            onFocus={focusCar}
            onPin={onWhy}
          />
          {incident ? (
            <IncidentMode model={model} snap={snap} incident={incident} onExit={exitIncident} />
          ) : null}
          <TopRight
            model={model}
            snap={snap}
            mode={mode}
            backHref={backHref}
            backLabel={backLabel}
            ghostOpen={ghostShown}
            onGhost={() => setGhostOpen(!ghostShown)}
            onWhy={onWhy}
            incident={incident}
            onReplay={replayIncident}
            onMap={() => setMode("map")}
            onCloseIncident={exitIncident}
          />
          <Focus model={model} snap={snap} />
          {snap.launch ? <Start model={model} snap={snap} /> : null}
          <Transport
            model={model}
            snap={snap}
            mode={mode}
            toggles={{ trails, analysis, classification: classif }}
            activeT={incident?.t ?? null}
            onToggle={() => live.current.clock.toggle()}
            onSeek={onSeek}
            onMarker={seekMarker}
            onSpeed={(dir) => {
              const c = live.current.clock;
              c.speed = stepSpeed(c.speed, dir);
            }}
            onMode={setMode}
            onFlag={onFlag}
          />
        </>
      ) : null}
      {analysis && snap && !phone ? (
        <div className="hud-analysis">
          <Analysis
            model={model}
            focusId={snap.focusId}
            t={snap.t}
            cursorS={cursorS}
            onClose={() => setAnalysis(false)}
          />
        </div>
      ) : null}
      {classif && !phone ? (
        <Classification model={model} results={results} onClose={() => setClassif(false)} />
      ) : null}
      {help ? <Help onClose={() => setHelp(false)} /> : null}
      {fps && snap ? (
        <div className="fps">
          {snap.fpsMs > 0
            ? `${(1000 / snap.fpsMs).toFixed(0)} fps · ${snap.fpsMs.toFixed(1)} ms/frame · loop ${snap.stats.jsMs.toFixed(2)} ms · ${snap.stats.calls} draws · ${(snap.stats.tris / 1000).toFixed(0)}k tris`
            : "…"}
        </div>
      ) : null}
    </div>
  );
}
