// Grand Prompt UI contract: packages/ui. Shared by apps/viewer (DOM HUD over react-three-fiber)
// and apps/video (Remotion). Components are presentational; data shaping lives in pure, tested lib modules.
import type * as React from 'react';

// ---------------------------------------------------------------- data (lib/*.ts)
export type EntrySlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type Provider = 'anthropic' | 'openai' | 'google' | 'xai' | 'mistral' | 'other';
/** lib/entries.ts: resolveEntries(models.json, replay.cars) gives unique slots per event. */
export interface Entry {
  id: string;            // model id, e.g. "claude-fable-5-1"
  name: string;          // exactly as models.json: "Claude Fable 5.1"
  code: string;          // three letters, e.g. "FAB"; collisions add the version digit
  slot: EntrySlot | 'house';
  provider: Provider;    // drives the 3D body paint (body-* tokens)
  house?: boolean;       // reference driver
}
/** Existing lib/timing.ts StandingRow. */
export interface StandingRow {
  id: string; position: number; lap: number; status: string;
  finished: boolean; out: boolean; gap: number | null; interval: number | null; lapsDown: number;
}
export type MessageKind = 'fastest' | 'deleted' | 'penalty' | 'warning' | 'crash' | 'impact' | 'finish' | 'dnf' | 'strike' | 'info';
export interface RaceMessage { t: number; carId: string | null; kind: MessageKind; text: string }
/** Existing lib/frames.ts CarSample (subset). */
export interface CarSample { x: number; y: number; speed: number; throttle: number; brake: number; steer: number; surface: 'track' | 'kerb' | 'grass' | 'gravel' | 'barrier'; lap: number; s: number; ended: boolean }
/** lib/timeline.ts */
export type MarkerKind = 'start' | 'fastest' | 'warn' | 'dnf' | 'finish';
export interface TimelineMarker { t: number; kind: MarkerKind; carIds: string[]; label: string }
/** lib/pack.ts: cars closer than packDistance (1.5 car lengths), in running order; `same` groups identical positions. */
export interface Pack { ids: string[]; same: string[][]; anchor: { x: number; y: number } }
/** lib/incidents.ts: reproducible plain-words explanation from frames. */
export type IncidentCause = 'power-oversteer' | 'wrong-way' | 'brake-lock' | 'barrier-contact' | 'ecu-failure' | 'stalled' | 'time-up';
export interface Incident {
  carId: string; t: number; lap: number; corner: number | null; where: string; // "Lap 1 · Turn 2 exit"
  impactKmh: number | null; causes: IncidentCause[]; sentence: string; replayFrom: number; x: number; y: number;
  window: { t: number[]; speedKmh: number[]; throttle: number[]; brake: number[]; steer: number[]; yawRate: number[] };
  error?: string; // ECU failure: the driver error text
}
/** lib/cost.ts */
export interface Cost { usd: number; estimated: boolean; source: 'cli' | 'prices.json'; priceDate?: string }
export interface BuildFacts { tokensIn: number; tokensOut: number; cost: Cost | null; wallTimeS: number; practiceRuns: number; practiceLimit: number; effort: string; cli: string }
export type CaveatKind = 'trial' | 'budget' | 'effort' | 'reference';

