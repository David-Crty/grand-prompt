import { parseArgs } from "node:util";
import {
  type EventConfig,
  eventPaths,
  leaderboard,
  listTracks,
  practice,
  qualify,
  replayInfo,
  reproduceEvent,
  runEvent,
  validate,
} from "./commands.js";
import { readJson } from "./load.js";
import { buildOneshotPrompt, runOneshot } from "./oneshot.js";
import { serve } from "./service.js";
import { createWorkspace } from "./workspace.js";

export * from "./commands.js";
export * from "./load.js";
export * from "./oneshot.js";
export * from "./service.js";
export * from "./workspace.js";

export const USAGE = `bench <command> [options]

  validate <driver>                        load, init and run 10 s; report errors and timings
  practice <driver>                        one flying lap: lap/sector times, telemetry.csv, summary.json
  qualify <driver...> [--seed S]           one flying lap per driver (ghost mode); replay.json.gz, results.json
  event run <event-id> [--reference]       the flying lap of drivers/<event-id>/*/driver.js
  event reproduce <event-id>               re-run an event and verify every state hash
  oneshot <event-id> --model <id> [--slug s] [--prompt-only]
                                           one-shot submission via OpenRouter (OPENROUTER_API_KEY)
  leaderboard [results-dir]                aggregate event results (default: results/)
  replay <replay.json.gz>                  print replay header and classification
  tracks                                   list the circuits in tracks/ (ids for --track)
  serve [--port P]                         practice service for agentic runs (keeps hidden params out of the workspace)
  workspace <dir> --model <slug> [--track a,b,c] [--budget N, default 10] [--service-url U]
                                           create an isolated agentic workspace (DDK + practice client)

common options:
  --track <id|path>    track id in tracks/ (see 'bench tracks') or a JSON path (default proto-ring)
  --car <path>         car config (default cars/proto.json)
  --seed <n>           seed (default 1)
  --info <A|B>         information level (default B: hidden constants not passed to drivers)
  --out <dir>          output directory
  --reference          add the house reference driver to qualify/event run (off by default)
`;

export async function run(argv: string[], out: (s: string) => void): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      track: { type: "string", default: "proto-ring" },
      car: { type: "string" },
      seed: { type: "string" },
      info: { type: "string" },
      out: { type: "string" },
      reference: { type: "boolean", default: false },
      port: { type: "string" },
      budget: { type: "string" },
      model: { type: "string" },
      "service-url": { type: "string" },
      slug: { type: "string" },
      "prompt-only": { type: "boolean", default: false },
      token: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) {
    out(USAGE);
    return cmd || values.help ? 0 : 1;
  }
  const info = values.info?.toUpperCase();
  if (info && info !== "A" && info !== "B") throw new Error("--info must be A or B");
  const common = {
    track: values.track!,
    car: values.car,
    seed: values.seed ? Number(values.seed) : undefined,
    infoLevel: info as "A" | "B" | undefined,
    out: values.out,
  };
  const need = (n: number, what: string) => {
    if (rest.length < n) throw new Error(`${cmd}: missing ${what}\n\n${USAGE}`);
  };
  switch (cmd) {
    case "validate": {
      need(1, "<driver>");
      const r = await validate(rest[0]!, common);
      out(r.text);
      return r.ok ? 0 : 2;
    }
    case "practice": {
      need(1, "<driver>");
      out((await practice(rest[0]!, common)).text);
      return 0;
    }
    case "qualify":
      need(1, "<driver...>");
      out((await qualify(rest, { ...common, reference: values.reference })).text);
      return 0;
    case "event": {
      need(2, "run|reproduce <event-id>");
      if (rest[0] === "run") {
        out((await runEvent(rest[1]!, { reference: values.reference })).text);
        return 0;
      }
      if (rest[0] === "reproduce") {
        const r = await reproduceEvent(rest[1]!);
        out(r.text);
        return r.ok ? 0 : 3;
      }
      throw new Error(`unknown event subcommand '${rest[0]}'`);
    }
    case "oneshot": {
      need(1, "<event-id>");
      if (values["prompt-only"]) {
        out(buildOneshotPrompt(readJson<EventConfig>(eventPaths(rest[0]!).config)));
        return 0;
      }
      if (!values.model) throw new Error("oneshot: --model <provider/model> is required");
      const slug =
        values.slug ??
        values.model
          .replace(/^[^/]*\//, "")
          .replace(/[^a-z0-9._-]+/gi, "-")
          .toLowerCase();
      out((await runOneshot({ event: rest[0]!, model: values.model, slug })).text);
      return 0;
    }
    case "leaderboard":
      out(leaderboard(rest[0] ?? "results").text);
      return 0;
    case "replay":
      need(1, "<replay>");
      out(replayInfo(rest[0]!).text);
      return 0;
    case "tracks":
      out(listTracks().text);
      return 0;
    case "serve": {
      const s = await serve({ port: Number(values.port ?? 8787) });
      out(`practice service listening on ${s.url}\n`);
      return 0;
    }
    case "workspace": {
      need(1, "<dir>");
      if (!values.model) throw new Error("workspace: --model <slug> is required");
      const w = createWorkspace(rest[0]!, {
        model: values.model,
        serviceUrl: values["service-url"] ?? "http://127.0.0.1:8787",
        token: values.token,
        tracks: values.track!.split(",").filter(Boolean),
        budget: values.budget ? Number(values.budget) : undefined,
      });
      out(`workspace ready: ${w.dir}\npractice token: ${w.token}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command '${cmd}'\n\n${USAGE}`);
  }
}
