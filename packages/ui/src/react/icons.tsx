import {
  Car,
  ChartLine,
  Check,
  ChevronLeft,
  ChevronUp,
  CircleHelp,
  Flag,
  Gauge,
  Info,
  ListOrdered,
  type LucideIcon,
  Map as MapIcon,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipBack,
  Spline,
  Timer,
  TriangleAlert,
  Tv,
  Video,
  X,
} from "lucide-react";
import type * as React from "react";
import type { CameraMode } from "../cameras.js";
import type { MarkerKind } from "../timeline.js";

/** The UI's stroke icons, from lucide, by the name the components use; decorative: the control carries the label. */
export type IconName =
  | "play"
  | "pause"
  | "back5"
  | "cross"
  | "warn"
  | "stopwatch"
  | "flag"
  | "info"
  | "back"
  | "trail"
  | "chart"
  | "list"
  | "help"
  | "minus"
  | "plus"
  | "restart"
  | "camera"
  | "tv"
  | "chase"
  | "onboard"
  | "map"
  | "check"
  | "up";

const ICONS: Record<IconName, LucideIcon> = {
  play: Play,
  pause: Pause,
  back5: RotateCcw,
  cross: X,
  warn: TriangleAlert,
  stopwatch: Timer,
  flag: Flag,
  info: Info,
  back: ChevronLeft,
  trail: Spline,
  chart: ChartLine,
  list: ListOrdered,
  help: CircleHelp,
  minus: Minus,
  plus: Plus,
  restart: SkipBack,
  camera: Video,
  tv: Tv,
  chase: Car,
  onboard: Gauge,
  map: MapIcon,
  check: Check,
  up: ChevronUp,
};

export const CAMERA_ICON: Record<CameraMode, IconName> = {
  tv: "tv",
  chase: "chase",
  onboard: "onboard",
  map: "map",
};

/** Drawn filled, as transport controls usually are. */
const SOLID: ReadonlySet<IconName> = new Set(["play", "pause"]);

export function Icon({ name, size = 16 }: { name: IconName; size?: 16 | 20 }) {
  const I = ICONS[name];
  const cls = ["gp-icon", size === 20 && "gp-icon--l", SOLID.has(name) && "gp-icon--solid"].filter(Boolean);
  return <I aria-hidden="true" className={cls.join(" ")} />;
}

const MARKS: Record<MarkerKind, React.ReactNode> = {
  dnf: (
    <>
      <rect x="1" y="1" width="10" height="10" rx="1.5" />
      <path d="M3.8 3.8l4.4 4.4M8.2 3.8 3.8 8.2" stroke="var(--on-chalk)" strokeWidth="1.6" />
    </>
  ),
  warn: (
    <>
      <path d="M6 1 11.5 10.6H.5z" />
    </>
  ),
  fastest: (
    <>
      <path d="M6 .8 11.2 6 6 11.2.8 6z" />
    </>
  ),
  finish: (
    <>
      <path d="M1 1h5v5H1zM6 6h5v5H6z" />
      <path d="M6 1h5v5H6zM1 6h5v5H1z" fillOpacity=".25" />
    </>
  ),
  start: (
    <>
      <path d="M1.5 1h1.4v10H1.5z" />
      <path d="M2.9 1.5h7.6l-2 2.5 2 2.5H2.9z" />
    </>
  ),
};

/** 12 px filled glyphs for timeline markers; coloured by the `gp-mark--*` class. */
export function MarkerIcon({ kind }: { kind: MarkerKind }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {MARKS[kind]}
    </svg>
  );
}

/** The Grand Prompt mark: a chevron prompt and a cursor. */
export function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1.6 4h5.4l7 8-7 8H1.6l7-8z" />
      <rect x="15" y="17.2" width="8" height="2.8" />
    </svg>
  );
}
