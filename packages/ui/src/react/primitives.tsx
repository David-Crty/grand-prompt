import * as React from "react";
import { createPortal } from "react-dom";
import { type Entry, entryVar } from "../entries.js";
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
      LLM Racing
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

/** A round mark in the entry colour, for a list that names entries without their chips. */
export function EntryDot({ entry }: { entry: Pick<Entry, "slot"> | null | undefined }) {
  return <span className="gp-dot" style={entryStyle(entry)} aria-hidden="true" />;
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
            {entry.providerLabel}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export type BadgeKind = "dnf" | "warn" | "fin" | "ghost" | "trial" | "outline";

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

/** A quiet link to the project's repository, asking for a star; narrow layouts can hide `.gp-star__more`. */
export function StarLink({ href, className }: { href: string; className?: string }) {
  return (
    <a
      className={cx("gp-btn gp-btn--ghost gp-star", className)}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Star the project on GitHub"
    >
      <Icon name="star" />
      <span>
        Star<span className="gp-star__more"> on GitHub</span>
      </span>
    </a>
  );
}

/** A small link to a file's source, opening in a new tab: its icon and the file name in mono. */
export function SourceLink({ href, file, label }: { href: string; file: string; label: string }) {
  return (
    <a
      className="gp-btn gp-btn--ghost gp-btn--s gp-source"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      <Icon name="code" />
      <span className="gp-source__file">{file}</span>
    </a>
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
function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
  also?: React.RefObject<HTMLElement | null>,
) {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !also?.current?.contains(t)) close();
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
  }, [ref, open, close, also]);
}

const POP_GAP = 6;
const POP_MARGIN = 8;

/** Where a popover goes: centred under its trigger, above it when there is no room below, inside the viewport. */
function popoverPosition(trigger: DOMRect, body: { width: number; height: number }) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const centred = trigger.left + trigger.width / 2 - body.width / 2;
  const left = Math.max(POP_MARGIN, Math.min(centred, vw - body.width - POP_MARGIN));
  const below = trigger.bottom + POP_GAP;
  const top = below + body.height > vh - POP_MARGIN ? trigger.top - POP_GAP - body.height : below;
  return { left, top: Math.max(POP_MARGIN, top) };
}

/**
 * A short explanation that opens under its trigger, a "?" unless `trigger` is given. A click pins it open until a
 * click outside or Escape; with `hover` it also shows while the pointer is over the trigger or it has focus. It is
 * drawn over the page, so a scrolling table does not clip it.
 */
export function Popover({
  label,
  children,
  trigger,
  hover = false,
  passive = false,
  className,
  style,
}: {
  label: string;
  children: React.ReactNode;
  trigger?: React.ReactNode;
  hover?: boolean;
  /** Hover only, with no button: for a trigger inside a link, where a click must still follow it. */
  passive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [pinned, setPinned] = React.useState(false);
  const [peek, setPeek] = React.useState(false);
  const open = pinned || peek;
  const ref = React.useRef<HTMLSpanElement>(null);
  const bodyRef = React.useRef<HTMLSpanElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const id = React.useId();
  const close = React.useCallback(() => {
    setPinned(false);
    setPeek(false);
  }, []);
  useDismiss(ref, open, close, bodyRef);
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const t = ref.current;
      const b = bodyRef.current;
      if (t && b) setPos(popoverPosition(t.getBoundingClientRect(), b.getBoundingClientRect()));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  const onMouse = (show: boolean) => (e: React.PointerEvent) => {
    if ((hover || passive) && e.pointerType === "mouse") setPeek(show);
  };
  return (
    <span
      className={cx("gp-pop", className)}
      style={style}
      ref={ref}
      onPointerEnter={onMouse(true)}
      onPointerLeave={onMouse(false)}
    >
      {passive ? (
        trigger
      ) : (
        <button
          type="button"
          className={cx("gp-pop__btn", trigger != null && "gp-pop__btn--text")}
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          title={hover ? undefined : label}
          onClick={() => setPinned((v) => !v)}
          onFocus={hover ? () => setPeek(true) : undefined}
          onBlur={hover ? () => setPeek(false) : undefined}
        >
          {trigger ?? <Icon name="help" />}
        </button>
      )}
      {open
        ? createPortal(
            <span
              ref={bodyRef}
              id={id}
              className="gp gp-pop__body gp-panel gp-panel--solid"
              {...(passive ? { role: "tooltip" } : { role: "dialog", "aria-label": label })}
              style={pos ?? { visibility: "hidden" }}
            >
              {children}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** Drawn in place of an icon, in the list and on the button when this option is the current one. */
  lead?: React.ReactNode;
  /** Secondary text at the end of the option's row in the list. */
  detail?: string;
}

/**
 * One-of-n behind a button showing `icon` (or the current choice's `lead`) and the current choice; the list opens
 * above it (`up`, for a dock at the bottom of the screen) or below. A click outside or Escape closes it, arrows
 * move between the choices; it lines up with the button's right edge, or its left with `align="start"`. `caps`
 * sets the labels as the segmented control does.
 */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  label,
  icon,
  size = "m",
  placement = "down",
  align = "end",
  caps = false,
}: {
  options: DropdownOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  icon?: IconName;
  size?: "m" | "touch";
  placement?: "up" | "down";
  align?: "start" | "end";
  caps?: boolean;
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
      className={cx(
        "gp-dd",
        size === "touch" && "gp-dd--touch",
        placement === "up" && "gp-dd--up",
        align === "start" && "gp-dd--start",
        caps && "gp-dd--caps",
      )}
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
        {icon ? <Icon name={icon} size={size === "touch" ? 20 : 16} /> : current?.lead}
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
              {o.icon ? <Icon name={o.icon} /> : o.lead}
              <span className="gp-dd__label">{o.label}</span>
              {o.detail ? <span className="gp-dd__detail">{o.detail}</span> : null}
              <span className="gp-dd__check">{o.value === value ? <Icon name="check" /> : null}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
