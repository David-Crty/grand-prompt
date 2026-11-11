import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildOptions, count } from "./build/lib.js";
import { raceEvent, reproduceEvent } from "./event.js";
import { repoRoot } from "./load.js";
import { selectEvent } from "./select.js";
import { serve } from "./service.js";
import { practice, validate } from "./session.js";
import { importTracks, listTracks } from "./tracks.js";
import { createWorkspace } from "./workspace.js";

export * from "./build/lib.js";
export * from "./event.js";
export * from "./load.js";
export * from "./select.js";
export * from "./service.js";
export * from "./session.js";
export * from "./tracks.js";
export * from "./workspace.js";

export const USAGE = `bench <command> [options]

tracks
  tracks                         the circuits in tracks/ (ids for --track)
  tracks import                  rebuild the imported circuits from tracks/sources/

drivers
  validate <driver>              load, init and run 10 s; errors, budget use and timings
  practice <driver>              one flying lap with telemetry.csv, summary.json and a replay
  build <event>                  one driver per model in models.json, each by its own CLI in a sandbox
      --practice-tracks <a,b,c>  practice circuits (default monaco,silverstone,portimao)
      --budget <n>               practice runs per model, shared across circuits (default 10)
      --jobs <n>                 models built at once (default all)
      --timeout <min>            wall-time limit per model, stated in its prompt (default 30)
      --only <list>              providers, CLIs or model ids to build
      --models <file>            model list (default models.json)
      --effort <level>           low, medium, high, xhigh or max for every model (default: medium)
      --plain                    log lines instead of the live view
      --dry-run                  print the command for the first model, run nothing
      --check                    check the sandbox, the practice service and each CLI, run no model

races (one flying lap of an event's drivers, replayed together)
  race <event> [--track <id>]    drivers/<event>/*/driver.js on every circuit, or on one
                                 -> results/races/<track>/<event>/ (or --out <dir>/<track>/<event>/)
  reproduce <event>              re-run every race of the event and check every state hash
  select --output <event> --input <a,b,c>
                                 one driver per model from repeated builds -> drivers/<event>/:
                                 most valid laps on its practice circuits, then lowest total time

practice service (what build runs for each model)
  serve [--port n]               the service that runs practice laps outside the workspace (default 8787)
  workspace <dir> --event <event> --model <slug> --track <a,b,c> [--budget n] [--service-url url]
                                 practice runs go to results/agentic/<event>/<model>/

options
  --track <id|path>    circuit id (see 'bench tracks') or track file (default proto-ring; race: every circuit)
  --seed <n>           seed (default 1)
  --out <dir>          output directory (default results/practice/<name>-NNN, results/races/)
`;

const OPTIONS = {
  track: { type: "string" },
  seed: { type: "string" },
  out: { type: "string" },
  port: { type: "string" },
  budget: { type: "string" },
  event: { type: "string" },
  input: { type: "string" },
  output: { type: "string" },
  model: { type: "string" },
  "service-url": { type: "string" },
  "practice-tracks": { type: "string" },
  jobs: { type: "string" },
  timeout: { type: "string" },
  only: { type: "string" },
  models: { type: "string" },
  effort: { type: "string" },
  plain: { type: "boolean" },
  "dry-run": { type: "boolean" },
  check: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export async function run(argv: string[], out: (s: string) => void): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) {
    out(USAGE);
    return values.help ? 0 : 1;
  }
  const need = (n: number, what: string) => {
    if (rest.length < n) throw new Error(`${cmd}: missing ${what}\n\n${USAGE}`);
  };
  const opts = {
    track: values.track ?? "proto-ring",
    seed: count("--seed", values.seed, 0),
    out: values.out,
  };
  switch (cmd) {
    case "tracks":
      if (rest[0] === "import") out(importTracks().text);
      else out(listTracks().text);
      return 0;
    case "validate": {
      need(1, "<driver>");
      const r = await validate(rest[0]!, opts);
      out(r.text);
      return r.ok ? 0 : 2;
    }
    case "practice":
      need(1, "<driver>");
      out((await practice(rest[0]!, opts)).text);
      return 0;
    case "build": {
      const o = buildOptions(rest[0], values, join(repoRoot(), "models.json"));
      const { build } = await import("./build/index.js");
      return build(o);
    }
    case "race":
      need(1, "<event>");
      out((await raceEvent(rest[0]!, { track: values.track, out: values.out })).text);
      return 0;
    case "select": {
      if (!values.output) throw new Error("select: --output <event> is required");
      if (!values.input) throw new Error("select: --input <event,event,...> is required");
      const input = values.input.split(",").filter(Boolean);
      out((await selectEvent(values.output, input)).text);
      return 0;
    }
    case "reproduce": {
      need(1, "<event>");
      const r = await reproduceEvent(rest[0]!);
      out(r.text);
      return r.ok ? 0 : 3;
    }
    case "serve": {
      const s = await serve({ port: count("--port", values.port, 1) ?? 8787 });
      out(`practice service listening on ${s.url}\n`);
      return 0;
    }
    case "workspace": {
      need(1, "<dir>");
      if (!values.event) throw new Error("workspace: --event <event> is required");
      if (!values.model) throw new Error("workspace: --model <slug> is required");
      const w = createWorkspace(rest[0]!, {
        event: values.event,
        model: values.model,
        serviceUrl: values["service-url"] ?? "http://127.0.0.1:8787",
        tracks: (values.track ?? "").split(",").filter(Boolean),
        budget: count("--budget", values.budget, 1),
      });
      out(`workspace ready: ${w.dir}\npractice token: ${w.token}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command '${cmd}'\n\n${USAGE}`);
  }
}
