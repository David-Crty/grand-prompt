import * as React from "react";
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

/**
 * Calls `close` on a pointer down outside `ref` or on Escape while `open`. Escape goes no further, so it does not
 * also close the panel around it.
 */
function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ref, open, close]);
}

/** A "?" button that opens a short explanation under it; a click outside or Escape closes it. */
export function Popover({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  return (
    <span className="gp-pop" ref={ref}>
      <button
        type="button"
        className="gp-pop__btn"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="help" />
      </button>
      {open ? (
        <span className="gp-pop__body gp-panel gp-panel--solid" role="dialog" aria-label={label}>
          {children}
        </span>
      ) : null}
    </span>
  );
}

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/**
 * One-of-n behind a button showing `icon` and the current choice; the list opens above it (`up`, for a dock at the
 * bottom of the screen) or below. A click outside or Escape closes it, arrows move between the choices.
 */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  label,
  icon,
  size = "m",
  placement = "down",
}: {
  options: DropdownOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  icon?: IconName;
  size?: "m" | "touch";
  placement?: "up" | "down";
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const btn = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  React.useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  const current = options.find((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const k = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(k + step + items.length) % items.length]?.focus();
  };
  return (
    <div
      className={cx("gp-dd", size === "touch" && "gp-dd--touch", placement === "up" && "gp-dd--up")}
      ref={ref}
    >
      <button
        type="button"
        ref={btn}
        className="gp-dd__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ? <Icon name={icon} size={size === "touch" ? 20 : 16} /> : null}
        <span className="gp-dd__value">{current?.label}</span>
        <span className="gp-dd__caret">
          <Icon name="up" />
        </span>
      </button>
      {open ? (
        <div
          className="gp-dd__list gp-panel gp-panel--solid"
          role="menu"
          aria-label={label}
          ref={list}
          onKeyDown={onKey}
        >
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              role="menuitemradio"
              aria-checked={o.value === value}
              className="gp-dd__item"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                btn.current?.focus();
              }}
            >
              {o.icon ? <Icon name={o.icon} /> : null}
              <span className="gp-dd__label">{o.label}</span>
              {o.value === value ? <Icon name="check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
