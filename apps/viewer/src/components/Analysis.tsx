import {
  type ChartTrack,
  DeltaChart,
  EntryChip,
  IconButton,
  InputLanes,
  SectorTable,
  SegmentedControl,
  SpeedTrace,
} from "@bench/ui/react";
import { useMemo, useState } from "react";
import { analysisPicks, deltaSeries, lapProfiles, sectorRows, whereTimeGoes } from "../lib/analysis.js";
import type { ViewerModel } from "../lib/model.js";

type Part = "speed" | "delta" | "inputs" | "sectors";

/** Timed laps compared: speed, the gap to the reference along the lap, pedals, sectors and where the time goes. */
export function Analysis({
  model,
  focusId,
  cursorS,
  layout = "panel",
  onClose,
}: {
  model: ViewerModel;
  focusId: string;
  cursorS: number | null;
  layout?: "panel" | "sheet";
  onClose: () => void;
}) {
  const profiles = useMemo(() => lapProfiles(model.cars), [model]);
  const initial = useMemo(() => analysisPicks(profiles, focusId), [profiles, focusId]);
  const [ids, setIds] = useState(initial.ids);
  const [part, setPart] = useState<Part>("speed");
  const ref = initial.ref;
  const refEntry = ref ? model.entries.get(ref) : undefined;
  const track: ChartTrack = useMemo(
    () => ({
      length: model.layout.length,
      sectors: model.replay.track.sectors,
      corners: model.corners.map((c) => ({ n: c.n, sApex: c.sApex })),
    }),
    [model],
  );
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const carOf = (id: string) => model.cars.find((c) => c.car.id === id);
  const speed = ids.flatMap((id) => {
    const p = byId.get(id);
    const entry = model.entries.get(id);
    return p && entry ? [{ entry, s: p.s, v: p.speedKmh }] : [];
  });
  const deltas = (() => {
    const r = ref ? carOf(ref) : undefined;
    if (!r) return [];
    return ids.flatMap((id) => {
      const c = carOf(id);
      const entry = model.entries.get(id);
      const d = c && id !== ref ? deltaSeries(r, c) : null;
      return d && entry ? [{ entry, s: d.s, dt: d.dt }] : [];
    });
    // carOf reads model, already a dependency.
  })();
  const focus = byId.has(focusId) ? focusId : (ids.find((id) => id !== ref) ?? ref);
  const sectors = useMemo(() => sectorRows(model.replay.classification), [model]);
  const code = (id: string) => model.entries.get(id)?.code ?? id;
  const words = focus && ref ? whereTimeGoes(sectors, focus, ref, code) : null;
  const focusEntry = focus ? model.entries.get(focus) : undefined;
  const toggle = (id: string) =>
    setIds((v) => (v.includes(id) ? (v.length > 1 ? v.filter((x) => x !== id) : v) : [...v, id]));
  const sheet = layout === "sheet";
  const w = sheet ? 358 : 1080;

  if (!refEntry || profiles.length === 0)
    return (
      <section
        className={sheet ? "analysis-sheet" : "gp-panel gp-panel--solid analysis"}
        aria-label="Analysis"
      >
        <Head sheet={sheet} onClose={onClose} />
        <p className="gp-muted">No timed lap: the analysis compares valid laps.</p>
      </section>
    );

  const charts = {
    speed: (
      <>
        <div className="gp-label">Speed, km/h, against distance</div>
        <div className="gp-chart">
          <SpeedTrace
            series={speed}
            focusId={focus ?? ""}
            track={track}
            cursor={cursorS}
            width={w}
            height={sheet ? 210 : 250}
          />
        </div>
      </>
    ),
    delta: (
      <>
        <div className="gp-label">Time to {refEntry.name} at the same distance</div>
        <div className="gp-chart">
          <DeltaChart series={deltas} reference={refEntry} track={track} width={w} height={150} />
        </div>
      </>
    ),
    inputs:
      focus && byId.get(focus) ? (
        <>
          <div className="gp-label analysis__lanes-label">
            Throttle and brake · {focusEntry ? <EntryChip entry={focusEntry} /> : null}
            {focus !== ref ? (
              <>
                {" "}
                against <EntryChip entry={refEntry} /> dashed
              </>
            ) : null}
          </div>
          <div className="gp-chart">
            <InputLanes
              trace={byId.get(focus)!}
              reference={focus !== ref ? byId.get(ref!) : null}
              track={track}
              width={w}
              height={96}
            />
          </div>
        </>
      ) : null,
    sectors: (
      <>
        <div className="gp-label">Sectors</div>
        <div className="gp-card analysis__sectors">
          <SectorTable
            rows={sectors.flatMap((r) => {
              const entry = model.entries.get(r.id);
              return entry ? [{ ...r, entry }] : [];
            })}
          />
        </div>
        {words ? (
          <>
            <div className="gp-label">Where the time goes</div>
            <div className="gp-card analysis__words">
              <p>{words}</p>
              <p className="gp-muted">
                From the sector times of the timed lap: losses first, then where it gains.
              </p>
            </div>
          </>
        ) : null}
      </>
    ),
  };

  const picker = (
    <div className="analysis__picker">
      {profiles.map((p) => {
        const entry = model.entries.get(p.id);
        return entry ? (
          <button
            type="button"
            key={p.id}
            className="gp-btn gp-btn--secondary analysis__pick"
            aria-pressed={ids.includes(p.id)}
            onClick={() => toggle(p.id)}
            title={entry.name}
          >
            <EntryChip entry={entry} />
          </button>
        ) : null;
      })}
    </div>
  );

  if (sheet)
    return (
      <section className="analysis-sheet" aria-label="Analysis">
        <Head sheet onClose={onClose} />
        <SegmentedControl<Part>
          size="touch"
          label="Chart"
          value={part}
          onChange={setPart}
          options={[
            { value: "speed", label: "Speed" },
            { value: "delta", label: "Delta" },
            { value: "sectors", label: "Sectors" },
          ]}
        />
        {picker}
        {charts[part]}
      </section>
    );

  return (
    <section className="gp-panel gp-panel--solid analysis" aria-label="Analysis">
      <div className="analysis__main">
        <Head sheet={false} onClose={onClose}>
          <span className="gp-faint analysis__sub">Timed laps · {model.replay.track.name} · reference</span>
          <EntryChip entry={refEntry} />
        </Head>
        {picker}
        {charts.speed}
        {charts.delta}
        {charts.inputs}
      </div>
      <div className="analysis__side">{charts.sectors}</div>
    </section>
  );
}

function Head({
  sheet,
  onClose,
  children,
}: {
  sheet: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="analysis__head">
      <h2 className="gp-x">Analysis</h2>
      {children}
      <span className="gp-flex" />
      {sheet ? (
        <IconButton icon="cross" label="Close" size="touch" iconSize={20} onClick={onClose} />
      ) : (
        <IconButton icon="cross" label="Close analysis (A)" onClick={onClose} />
      )}
    </div>
  );
}
