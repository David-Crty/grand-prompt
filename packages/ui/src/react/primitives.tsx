import type * as React from "react";
import { type Entry, entryVar, PROVIDER_LABEL } from "../entries.js";
import { Icon, type IconName, LogoMark } from "./icons.js";

/** Inline style carrying the entry colour as `--entry`, which every `gp-` entry rule reads. */
export function entryStyle(e: Pick<Entry, "slot"> | null | undefined, extra?: React.CSSProperties) {
  return { "--entry": entryVar(e), ...extra } as React.CSSProperties;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Wordmark({ size = "s" }: { size?: "s" | "m" | "l" }) {
  return (
    <span className={`gp-wordmark gp-wordmark--${size}`}>
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

export type BadgeKind = "dnf" | "warn" | "fin" | "fastest" | "ghost" | "trial" | "est" | "outline";

export function StatusBadge({
  kind,
  children,
  icon,
  size = "s",
}: {
  kind: BadgeKind;
  children?: React.ReactNode;
  icon?: IconName;
  size?: "s" | "l";
}) {
  return (
    <span className={cx("gp-badge", `gp-badge--${kind}`, size === "l" && "gp-badge--l")}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

export function PositionBox({
  position,
  leader = false,
  out = false,
}: {
  position: number | null;
  leader?: boolean;
  out?: boolean;
}) {
  return (
    <span className={cx("gp-pos", leader && !out && "gp-pos--lead", out && "gp-pos--out")}>
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
  block = false,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "m" | "touch";
  icon?: IconName;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "gp-btn",
        `gp-btn--${variant}`,
        size === "touch" && "gp-btn--touch",
        block && "gp-btn--block",
        className,
      )}
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
