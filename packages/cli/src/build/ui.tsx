import { fmtTime } from "@bench/sim";
import { Box, Static, Text, type TextProps, useInput, useStdin, useWindowSize } from "ink";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { clock, tokens } from "./lib.js";
import type { ModelView, Store } from "./run.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR = 12;

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Icon({ m, frame }: { m: ModelView; frame: number }) {
  if (m.state === "running" || m.state === "workspace" || m.state === "collecting")
    return <Text color="cyan">{SPINNER[frame % SPINNER.length]}</Text>;
  if (m.state === "done") return <Text color={m.outcome === "ok" ? "green" : "yellow"}>✔</Text>;
  if (m.state === "queued") return <Text dimColor>·</Text>;
  return <Text color="red">✘</Text>;
}

function stateText(m: ModelView): { text: string; color?: string } {
  if (m.state === "done")
    return m.outcome === "ok" ? { text: "done", color: "green" } : { text: m.outcome!, color: "yellow" };
  if (m.state === "running") return { text: "running", color: "cyan" };
  if (m.state === "no driver" || m.state === "failed") return { text: m.state, color: "red" };
  return { text: m.state };
}

function TimeBar({ m, now, limitS, bar }: { m: ModelView; now: number; limitS: number; bar: boolean }) {
  const elapsed = m.startedAt ? ((m.endedAt ?? now) - m.startedAt) / 1000 : null;
  const time = (elapsed === null ? "" : clock(elapsed)).padStart(5);
  if (!bar) return <Text>{time}</Text>;
  const filled = elapsed === null ? 0 : Math.min(BAR, Math.round((elapsed / limitS) * BAR));
  const late = elapsed !== null && elapsed / limitS > 0.8 && !m.endedAt;
  return (
    <Text>
      <Text color={m.endedAt ? "gray" : late ? "yellow" : "cyan"}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(BAR - filled)}</Text> {time}
    </Text>
  );
}

function Runs({ m, width }: { m: ModelView; width: number }) {
  const budget = m.budget ?? m.runs.length;
  if (budget > width) return <Text>{`${m.runs.length}/${budget}`.padEnd(width)}</Text>;
  return (
    <Text>
      {m.runs.map((r) => (
        <Text key={r.dir} color={r.clean ? "green" : "red"}>
          {r.clean ? "●" : "✕"}
        </Text>
      ))}
      <Text dimColor>{"○".repeat(Math.max(0, budget - m.runs.length))}</Text>
      {" ".repeat(Math.max(0, width - budget))}
    </Text>
  );
}

/** One terminal line that never wraps: a wrapped line would leave a stale copy on each redraw. */
function Line({ width, children, ...props }: { width: number; children: ReactNode } & TextProps) {
  return (
    <Box width={width}>
      <Text wrap="truncate-end" {...props}>
        {children}
      </Text>
    </Box>
  );
}

function lastRun(m: ModelView): string {
  const r = m.runs[m.runs.length - 1];
  if (!r) return "";
  return `${r.track.slice(0, 11)} ${r.clean && r.lapTime !== null ? fmtTime(r.lapTime) : r.status.toLowerCase()}`;
}

function detail(m: ModelView): string {
  if (m.state === "done") {
    const u = m.usage;
    const parts = [`${tokens(u?.inputTokens ?? null)} in`, `${tokens(u?.outputTokens ?? null)} out`];
    if (u?.costUsd != null) parts.push(`$${u.costUsd.toFixed(2)}`);
    if (m.source !== "driver.js") parts.push(`driver from ${m.source}`);
    return parts.join(" · ");
  }
  return m.activity;
}

export interface Header {
  name: string;
  practice: string[];
  eventTrack: string;
  timeout: number;
  jobs: number;
  effort: string;
}

export function App({ store, header, onAbort }: { store: Store; header: Header; onAbort: () => void }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const now = useNow(250);
  const frame = Math.floor(now / 100);
  const { columns } = useWindowSize();
  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (input === "c" && key.ctrl) onAbort();
    },
    { isActive: isRawModeSupported === true },
  );

  const width = Math.max(30, columns - 1);
  const slugW = Math.min(24, Math.max(5, ...store.models.map((m) => m.entry.slug.length)));
  const runsW = Math.min(20, Math.max(4, ...store.models.map((m) => m.budget ?? 0)));
  const stateW = 10;
  const LAST = 20;
  // Columns give way to the activity on narrow terminals: tools first, then the bar, then the last run.
  let tools = true;
  let bar = true;
  let last = true;
  const need = () =>
    2 +
    slugW +
    2 +
    stateW +
    2 +
    (bar ? BAR + 1 : 0) +
    5 +
    2 +
    runsW +
    2 +
    (last ? LAST + 2 : 0) +
    (tools ? 7 : 0) +
    24;
  if (need() > width) tools = false;
  if (need() > width) bar = false;
  if (need() > width) last = false;
  const done = store.models.filter((m) => m.endedAt).length;
  const gap = "  ";

  return (
    <>
      <Static items={store.log}>
        {(l) => (
          <Text key={l.id}>
            <Text dimColor>[{l.time}]</Text> {l.text}
          </Text>
        )}
      </Static>
      <Box flexDirection="column" marginTop={1}>
        <Line width={width}>
          <Text bold>build {header.name}</Text>
          <Text dimColor>
            {gap}practice {header.practice.join(", ")} · event {header.eventTrack} · effort {header.effort} ·{" "}
            {header.timeout} min each · {header.jobs} at a time
          </Text>
        </Line>
        <Line width={width} dimColor>
          {store.service || "starting the practice service"} · {done}/{store.models.length} finished
          {store.aborting || store.finished ? "" : " · ctrl-c stops every model"}
        </Line>
        <Text> </Text>
        <Line width={width} bold dimColor>
          {gap}
          {"MODEL".padEnd(slugW)}
          {gap}
          {"STATE".padEnd(stateW)}
          {gap}
          {"TIME".padEnd((bar ? BAR + 1 : 0) + 5)}
          {gap}
          {"RUNS".padEnd(runsW)}
          {gap}
          {last ? `${"LAST RUN".padEnd(LAST)}${gap}` : ""}
          {tools ? `TOOLS${gap}` : ""}
          ACTIVITY
        </Line>
        {store.models.map((m) => {
          const s = stateText(m);
          const slug = m.entry.slug.length > slugW ? `${m.entry.slug.slice(0, slugW - 1)}…` : m.entry.slug;
          return (
            <Line key={m.entry.slug} width={width}>
              <Icon m={m} frame={frame} /> {slug.padEnd(slugW)}
              {gap}
              <Text color={s.color}>{s.text.slice(0, stateW).padEnd(stateW)}</Text>
              {gap}
              <TimeBar m={m} now={now} limitS={header.timeout * 60} bar={bar} />
              {gap}
              <Runs m={m} width={runsW} />
              {gap}
              {last ? `${lastRun(m).slice(0, LAST).padEnd(LAST)}${gap}` : ""}
              {tools ? <Text dimColor={!m.toolCalls}>{`${String(m.toolCalls).padStart(5)}${gap}`}</Text> : ""}
              <Text dimColor={m.state !== "done"}>{detail(m)}</Text>
            </Line>
          );
        })}
        {store.aborting && !store.finished && (
          <Box marginTop={1}>
            <Line width={width} color="yellow">
              stopping every model… (ctrl-c again to kill)
            </Line>
          </Box>
        )}
      </Box>
    </>
  );
}
