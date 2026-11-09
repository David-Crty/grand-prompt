import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildOptions, count } from "./build/lib.js";
import { leaderboard, reproduceEvent, runEvent } from "./event.js";
import { repoRoot } from "./load.js";
import { serve } from "./service.js";
import { practice, qualify, validate } from "./session.js";
import { importTracks, listTracks } from "./tracks.js";
import { createWorkspace } from "./workspace.js";

export * from "./build/lib.js";
export * from "./event.js";
export * from "./load.js";
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
  build <name>                   one driver per model in models.json, each by its own CLI in a sandbox
      --practice-tracks <a,b,c>  practice circuits (default monaco,silverstone,portimao)
      --event-track <id>         the event circuit, never practised on (default barcelona)
      --budget <n>               practice runs per model, shared across circuits (default 10)
      --jobs <n>                 models built at once (default all)
      --timeout <min>            wall-time limit per model, stated in its prompt (default 30)
      --only <list>              providers or model ids to build
      --models <file>            model list (default models.json)
      --effort <level>           low, medium, high, xhigh or max for every model (default: models.json)
      --plain                    log lines instead of the live view
      --dry-run                  print the command for the first model, run nothing
      --check                    check the sandbox, the practice service and each CLI, run no model

races
  qualify <driver...>            one flying lap per driver, replayed together
  event run <event>              the flying lap of drivers/<event>/*/driver.js on the event's circuit
  event reproduce <event>        re-run an event and check every state hash
  leaderboard [dir]              standings over every event under dir (default results/)

practice service (what build runs for each model)
  serve [--port n]               the service that runs practice laps outside the workspace (default 8787)
  workspace <dir> --model <slug> --track <a,b,c> [--budget n] [--service-url url]

options
  --track <id|path>    circuit id (see 'bench tracks') or track file (default proto-ring)
  --seed <n>           seed (default 1)
  --out <dir>          output directory (default results/<command>/<name>-NNN)
`;

const OPTIONS = {
  track: { type: "string" },
  seed: { type: "string" },
  out: { type: "string" },
  port: { type: "string" },
  budget: { type: "string" },
  model: { type: "string" },
  "service-url": { type: "string" },
  "practice-tracks": { type: "string" },
  "event-track": { type: "string" },
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
    case "qualify":
      need(1, "<driver...>");
      out((await qualify(rest, opts)).text);
      return 0;
    case "event": {
      need(2, "run|reproduce <event>");
      if (rest[0] === "run") {
        out((await runEvent(rest[1]!)).text);
        return 0;
      }
      if (rest[0] === "reproduce") {
        const r = await reproduceEvent(rest[1]!);
        out(r.text);
        return r.ok ? 0 : 3;
      }
      throw new Error(`unknown event subcommand '${rest[0]}'`);
    }
    case "leaderboard":
      out(leaderboard(rest[0] ?? join(repoRoot(), "results")).text);
      return 0;
    case "serve": {
      const s = await serve({ port: count("--port", values.port, 1) ?? 8787 });
      out(`practice service listening on ${s.url}\n`);
      return 0;
    }
    case "workspace": {
      need(1, "<dir>");
      if (!values.model) throw new Error("workspace: --model <slug> is required");
      const w = createWorkspace(rest[0]!, {
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
