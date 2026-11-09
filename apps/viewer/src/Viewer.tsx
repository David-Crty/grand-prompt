import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { Analysis } from "./components/Analysis.js";
import { Classification } from "./components/Classification.js";
import {
  Controls,
  Help,
  type HudSnapshot,
  Labels,
  Messages,
  SessionInfo,
  Telemetry,
  TimingTower,
} from "./components/Hud.js";
import { lapInfoAt, overallBestAt } from "./lib/frames.js";
import { recentMessages } from "./lib/messages.js";
import type { ViewerModel } from "./lib/model.js";
import { CAMERA_MODES, type CameraMode, stepSpeed, type ViewerParams } from "./lib/params.js";
import { PlaybackClock } from "./lib/playback.js";
import { Cars } from "./scene/Cars.js";
import { Driver } from "./scene/Driver.js";
import type { LiveState } from "./scene/live.js";
import { World } from "./scene/World.js";

function shotLabel(live: LiveState, model: ViewerModel): string {
  const s = live.shot;
  if (!s) return "";
  if (live.manualFocus) return "locked on car";
  const row = live.rows.find((r) => r.id === s.primary);
  if (s.reason === "battle" && row) return `battle for P${row.position - 1}`;
  if (s.reason === "leader") return "race leader";
  void model;
  return row && (row.finished || row.out) ? "finish" : "on track";
}

export function Viewer({ model, params }: { model: ViewerModel; params: ViewerParams }) {
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
      manualFocus: params.car !== null && initialFocus === params.car,
      trails: params.trails,
      shot: null,
      rows: [],
      samples: [],
      cars: [],
      labels: [],
      cam: {
        pos: [0, 50, 50],
        look: [0, 0, 0],
        fov: 40,
        heading: 0,
        init: false,
        key: "",
        focusKey: "",
        fromKey: "",
        blendStart: 0,
      },
      wheelSpin: [],
      fps: { frames: 0, acc: 0, avgMs: 0, lastLog: 0, jsAcc: 0, jsMs: 0, calls: 0, tris: 0 },
    };
  }
  const [mode, setModeState] = useState<CameraMode>(live.current.mode);
  const [trails, setTrails] = useState(params.trails);
  const [hud, setHud] = useState(params.hud);
  const [analysis, setAnalysis] = useState(params.analysis);
  const [fps, setFps] = useState(params.fps);
  const [help, setHelp] = useState(false);
  const [interval, setIntervalMode] = useState(false);
  const [classif, setClassif] = useState(false);
  const autoShown = useRef(false);
  const [snap, setSnap] = useState<HudSnapshot | null>(null);

  const setMode = useCallback((m: CameraMode) => {
    live.current.mode = m;
    if (m === "tv") live.current.manualFocus = false;
    setModeState(m);
  }, []);

  const focusCar = useCallback(
    (id: string) => {
      live.current.focusId = id;
      live.current.manualFocus = true;
      void model;
    },
    [model],
  );

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
      const w = Math.max(8, 4 * L.clock.speed);
      setSnap({
        t,
        playing: L.clock.playing,
        speed: L.clock.speed,
        rows: L.rows,
        focusId: L.focusId,
        focus: L.samples[k] ?? null,
        lap: k >= 0 ? lapInfoAt(model.cars[k]!, t) : null,
        fastestId: best?.id ?? null,
        shotLabel: shotLabel(L, model),
        manual: L.manualFocus,
        messages: recentMessages(model.messages, t, w, 3),
        fpsMs: L.fps.avgMs,
        stats: { jsMs: L.fps.jsMs, calls: L.fps.calls, tris: L.fps.tris },
      });
      if (L.clock.atEnd && !autoShown.current) {
        autoShown.current = true;
        setClassif(true);
      }
    };
    const id = window.setInterval(tick, 100);
    tick();
    return () => window.clearInterval(id);
  }, [model]);

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
        case "d":
        case "D":
          L.manualFocus = false;
          setMode("tv");
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
        case "Home":
          c.seek(0);
          break;
        case "End":
          c.seek(c.duration);
          break;
        case "t":
        case "T":
          L.trails = !L.trails;
          setTrails(L.trails);
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
          setIntervalMode((v) => !v);
          break;
        case "?":
          setHelp((v) => !v);
          break;
        case "Escape":
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
  }, [cycleCar, setMode]);

  const registerLabel = useCallback((k: number, el: HTMLDivElement | null) => {
    live.current.labels[k] = el;
  }, []);

  const onSeek = useCallback((t: number) => live.current.clock.seek(t), []);
  const cursorS = useMemo(() => snap?.focus?.s ?? null, [snap]);

  return (
    <div className="viewer">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 40, near: 0.5, far: 9000, position: [0, 60, 80] }}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      >
        <World model={model} lightRef={lightRef} />
        <Cars model={model} live={live} />
        <Driver model={model} live={live} lightRef={lightRef} />
      </Canvas>
      {snap ? <Labels model={model} snap={snap} register={registerLabel} /> : null}
      {snap && hud ? (
        <>
          <TimingTower model={model} snap={snap} showInterval={interval} onFocus={focusCar} />
          <SessionInfo model={model} snap={snap} mode={mode} />
          <Messages snap={snap} />
          <Telemetry model={model} snap={snap} />
          <Controls
            model={model}
            snap={snap}
            mode={mode}
            trails={trails}
            onToggle={() => live.current.clock.toggle()}
            onSeek={onSeek}
            onSpeed={(s) => {
              live.current.clock.speed = s;
            }}
            onMode={setMode}
            onTrails={() => {
              live.current.trails = !live.current.trails;
              setTrails(live.current.trails);
            }}
            onAnalysis={() => setAnalysis((v) => !v)}
            onHelp={() => setHelp((v) => !v)}
          />
        </>
      ) : null}
      {analysis ? <Analysis model={model} cursorS={cursorS} onClose={() => setAnalysis(false)} /> : null}
      {classif ? <Classification model={model} onClose={() => setClassif(false)} /> : null}
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
