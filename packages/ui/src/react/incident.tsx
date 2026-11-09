import type * as React from "react";
import { incidentTrace, type TraceInput } from "../charts.js";
import type { Entry } from "../entries.js";
import { entryVar } from "../entries.js";
import { Icon } from "./icons.js";
import { Button, EntryName, Stat, StatusBadge } from "./primitives.js";

/** Speed line over a throttle strip, with the moments the car spun marked. */
export function IncidentTrace({
  window,
  marks,
  entry,
  width = 356,
  height = 72,
}: {
  window: TraceInput;
  marks: { t: number; label: string }[];
  entry: Entry;
  width?: number;
  height?: number;
}) {
  const g = incidentTrace(window, width, height, marks);
  return (
    <svg
      className="gp-trace"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Speed and throttle before the incident"
    >
      <line x1={0} x2={width} y1={g.y100} y2={g.y100} className="gp-trace__grid" />
      <text x={2} y={g.y100 - 3} className="gp-trace__axis">
        100 km/h
      </text>
      <path d={g.speed} className="gp-trace__speed" style={{ stroke: entryVar(entry) }} />
      {g.throttle.map((c) => (
        <rect
          key={c.x}
          x={c.x}
          y={height - 12}
          width={c.w}
          height={8}
          className="gp-trace__thr"
          fillOpacity={c.opacity}
        />
      ))}
      <text x={width} y={height - 16} textAnchor="end" className="gp-trace__axis">
        THR
      </text>
      {g.marks.map((m) => (
        <g key={`${m.x}-${m.label}`}>
          <line x1={m.x} x2={m.x} y1={0} y2={height - 14} className="gp-trace__mark" />
          <text
            x={m.anchor === "end" ? m.x - 4 : m.x + 4}
            y={10}
            textAnchor={m.anchor}
            className="gp-trace__marklabel"
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function IncidentCard({
  title,
  where,
  entry,
  sentence,
  trace,
  facts,
  actions,
  layout = "card",
  onClose,
}: {
  /** "DNF · Crashed". */
  title: string;
  where: string;
  entry: Entry;
  sentence: string;
  trace?: React.ReactNode;
  facts: { k: string; v: React.ReactNode }[];
  actions?: React.ReactNode;
  /** `sheet`: inside the phone's bottom sheet, without panel chrome. */
  layout?: "card" | "sheet";
  onClose?: () => void;
}) {
  return (
    <section
      className={`gp-incident${layout === "card" ? " gp-panel gp-panel--solid" : " gp-incident--sheet"}`}
      aria-label="Incident"
    >
      <div className="gp-incident__band">
        <Icon name="cross" />
        <span className="gp-x">{title}</span>
        <span className="gp-flex" />
        <span className="gp-c gp-incident__where">{where}</span>
        {onClose ? (
          <button type="button" className="gp-incident__close" aria-label="Close" onClick={onClose}>
            <Icon name="cross" />
          </button>
        ) : null}
      </div>
      <div className="gp-incident__body">
        <EntryName entry={entry} meta />
        <p className="gp-incident__what">{sentence}</p>
        {trace}
        <div className="gp-incident__facts">
          {facts.map((f) => (
            <Stat key={f.k} k={f.k} v={f.v} />
          ))}
        </div>
        {actions ? <div className="gp-incident__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

/** Top-centre banner while an incident plays in slow motion. */
export function IncidentBanner({ text, onExit }: { text: string; onExit: () => void }) {
  return (
    <div className="gp-panel gp-panel--solid gp-ibanner">
      <StatusBadge kind="dnf">Incident replay</StatusBadge>
      <span className="gp-ibanner__text">{text}</span>
      <Button variant="ghost" className="gp-ibanner__exit" onClick={onExit}>
        Exit
      </Button>
    </div>
  );
}
