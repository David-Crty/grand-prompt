import type * as React from "react";
import { type Entry, entryVar, PROVIDER_LABEL } from "../entries.js";
import { Icon, type IconName, LogoMark } from "./icons.js";

/** Inline style carrying the entry colour as `--entry`, which every `gp-` entry rule reads. */
export function entryStyle(e: Pick<Entry, "slot"> | null | undefined, extra?: React.CSSProperties) {
  return { "--entry": entryVar(e), ...extra } as React.CSSProperties;
}

/** Class names, skipping the falsy ones. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Wordmark() {
  return (
    <span className="gp-wordmark gp-wordmark--s">
      <LogoMark />
      Grand Prompt
    </span>
  );
}

export function EntryChip({ entry, out = false }: { entry: Entry; out?: boolean }) {
  return (
    <span className={cx("gp-chip", out && "gp-chip--out")} style={entryStyle(entry)} title={entry.name}>
      {entry.code}
    </span>
  );
}

/** Chip plus name, with the provider and its body paint underneath when `meta` is set. */
export function EntryName({ entry, meta = false }: { entry: Entry; meta?: boolean }) {
  return (
    <span className="gp-entry">
      <EntryChip entry={entry} />
      <span className="gp-entry__text">
        <span className="gp-entry__name">{entry.name}</span>
        {meta ? (
          <span className="gp-entry__meta">
            <span className="gp-body-swatch" style={{ background: entry.body }} />
            {PROVIDER_LABEL[entry.provider]}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export type BadgeKind = "dnf" | "warn" | "fin" | "ghost" | "trial" | "est" | "outline";

export function StatusBadge({
  kind,
  children,
  icon,
}: {
  kind: BadgeKind;
  children?: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <span className={`gp-badge gp-badge--${kind}`}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

/** The position, highlighted for P1; a dash when out or unplaced. */
export function PositionBox({ position, out = false }: { position: number | null; out?: boolean }) {
  return (
    <span className={cx("gp-pos", position === 1 && !out && "gp-pos--lead", out && "gp-pos--out")}>
      {out || position === null ? "–" : position}
    </span>
  );
}

export function Chequer() {
  return <span className="gp-chequer" role="img" aria-label="Finished" />;
}

export function Stat({
  k,
  v,
  fastest = false,
}: {
  k: React.ReactNode;
  v: React.ReactNode;
  fastest?: boolean;
}) {
  return (
    <div>
      <div className="gp-stat__k">{k}</div>
      <div className={cx("gp-stat__v", fastest && "is-fastest")}>{v}</div>
    </div>
  );
}

export function Button({
  variant = "secondary",
  size = "m",
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "m" | "touch";
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      className={cx("gp-btn", `gp-btn--${variant}`, size === "touch" && "gp-btn--touch", className)}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  variant = "plain",
  size = "m",
  iconSize = 16,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  variant?: "plain" | "primary";
  size?: "m" | "touch";
  iconSize?: 16 | 20;
}) {
  return (
    <button
      type="button"
      className={cx(
        "gp-iconbtn",
        variant === "primary" && "gp-iconbtn--primary",
        size === "touch" && "gp-iconbtn--touch",
        className,
      )}
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  ariaLabel?: string;
  title?: string;
}

/** One-of-n buttons; the pressed one is drawn in chalk. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "m",
  label,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  size?: "m" | "touch";
  label?: string;
}) {
  return (
    <fieldset className={cx("gp-seg", size === "touch" && "gp-seg--touch")} aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={o.value === value}
          aria-label={o.ariaLabel}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