// ---------------------------------------------------------------- identity
export interface WordmarkProps { size?: 's' | 'm' | 'l'; stacked?: boolean }
export declare function Wordmark(p: WordmarkProps): React.ReactElement;
export interface EntryChipProps { entry: Entry; size?: 's' | 'l' | 'xl'; variant?: 'fill' | 'bar' | 'dot' | 'out' | 'house' }
export declare function EntryChip(p: EntryChipProps): React.ReactElement;
export interface EntryNameProps { entry: Entry; meta?: boolean; size?: 's' | 'l' }
export declare function EntryName(p: EntryNameProps): React.ReactElement;
export type BadgeKind = 'dnf' | 'warn' | 'fin' | 'fastest' | 'ghost' | 'trial' | 'est' | 'outline';
export interface StatusBadgeProps { kind: BadgeKind; children?: React.ReactNode; icon?: IconName; size?: 's' | 'l' }
export declare function StatusBadge(p: StatusBadgeProps): React.ReactElement;
export interface PositionBoxProps { position: number | null; leader?: boolean; out?: boolean }
export declare function PositionBox(p: PositionBoxProps): React.ReactElement;
export interface GapChipProps { row: StandingRow; mode?: 'gap' | 'interval'; precision?: 1 | 3 }
export declare function GapChip(p: GapChipProps): React.ReactElement;
export interface DeltaChipProps { seconds: number; reference?: string }
export declare function DeltaChip(p: DeltaChipProps): React.ReactElement;

// ---------------------------------------------------------------- timing
export interface TowerRowProps { row: StandingRow; entry: Entry; focused?: boolean; fastest?: boolean; justOut?: boolean; penalty?: number; mode?: 'gap' | 'interval'; layout?: 'panel' | 'dense' | 'sheet'; onFocus?: (id: string) => void }
export declare function TowerRow(p: TowerRowProps): React.ReactElement;
export interface TimingTowerProps {
  rows: StandingRow[]; entries: Record<string, Entry>; totalLaps: number; session: 'race' | 'qualifying';
  focusId: string | null; fastestId: string | null; mode: 'gap' | 'interval';
  onFocus: (id: string) => void; onMode: (m: 'gap' | 'interval') => void;
  density?: 'auto' | 'normal' | 'dense'; layout?: 'panel' | 'sheet'; loading?: boolean;
}
export declare function TimingTower(p: TimingTowerProps): React.ReactElement;
export interface TowerStripProps { rows: StandingRow[]; entries: Record<string, Entry>; focusId: string | null; top?: number; onExpand: () => void }
export declare function TowerStrip(p: TowerStripProps): React.ReactElement;

// ---------------------------------------------------------------- replay HUD
export type CameraMode = 'tv' | 'chase' | 'onboard' | 'map';
export interface SessionHeaderProps { eventId: string; eventHref: string; track: string; session: 'race' | 'qualifying'; laps: number; t: number; speed: number; camera: CameraMode; ghost: boolean; layout?: 'panel' | 'bar' }
export declare function SessionHeader(p: SessionHeaderProps): React.ReactElement;
export interface TelemetryGaugeProps { sample: CarSample | null }
export declare function TelemetryGauge(p: TelemetryGaugeProps): React.ReactElement;
export interface FocusCardProps { row: StandingRow; entry: Entry; sample: CarSample | null; laps: { current: number | null; last: number | null; best: number | null }; fastest: boolean; layout?: 'card' | 'row' }
export declare function FocusCard(p: FocusCardProps): React.ReactElement;
export interface RaceToastProps { message: RaceMessage; entry?: Entry; action?: { label: string; onClick: () => void } }
export declare function RaceToast(p: RaceToastProps): React.ReactElement;
export interface ToastStackProps { messages: RaceMessage[]; t: number; speed: number; max: 1 | 3; entries: Record<string, Entry> }
export declare function ToastStack(p: ToastStackProps): React.ReactElement;
export interface TimelineProps { duration: number; t: number; markers: TimelineMarker[]; lapTimes?: number[]; onSeek: (t: number) => void; onMarker?: (m: TimelineMarker) => void; size?: 'm' | 'touch'; buffered?: number }
export declare function Timeline(p: TimelineProps): React.ReactElement;
export interface TransportBarProps {
  t: number; duration: number; playing: boolean; speed: 1 | 2 | 4 | 8 | 16 | 32; camera: CameraMode; markers: TimelineMarker[];
  toggles: { trails: boolean; analysis: boolean; classification: boolean };
  onToggle: () => void; onSeek: (t: number) => void; onSpeed: (dir: 1 | -1) => void; onCamera: (c: CameraMode) => void;
  onFlag: (k: 'trails' | 'analysis' | 'classification' | 'help') => void; layout?: 'bar' | 'phone'; loading?: number | null;
}
export declare function TransportBar(p: TransportBarProps): React.ReactElement;
export interface CarLabelProps { entry: Entry; position: number | null; focused?: boolean; ghost?: boolean; out?: boolean; screen: { x: number; y: number } }
export declare function CarLabel(p: CarLabelProps): React.ReactElement;
export interface PackLabelProps { pack: Pack; entries: Record<string, Entry>; screen: { x: number; y: number }; title?: string }
export declare function PackLabel(p: PackLabelProps): React.ReactElement;
export interface IncidentPinProps { kind?: 'dnf' | 'warn'; screen: { x: number; y: number }; onClick?: () => void }
export declare function IncidentPin(p: IncidentPinProps): React.ReactElement;
export interface StartBoardProps { t: number; progress: Record<string, number>; entries: Record<string, Entry>; same: string[][]; visible: boolean }
export declare function StartBoard(p: StartBoardProps): React.ReactElement;
export interface IncidentCardProps { incident: Incident; entry: Entry; onReplay: () => void; onMap: () => void; onCode: () => void; layout?: 'card' | 'sheet' }
export declare function IncidentCard(p: IncidentCardProps): React.ReactElement;
export interface MiniMapProps { track: { x: number[]; y: number[] }; samples?: Record<string, CarSample>; entries: Record<string, Entry>; focusId?: string | null; incidents?: Incident[]; labels?: boolean; highlight?: { s0: number; s1: number; tone: 'dnf' | 'fastest' }; width: number; height: number; onFocus?: (id: string) => void }
export declare function MiniMap(p: MiniMapProps): React.ReactElement;

