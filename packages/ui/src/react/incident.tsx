import type * as React from "react";
import type { Entry } from "../entries.js";
import { Icon } from "./icons.js";
import { EntryName, Stat } from "./primitives.js";

/** How a car went out, shown while its incident plays: the band holds the replay's controls. */
export function IncidentCard({
  title,
  where,
  entry,
  note,
  facts,
  restartLabel,
  onRestart,
  onClose,
  layout = "card",
}: {
  /** "DNF · Crashed". */
  title: string;
  where: string;
  entry: Entry;
  /** A line of detail the sim recorded, such as the driver program's error. */
  note?: string;
  facts: { k: string; v: React.ReactNode }[];
  /** "Replay from 0:34". */
  restartLabel: string;
  onRestart: () => void;
  onClose: () => void;
  /** `sheet`: inside the phone's bottom sheet, without panel chrome. */
  layout?: "card" | "sheet";
}) {
  return (
    <section
      className={`gp-incident${layout === "card" ? " gp-panel gp-panel--solid" : " gp-incident--sheet"}`}
      aria-label="Incident"
    >
      <div className="gp-incident__band">
        <span className="gp-x">{title}</span>
        <span className="gp-incident__sep">·</span>
        <span className="gp-c gp-incident__where">{where}</span>
        <span className="gp-flex" />
        <button
          type="button"
          className="gp-incident__icon"
          aria-label={restartLabel}
          title={restartLabel}
          onClick={onRestart}
        >
          <Icon name="back5" />
        </button>
        <button
          type="button"
          className="gp-incident__icon"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Icon name="cross" />
        </button>
      </div>
      <div className="gp-incident__body">
        <EntryName entry={entry} meta />
        {note ? <p className="gp-incident__what">{note}</p> : null}
        <div className="gp-incident__facts">
          {facts.map((f, k) => (
            <Stat key={String(k)} k={f.k} v={f.v} />
          ))}
        </div>
      </div>
    </section>
  );
}
