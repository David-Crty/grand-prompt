import { formatGap, formatLapTime, lossTint, shares } from "@bench/ui";
import {
  Button,
  ChartLegend,
  type ChartTrack,
  CornerMap,
  CornerOwners,
  CornerTable,
  EntrySelect,
  FieldGrid,
  GapChart,
  IconButton,
  InputLanes,
  SegmentedControl,
  SpeedTrace,
} from "@bench/ui/react";
import { useMemo, useRef, useState } from "react";
import {
  analysisData,
  analysisPair,
  brakeText,
  bySector,
  deltaSeries,
  fastestCounts,
  pairRows,
  pairSummary,
  watchTime,
} from "../lib/analysis.js";
import { buildMinimap, cornerLabelAt, stretchPath } from "../lib/minimap.js";
import type { ViewerModel } from "../lib/model.js";

type Part = "corners" | "charts" | "field";

/** Grid cells deepen to full orange at this loss through one corner (s). */
const FULL_LOSS = 1.2;

/**
 * Timed laps compared, two ways over the same corners: the followed car against a reference (the gap, speed and
 * pedals, zoomable into a corner, and the corner table), then the whole field against the fastest car through
 * each corner.
 */
export function Analysis({
  model,
  focusId,
  cursorS,
  layout = "panel",
  onClose,
  onFocus,
  onWatch,
}: {
  model: ViewerModel;
  focusId: string;
  cursorS: number | null;
  layout?: "panel" | "sheet";
  onClose: () => void;
  /** Analyse (and follow) another car. */
  onFocus: (id: string) => void;
  /** Play the replay from this time. */
  onWatch: (t: number) => void;
}) {
  const sheet = layout === "sheet";
  const data = useMemo(() => analysisData(model.cars, model.corners, model.replay.track.sectors), [model]);
  const [refPick, setRefPick] = useState<string | null>(null);
  const [cornerN, setCornerN] = useState<number | null>(null);
  const [part, setPart] = useState<Part>("corners");
  const charts = useRef<HTMLDivElement>(null);
  const pair = analysisPair(data.profiles, focusId, refPick);
  const carIdx = model.cars.find((c) => c.car.id === pair.car);
  const refIdx = model.cars.find((c) => c.car.id === pair.ref);
  const delta = useMemo(() => (carIdx && refIdx ? deltaSeries(refIdx, carIdx, 5) : null), [carIdx, refIdx]);
  const map = useMemo(() => {
    const m = buildMinimap(model.layout, sheet ? 340 : 360, sheet ? 240 : 250, 28);
    return {
      m,
      stretches: data.segments.flatMap((g, k) => {
        const entry = model.entries.get(data.field.fastest[k] ?? "");
        return entry ? [{ n: g.n, d: stretchPath(model.layout, m, g.from, g.to), entry }] : [];
      }),
      labels: model.corners.map((c) => ({ n: c.n, ...cornerLabelAt(model.layout, m, c) })),
    };
  }, [model, data, sheet]);

  const carP = data.profiles.find((p) => p.id === pair.car);
  const refP = data.profiles.find((p) => p.id === pair.ref);
  const carT = pair.car ? data.times.get(pair.car) : undefined;
  const refT = pair.ref ? data.times.get(pair.ref) : undefined;
  const car = pair.car ? model.entries.get(pair.car) : undefined;
  const ref = pair.ref ? model.entries.get(pair.ref) : undefined;
  if (!carP || !refP || !carT || !refT || !car || !ref || !carIdx || !delta)
    return (
      <section
        className={sheet ? "analysis-sheet" : "gp-panel gp-panel--solid analysis"}
        aria-label="Analysis"
      >
        <Head sheet={sheet} onClose={onClose} />
        <p className="gp-muted">No pair of timed laps: the analysis compares two valid laps.</p>
      </section>
    );

  const rows = pairRows(
    data.segments,
    model.corners,
    { times: carT, profile: carP },
    { times: refT, profile: refP },
  );
  const gap = carP.time! - refP.time!;
  const top = { car: Math.max(...carP.speedKmh), ref: Math.max(...refP.speedKmh) };
  const summary = pairSummary(rows, car.code, ref.code, gap, top);
  const k = cornerN == null ? -1 : data.segments.findIndex((g) => g.n === cornerN);
  const seg = k >= 0 ? data.segments[k]! : null;
  const row = k >= 0 ? rows[k]! : null;
  const range: [number, number] = seg ? [seg.from, seg.to] : [0, model.layout.length];
  const track: ChartTrack = {
    length: model.layout.length,
    sectors: model.replay.track.sectors,
    corners: model.corners,
  };
  const share = shares(rows.map((r) => r.dt));
  const sectors = bySector(
    rows.map((r, i) => ({
      n: r.n,
      sector: r.sector,
      dt: r.dt,
      share: share[i]!,
      apexKmh: r.car.apexKmh,
      apexDiff: Math.round(r.car.apexKmh) - Math.round(r.ref.apexKmh),
      braking: brakeText(r, ref.code),
    })),
  );
  const pole = data.profiles[0]!.time!;
  const field = data.field.ids.flatMap((id, i) => {
    const entry = model.entries.get(id);
    const time = data.profiles.find((p) => p.id === id)?.time;
    const loss = data.field.loss[i]!;
    return entry && time != null
      ? [
          {
            entry,
            loss,
            tint: loss.map((l) => lossTint(l, FULL_LOSS)),
            lap: id === data.field.ids[0] ? formatLapTime(time) : formatGap(time - pole),
          },
        ]
      : [];
  });
  const owners = fastestCounts(data.field).flatMap((o) => {
    const entry = model.entries.get(o.id);
    return entry ? [{ entry, count: o.count }] : [];
  });
  const noLap = model.cars
    .filter((c) => !data.times.has(c.car.id))
    .map((c) => model.entries.get(c.car.id)?.code ?? c.car.id);
  const option = (id: string, onPole: boolean) => {
    const p = data.profiles.find((x) => x.id === id)!;
    const e = model.entries.get(id)!;
    return { entry: e, detail: `${onPole ? "pole · " : ""}${formatLapTime(p.time)}` };
  };
  const ids = data.profiles.map((p) => p.id);
  const pickCar = (id: string) => {
    if (id !== car.id) onFocus(id);
  };
  const pickCell = (id: string, n: number) => {
    pickCar(id);
    setCornerN(n);
    if (sheet) setPart("charts");
    else {
      const el = charts.current;
      const r = el?.getBoundingClientRect();
      if (el && r && (r.top < 0 || r.top > window.innerHeight * 0.6))
        el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const w = sheet ? 358 : 960;

  const pickers = (
    <div className="analysis__pair-pick">
      <EntrySelect
        label="Car"
        size={sheet ? "touch" : "m"}
        align={sheet ? "start" : "end"}
        value={car}
        options={ids.map((id, i) => option(id, i === 0))}
        onChange={pickCar}
      />
      <span className="analysis__vs">vs</span>
      <EntrySelect
        label="Reference"
        size={sheet ? "touch" : "m"}
        align={sheet ? "start" : "end"}
        value={ref}
        options={ids.filter((id) => id !== car.id).map((id) => option(id, id === ids[0]))}
        onChange={setRefPick}
      />
      <span className={`analysis__gap ${gap >= 0 ? "is-behind" : "is-ahead"}`}>
        {gap >= 0 ? "+" : "−"}
        {Math.abs(gap).toFixed(3)} s
      </span>
    </div>
  );
  const sum = (
    <p className="analysis__sum">
      <b>{summary.lead}</b> {summary.rest}
    </p>
  );
  const zoom = (
    <div className="analysis__zoom">
      {row && seg ? (
        <>
          <Button size={sheet ? "touch" : "m"} icon="back" onClick={() => setCornerN(null)}>
            Whole lap
          </Button>
          <span className="analysis__zoomtext">
            <b>Turn {row.n}</b> · {car.code}{" "}
            <b className={row.dt >= 0 ? "is-behind" : "is-ahead"}>
              {row.dt >= 0 ? "+" : "−"}
              {Math.abs(row.dt).toFixed(2)} s
            </b>{" "}
            to {ref.code} here
          </span>
          <span className="gp-flex" />
          <Button
            variant="primary"
            size={sheet ? "touch" : "m"}
            icon="play"
            onClick={() => onWatch(watchTime(carIdx, seg.from))}
          >
            Watch T{row.n}
          </Button>
        </>
      ) : (
        <span className="analysis__zoomtext">
          <b>Whole lap.</b> Pick a corner in the table{sheet ? "" : " or the grid"} to zoom in.
        </span>
      )}
    </div>
  );
  const chartBlock = (
    <div className="analysis__charts" ref={charts}>
      {zoom}
      <ChartLegend
        title={row ? `Time lost to ${ref.code} through T${row.n}, s` : `Gap to ${ref.code} along the lap, s`}
        items={[
          { key: "behind", mark: "behind", label: `${car.code} behind` },
          { key: "ahead", mark: "ahead", label: `${car.code} ahead` },
        ]}
      />
      <div className="gp-chart">
        <GapChart
          series={{ entry: car, s: delta.s, dt: delta.dt }}
          reference={ref}
          track={track}
          range={range}
          cursor={cursorS}
          width={w}
          height={sheet ? 110 : 120}
        />
      </div>
      <ChartLegend
        title="Speed, km/h"
        items={[
          { key: "car", mark: "line", entry: car },
          { key: "ref", mark: "dash", entry: ref },
          ...(row
            ? [
                { key: "brake", mark: "brake-point" as const, label: "braking point" },
                { key: "apex", mark: "apex" as const, label: "apex speed" },
              ]
            : []),
        ]}
      />
      <div className="gp-chart">
        <SpeedTrace
          car={{ entry: car, s: carP.s, v: carP.speedKmh }}
          reference={{ entry: ref, s: refP.s, v: refP.speedKmh }}
          track={track}
          range={range}
          marks={row ? { car: marksOf(row.car), ref: marksOf(row.ref) } : null}
          cursor={cursorS}
          width={w}
          height={sheet ? 190 : 220}
        />
      </div>
      <ChartLegend
        title="Throttle and brake"
        items={[
          { key: "car", mark: "pedals", entry: car },
          { key: "ref", mark: "ref-dash", entry: ref },
        ]}
      />
      <div className="gp-chart">
        <InputLanes
          trace={carP}
          reference={refP}
          track={track}
          range={range}
          peaks={
            row
              ? { car: { entry: car, v: row.car.peakBrake }, ref: { entry: ref, v: row.ref.peakBrake } }
              : null
          }
          width={w}
          height={84}
        />
      </div>
    </div>
  );
  const table = (
    <div className="analysis__side">
      <div className="gp-label">Corner by corner against {ref.code}</div>
      <div className="gp-scroll">
        <CornerTable
          sectors={sectors}
          reference={ref}
          gap={gap}
          top={top}
          selected={cornerN}
          onSelect={(n) => {
            setCornerN(n);
            if (sheet && n != null) setPart("charts");
          }}
        />
      </div>
    </div>
  );
  const fieldBlock = (
    <div className="analysis__field">
      <div className="gp-label">The field · time lost to the fastest car through each corner</div>
      <div className="analysis__fieldbody">
        <div className="analysis__map">
          <CornerMap
            width={map.m.width}
            height={map.m.height}
            stretches={map.stretches}
            labels={map.labels}
            start={map.m.start}
            selected={cornerN}
          />
          <CornerOwners owners={owners} />
        </div>
        <div className="analysis__grid">
          <div className="gp-scroll">
            <FieldGrid
              rows={field}
              corners={data.segments.map((g) => ({ n: g.n, sector: g.sector }))}
              carId={car.id}
              refId={ref.id}
              selected={cornerN}
              onCar={pickCar}
              onCell={pickCell}
            />
          </div>
          <p className="gp-table__foot">
            Purple is the fastest through that corner. The ideal lap, the best of each corner added up, is{" "}
            <b>{formatLapTime(data.field.ideal)}</b>, {(pole - data.field.ideal).toFixed(3)} s under pole.
            {noLap.length ? ` No timed lap: ${noLap.join(", ")}.` : ""}
          </p>
        </div>
      </div>
    </div>
  );

  if (sheet)
    return (
      <section className="analysis-sheet" aria-label="Analysis">
        <Head sheet onClose={onClose} />
        {pickers}
        {sum}
        <SegmentedControl<Part>
          size="touch"
          label="View"
          value={part}
          onChange={setPart}
          options={[
            { value: "corners", label: "Corners" },
            { value: "charts", label: "Charts" },
            { value: "field", label: "Field" },
          ]}
        />
        {part === "corners" ? table : part === "charts" ? chartBlock : fieldBlock}
      </section>
    );

  return (
    <section className="gp-panel gp-panel--solid analysis" aria-label="Analysis">
      <Head sheet={false} onClose={onClose}>
        <span className="gp-faint analysis__sub">{model.replay.track.name} · timed laps</span>
        <span className="gp-flex" />
        {pickers}
      </Head>
      {sum}
      <div className="analysis__pair">
        {chartBlock}
        {table}
      </div>
      {fieldBlock}
    </section>
  );
}

function marksOf(f: { brakeS: number | null; apexS: number; apexKmh: number }) {
  return { brakeS: f.brakeS, apexS: f.apexS, apexKmh: f.apexKmh };
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
      {sheet ? (
        <>
          <span className="gp-flex" />
          <IconButton icon="cross" label="Close" size="touch" iconSize={20} onClick={onClose} />
        </>
      ) : (
        <IconButton icon="cross" label="Close analysis (A)" onClick={onClose} />
      )}
    </div>
  );
}