// ---------------------------------------------------------------- results
export interface ClassificationRow { entry: Entry; position: number | null; status: string; totalTime: number | null; gap: number | null; bestLap: number | null; bestLapNumber: number | null; penalties: number; incident?: Incident; build: BuildFacts | null; points: number }
export interface ClassificationTableProps { rows: ClassificationRow[]; fastestLap: number | null; caveat?: { kind: CaveatKind; text: string } | null; columns?: 'race' | 'full' }
export declare function ClassificationTable(p: ClassificationTableProps): React.ReactElement;
export declare function ResultList(p: ClassificationTableProps & { showCost?: boolean }): React.ReactElement;
export interface PodiumProps { top: ClassificationRow[] }
export declare function Podium(p: PodiumProps): React.ReactElement;
export interface ResultCardProps { event: EventSummary; rows: ClassificationRow[]; format: 'og' | 'portrait' }
export declare function ResultCard(p: ResultCardProps): React.ReactElement;
export interface SectorTableProps { rows: { entry: Entry; laps: { time: number; sectors: number[] }[] }[]; lap: number | 'best' }
export declare function SectorTable(p: SectorTableProps): React.ReactElement;
export interface EventSummary { id: string; name: string; track: string; date: string; laps: number; entries: Entry[]; winner: Entry | null; winnerTime: number | null; caveats: CaveatKind[]; status: 'draft' | 'published'; href: string }
export declare function EventCard(p: { event: EventSummary }): React.ReactElement;
export declare function StatTile(p: { label: string; value: React.ReactNode; sub?: React.ReactNode; badge?: BadgeKind }): React.ReactElement;
export declare function CaveatBanner(p: { kind: CaveatKind; children: React.ReactNode; href?: string; size?: 'full' | 'short' }): React.ReactElement;
export interface ReproduceBlockProps { header: { simVersion: string; apiVersion: string; ddkVersion: string; trackId: string; trackHash: string; carId: string; carHash: string; seed: number; stateHash: string }; eventId: string; licences?: string[] }
export declare function ReproduceBlock(p: ReproduceBlockProps): React.ReactElement;
export interface CodeViewProps { source: string; path: string; stats: { lines: number; bytes: number; hash: string; baselineSimilarity: number }; highlight?: [number, number][] }
export declare function CodeView(p: CodeViewProps): React.ReactElement;

