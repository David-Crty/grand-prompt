import type * as React from "react";
import type { MarkerKind } from "../timeline.js";

/** The 16 px stroke icon set, decorative: the control around it carries the label. */
export type IconName =
  | "play"
  | "pause"
  | "back5"
  | "cross"
  | "warn"
  | "stopwatch"
  | "flag"
  | "map"
  | "share"
  | "info"
  | "back"
  | "trail"
  | "chart"
  | "ghost"
  | "list"
  | "help";

const ICONS: Record<IconName, React.ReactNode> = {
  play: (
    <>
      <path fill="currentColor" stroke="none" d="M5 3.2v9.6L12.8 8z" />
    </>
  ),
  pause: (
    <>
      <path fill="currentColor" stroke="none" d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z" />
    </>
  ),
  back5: (
    <>
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M3 2.5v2.8h2.8" />
    </>
  ),
  cross: (
    <>
      <path d="M4 4l8 8M12 4l-8 8" />
    </>
  ),
  warn: (
    <>
      <path d="M8 2.2 14.2 13.5H1.8z" />
      <path d="M8 6.4v3.3M8 11.5v.1" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="8" cy="9" r="5" />
      <path d="M8 9V6.2M6.4 2.2h3.2M12.2 4.6l.9-.9" />
    </>
  ),
  flag: (
    <>
      <path d="M3.5 14.2V2.4" />
      <path d="M3.5 2.8h8.8l-1.8 3.1 1.8 3.1H3.5" />
    </>
  ),
  map: (
    <>
      <path d="M2.4 4.2 6 2.6l4 1.6 3.6-1.6v9.2L10 13.4 6 11.8l-3.6 1.6z" />
      <path d="M6 2.6v9.2M10 4.2v9.2" />
    </>
  ),
  share: (
    <>
      <path d="M8 10.2V2.4M5.2 5.2 8 2.4l2.8 2.8" />
      <path d="M3.4 8.6v4.8h9.2V8.6" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7.2v4M8 4.9v.1" />
    </>
  ),
  back: (
    <>
      <path d="M10 3.4 5.4 8l4.6 4.6" />
    </>
  ),
  trail: (
    <>
      <path d="M2 12.5c2.6-.4 3.6-3.4 5.4-6.2C8.9 4 10.5 3.4 14 3.6" />
      <circle cx="13.6" cy="3.6" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  chart: (
    <>
      <path d="M2.4 13.6h11.2" />
      <path d="M3.6 10.8 6.6 7l2.6 2.4 4-5.6" />
    </>
  ),
  ghost: (
    <>
      <rect x="2.4" y="5.6" width="7.4" height="7.4" rx="1" />
      <path d="M6.2 3.4h6.4a1 1 0 0 1 1 1v6.4" strokeDasharray="1.6 1.6" />
    </>
  ),
  list: (
    <>
      <path d="M5.6 4h8M5.6 8h8M5.6 12h8" />
      <path d="M2.4 4h.1M2.4 8h.1M2.4 12h.1" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.8.7-.8 1.3v.3M8 11.5v.1" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: 16 | 20 }) {
  return (
    <svg className={size === 20 ? "gp-icon gp-icon--l" : "gp-icon"} viewBox="0 0 16 16" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
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
