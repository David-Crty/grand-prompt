import { type GapMode, stepMarker, type TimelineMarker } from "@bench/ui";
import { Dropdown, type TransportFlag } from "@bench/ui/react";
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
  TopRight,
  Tower,
  Transport,
  TvRig,
} from "./components/Hud.js";
import { INCIDENT_SHEET_PX, PhoneHud, type PhoneSheet } from "./components/PhoneHud.js";
import { clampTilt, clampZoom, stepZoom, TV_TILT } from "./lib/camera.js";
import { cycleSpeed, pinchFactor, swipeDir } from "./lib/gestures.js";
import { crossedLine, defaultFocus, fastestId, finishers, focusAfter, justOut } from "./lib/hud.js";
import type { Incident } from "./lib/incidents.js";
import { visibleToasts } from "./lib/messages.js";
import type { ViewerModel } from "./lib/model.js";
import {
  CAMERA_MODES,
  type CameraMode,
  type CameraView,
  SPEEDS,
  stepSpeed,
  type ViewerParams,
} from "./lib/params.js";
import { PlaybackClock } from "./lib/playback.js";
import type { EventResults } from "./lib/results.js";
import { MARKER_LEAD, markerFocus } from "./lib/timeline.js";
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
  resultsHref,
  results = null,
  events,
}: {
  model: ViewerModel;
  params: ViewerParams;
  backHref?: string;
  backLabel?: string;
  /** The race's results page. */
  resultsHref?: string;
  /** The event's results and build manifests, when published next to the replay. */
  results?: EventResults | null;
  /** The events that raced on this circuit; picking another hands over the camera the viewer is in. */
  events?: { list: string[]; current: string; onChange: (event: string, view: CameraView) => void };
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const initialFocus =
    params.car && model.cars.some((c) => c.car.id === params.car)
      ? params.car
      : defaultFocus(model.cars, model.duration);
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
      tvTilt: clampTilt(params.tilt ?? TV_TILT),
      rows: [],
      samples: [],
      cars: [],
      labels: [],
      labelPack: null,
      packHold: null,
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
        wait: {},
      },
      wheelSpin: [],
      fps: { frames: 0, acc: 0, avgMs: 0, lastLog: 0, jsAcc: 0, jsMs: 0, calls: 0, tris: 0 },
    };
  }
  const [mode, setModeState] = useState<CameraMode>(live.current.mode);
  const [trails, setTrails] = useState(params.trails);
  const [rig, setRig] = useState({ zoom: live.current.tvZoom, tilt: live.current.tvTilt });
  const setZoom = useCallback((z: number) => {
    live.current.tvZoom = clampZoom(z);
    setRig((r) => ({ ...r, zoom: live.current.tvZoom }));
  }, []);
  const setTilt = useCallback((deg: number) => {
    live.current.tvTilt = clampTilt(deg);
    setRig((r) => ({ ...r, tilt: live.current.tvTilt }));
  }, []);
  const [hud, setHud] = useState(params.hud);
  const [analysis, setAnalysis] = useState(params.analysis);
  const [fps, setFps] = useState(params.fps);
  const [help, setHelp] = useState(false);
  const [gapMode, setGapMode] = useState<GapMode>("gap");
  const [classif, setClassif] = useState(false);
  // Incident replay: the card, the banner, slow motion and the ring on the ground, until Exit.
  const [incident, setIncident] = useState<Incident | null>(null);
  const phone = usePhone();
  const [sheet, setSheet] = useState<PhoneSheet | null>(null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  live.current.insetBottom = phone && sheet === "incident" ? INCIDENT_SHEET_PX : null;
  const autoShown = useRef(false);
  const played = useRef({ t: live.current.clock.t, seeks: live.current.clock.seeks });
  const [snap, setSnap] = useState<HudSnapshot | null>(null);

  const picker = (phoneSize: boolean) =>
    events && events.list.length > 1 ? (
      <Dropdown
        options={events.list.map((e) => ({ value: e, label: e }))}
        value={events.current}
        onChange={(e) => {
          if (e === events.current) return;
          const L = live.current;
          events.onChange(e, { cam: L.mode, zoom: L.tvZoom, tilt: L.tvTilt });
        }}
        label="Event"
        icon={phoneSize ? undefined : "flag"}
        size={phoneSize ? "touch" : "m"}
      />
    ) : null;

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
    const order = finishers(model.cars);
    const reveal = new Set([order[0], order.at(-1)]);
    const showResult = () => {
      if (phoneRef.current) setSheet("result");
      else setClassif(true);
    };
    const tick = () => {
      const L = live.current;
      const t = L.clock.t;
      const from = played.current;
      played.current = { t, seeks: L.clock.seeks };
      if (from.seeks === L.clock.seeks && t > from.t) {
        L.focusId = focusAfter(model.cars, L.focusId, from.t, t);
        if (crossedLine(model.cars, from.t, t).some((id) => reveal.has(id))) showResult();
      }
      const k = model.cars.findIndex((c) => c.car.id === L.focusId);
      setSnap({
        t,
        playing: L.clock.playing,
        speed: L.clock.speed,
        rows: L.rows,
        focusId: L.focusId,
        focus: L.samples[k] ?? null,
        samples: [...L.samples],
        fastestId: fastestId(L.rows),
        toasts: visibleToasts(model.messages, t, L.clock.speed, 3),
        justOut: justOut(model.cars, t),
        pack: L.labelPack,
        fpsMs: L.fps.avgMs,
        stats: { jsMs: L.fps.jsMs, calls: L.fps.calls, tris: L.fps.tris },
      });
      if (!order.length && L.clock.atEnd && !autoShown.current) {
        autoShown.current = true;
        showResult();
      }
    };
    const id = window.setInterval(tick, 66);
    tick();
    return () => window.clearInterval(id);
  }, [model]);

  const seekMarker = useCallback(
    (m: TimelineMarker) => {
      const id = markerFocus(m);
      if (id) focusCar(id);
      live.current.clock.seek(Math.max(0, m.t - MARKER_LEAD));
    },
    [focusCar],
  );

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
      if (
        e.target instanceof HTMLElement &&
        e.target.closest(".gp-range") &&
        /^(Arrow|Home|End|Page)/.test(e.key)
      )
        return;
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

  const onSeek = useCallback((t: number) => live.current.clock.seek(t), []);
  const watch = useCallback((t: number) => {
    const c = live.current.clock;
    c.seek(t);
    c.playing = true;
  }, []);
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
  const clickMarker = useCallback(
    (m: TimelineMarker) => {
      const id = markerFocus(m);
      if (id && model.incidents.some((i) => i.carId === id)) onWhy(id);
      else seekMarker(m);
    },
    [model, onWhy, seekMarker],
  );
  const restart = useCallback(() => {
    const L = live.current;
    setIncident(null);
    setClassif(false);
    setSheet(null);
    L.focusId = initialFocus;
    L.clock.speed = 1;
    L.clock.seek(0);
    L.clock.playing = true;
  }, [initialFocus]);
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
          resultsHref={resultsHref}
          picker={picker(true)}
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
          onWatch={watch}
          onMarker={clickMarker}
          onWhy={onWhy}
          onReplay={replayIncident}
          onExitIncident={exitIncident}
          onRestart={restart}
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
            backHref={backHref}
            backLabel={backLabel}
            resultsHref={resultsHref}
            picker={picker(false)}
          />
          {incident ? (
            <IncidentMode
              model={model}
              snap={snap}
              incident={incident}
              onReplay={replayIncident}
              onClose={exitIncident}
            />
          ) : null}
          <TopRight model={model} snap={snap} onWhy={onWhy} incident={incident} />
          <Focus model={model} snap={snap} />
          {mode === "tv" ? <TvRig zoom={rig.zoom} tilt={rig.tilt} onZoom={setZoom} onTilt={setTilt} /> : null}
          <Transport
            model={model}
            snap={snap}
            mode={mode}
            toggles={{ trails, analysis, classification: classif }}
            activeT={incident?.t ?? null}
            onToggle={() => live.current.clock.toggle()}
            onSeek={onSeek}
            onMarker={clickMarker}
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
            cursorS={cursorS}
            onClose={() => setAnalysis(false)}
            onFocus={focusCar}
            onWatch={(t) => {
              watch(t);
              setAnalysis(false);
            }}
          />
        </div>
      ) : null}
      {classif && !phone ? (
        <Classification
          model={model}
          results={results}
          onClose={() => setClassif(false)}
          onRestart={restart}
          onAnalysis={() => {
            setClassif(false);
            setAnalysis(true);
          }}
          backHref={backHref}
          resultsHref={resultsHref}
        />
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