// ---------------------------------------------------------------- charts (SVG, no chart library needed)
export interface Trace { id: string; s: number[]; speedKmh: number[]; throttle: number[]; brake: number[] }
export interface ChartTrack { length: number; sectors: number[]; corners: { n: number; sApex: number }[] }
export declare function SpeedTrace(p: { traces: Trace[]; entries: Record<string, Entry>; track: ChartTrack; focusId: string; cursor?: number | null; zoom?: [number, number] }): React.ReactElement;
export declare function DeltaChart(p: { reference: Trace & { lapTime: number }; others: (Trace & { lapTime: number })[]; entries: Record<string, Entry>; track: ChartTrack }): React.ReactElement;
export declare function InputLanes(p: { trace: Trace; reference?: Trace; track: ChartTrack }): React.ReactElement;
export declare function PracticeChart(p: { runs: { circuit: string; run: number; bestLap: number | null; status: string }[]; limit: number }): React.ReactElement;
export declare function CostScatter(p: { rows: ClassificationRow[] }): React.ReactElement;

// ---------------------------------------------------------------- controls
export type IconName = 'play' | 'pause' | 'back5' | 'cross' | 'warn' | 'clock' | 'stopwatch' | 'flag' | 'map' | 'share' | 'info' | 'code' | 'back' | 'next' | 'down' | 'up' | 'trail' | 'chart' | 'ghost' | 'copy' | 'expand' | 'lap' | 'list' | 'search' | 'help' | 'cam' | 'repro' | 'download' | 'gear' | 'check' | 'dot';
export declare function Icon(p: { name: IconName; size?: 16 | 20; label?: string }): React.ReactElement;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'm' | 'touch'; icon?: IconName; block?: boolean }
export declare function Button(p: ButtonProps): React.ReactElement;
export declare function IconButton(p: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: 'plain' | 'primary'; size?: 'm' | 'touch' }): React.ReactElement;
export declare function SegmentedControl<T extends string>(p: { options: { value: T; label: React.ReactNode; ariaLabel?: string }[]; value: T; onChange: (v: T) => void; size?: 'm' | 'touch' }): React.ReactElement;
export declare function Tabs<T extends string>(p: { items: { value: T; label: string; href?: string }[]; value: T; onChange?: (v: T) => void }): React.ReactElement;
export declare function Sheet(p: { snap: 'closed' | 'peek' | 'half' | 'full'; onSnap: (s: 'closed' | 'peek' | 'half' | 'full') => void; title?: React.ReactNode; children: React.ReactNode }): React.ReactElement;
export declare function StateBlock(p: { kind: 'empty' | 'loading' | 'error'; title: string; text?: React.ReactNode; progress?: number; action?: React.ReactNode }): React.ReactElement;

// ---------------------------------------------------------------- video (apps/video, Remotion; 540x960 design units, rendered 2x)
export interface Highlight { kind: 'start' | 'crash' | 'fastest' | 'closest' | 'finish' | 'overtake'; t: number; carIds: string[]; title: string; sub: string; score: number }
export declare function IntroCard(p: { event: EventSummary; entries: Entry[]; frame: number }): React.ReactElement;
export declare function RaceLowerThird(p: { rows: StandingRow[]; entries: Record<string, Entry>; lap: number; totalLaps: number; frame: number }): React.ReactElement;
export declare function HighlightCallout(p: { highlight: Highlight; entries: Record<string, Entry>; frame: number }): React.ReactElement;
export declare function FinalCard(p: { event: EventSummary; rows: ClassificationRow[]; caveat?: string; frame: number }): React.ReactElement;
