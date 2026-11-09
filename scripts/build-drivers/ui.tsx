import { Box, Static, Text, useInput, useStdin, useWindowSize } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { clock, lapTime, tokens } from "./lib.js";
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

function TimeBar({ m, now, limitS }: { m: ModelView; now: number; limitS: number }) {
  if (!m.startedAt)
    return (
      <Text dimColor>
        {"░".repeat(BAR)} {" ".repeat(5)}
      </Text>
    );
  const elapsed = ((m.endedAt ?? now) - m.startedAt) / 1000;
  const filled = Math.min(BAR, Math.round((elapsed / limitS) * BAR));
  const late = elapsed / limitS > 0.8 && !m.endedAt;
  return (
    <Text>
      <Text color={m.endedAt ? "gray" : late ? "yellow" : "cyan"}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(BAR - filled)}</Text> {clock(elapsed).padStart(5)}
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

function lastRun(m: ModelView): string {
  const r = m.runs[m.runs.length - 1];
  if (!r) return "";
  return `${r.track.slice(0, 11)} ${r.clean && r.bestLap !== null ? lapTime(r.bestLap) : r.status.toLowerCase()}`;
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

  const slugW = Math.max(5, ...store.models.map((m) => m.entry.slug.length));
  const runsW = Math.min(20, Math.max(4, ...store.models.map((m) => m.budget ?? 0)));
  const stateW = 10;
  const fixed = 2 + slugW + 2 + stateW + 2 + BAR + 6 + 2 + runsW + 2 + 20 + 2 + 5 + 2;
  const detailW = Math.max(10, columns - fixed - 1);
  const done = store.models.filter((m) => m.endedAt).length;

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
        <Text>
          <Text bold>build {header.name}</Text>
          <Text dimColor>
            {"  "}practice {header.practice.join(", ")} · event {header.eventTrack} · effort {header.effort} ·{" "}
            {header.timeout} min each · {header.jobs} at a time
          </Text>
        </Text>
        <Text dimColor>
          {store.service || "starting the practice service"} · {done}/{store.models.length} finished
          {store.aborting ? "" : store.finished ? "" : " · ctrl-c stops every model"}
        </Text>
        <Box marginTop={1}>
          <Text bold dimColor>
            {"  "}
            {"MODEL".padEnd(slugW)}
            {"  "}
            {"STATE".padEnd(stateW)}
            {"  "}
            {"TIME".padEnd(BAR + 6)}
            {"  "}
            {"RUNS".padEnd(runsW)}
            {"  "}
            {"LAST RUN".padEnd(20)}
            {"  "}
            {"TOOLS"}
            {"  "}
            {"ACTIVITY"}
          </Text>
        </Box>
        {store.models.map((m) => {
          const s = stateText(m);
          return (
            <Box key={m.entry.slug}>
              <Icon m={m} frame={frame} />
              <Text> {m.entry.slug.padEnd(slugW)} </Text>
              <Text> </Text>
              <Text color={s.color}>{s.text.slice(0, stateW).padEnd(stateW)}</Text>
              <Text>{"  "}</Text>
              <TimeBar m={m} now={now} limitS={header.timeout * 60} />
              <Text>{"  "}</Text>
              <Runs m={m} width={runsW} />
              <Text>{"  "}</Text>
              <Text>{lastRun(m).padEnd(20)}</Text>
              <Text>{"  "}</Text>
              <Text dimColor={!m.toolCalls}>{String(m.toolCalls).padStart(5)}</Text>
              <Text>{"  "}</Text>
              <Box width={detailW}>
                <Text wrap="truncate-end" dimColor={m.state !== "done"}>
                  {detail(m)}
                </Text>
              </Box>
            </Box>
          );
        })}
        {store.aborting && !store.finished && (
          <Box marginTop={1}>
            <Text color="yellow">stopping every model… (ctrl-c again to kill)</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
