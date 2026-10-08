import { useState, useRef, useEffect } from "react";
import AlgorithmSimulationModule from "./AlgorithmSimulationModule";
import MemoryUsageBadge from "./MemoryUsageBadge";
import DuplicateHistoryPanel from "./DuplicateHistoryPanel";
import FilterHistoryPanel from "./FilterHistoryPanel";
import AlgorithmComputationSteps from "./AlgorithmComputationSteps";
import SortInterpretation, { SortPieChart, type SortSummary } from "./SortInsights";

type ImportNotes = {
  headerRowsSkipped: number;
  columnsRealigned: { label: string; fromCol: number; toCol: number }[];
  groupsDetected: string[];
  dividerRowsRemoved: number;
  subtotalRowsRemoved: number;
};

type UploadResponse = {
  fileId: string;
  fileName: string;
  columns: string[];
  preview: Record<string, unknown>[];
  rowsBefore: number;
  rowsAfter: number;
  duplicatesRemoved: number;
  nullCells: number;
  runtimeMs: number;
  uniqueValues: Record<string, string[]>;
  importNotes: ImportNotes;
};

type FullDataRow = {
  index: number;
  data: Record<string, unknown>;
  missingFields: string[];
  isIncomplete: boolean;
};

type FullDataResponse = {
  columns: string[];
  rows: FullDataRow[];
  rowCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  missingByColumn: Record<string, number>;
  totalMissingCells: number;
  incompleteRowCount: number;
};

// ms since epoch -> "HH:MM:SS.mmm" in the user's local time, for Start/End Time display.
function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour12: false });
  const millis = String(d.getMilliseconds()).padStart(3, "0");
  return `${time}.${millis}`;
}

// ms duration -> "412 ms" for sub-second, or "2.34 s" once it crosses a second.
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function IconUpload() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M12 4L7 9M12 4l5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12M12 16l-5-5M12 16l5-5" />
      <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function IconFilterGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16l-6 8v5l-4 2v-7L4 5Z" />
    </svg>
  );
}

function IconSortGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16M7 4 3 8M7 4l4 4" />
      <path d="M17 20V4M17 20l4-4M17 20l-4-4" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6M9 9h1" />
    </svg>
  );
}

function IconPulse() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

type AlgorithmComponent = { label: string; ratio: number };
type ScatterPoint = { class: string; x: number; y: number };

// Mirrors algorithms.ts's StepResult/ComputationStep — one or more computed-value panels per
// step, for the "Step-by-Step Computation" display (Chapter 3 traceability).
type StepResult =
  | { kind: "vector"; label: string; values: number[]; labels?: string[] }
  | { kind: "matrix"; label: string; values: number[][]; rowLabels?: string[]; colLabels?: string[] }
  | { kind: "table"; label: string; columns: string[]; rows: (string | number)[][]; totalRows: number; shown: number }
  | { kind: "scalars"; label: string; entries: { label: string; value: number | string }[] };

type ComputationStep = {
  step: number;
  title: string;
  formula: string;
  description: string;
  results: StepResult[];
};

type AlgorithmsResponse = {
  numericColumns: string[];
  rowsUsed: number;
  pca: { components: AlgorithmComponent[]; columnNames: string[]; scores: number[][]; steps: ComputationStep[] };
  lda: {
    labelColumn: string;
    classes: string[];
    components: AlgorithmComponent[];
    accuracy: number | null;
    testSetSize: number;
    note?: string;
    columnNames: string[];
    scatter: ScatterPoint[];
    steps: ComputationStep[];
  };
  // Original rows in the same order as pca.scores / lda.scatter — lets the Before/After
  // comparison tables zip row i with its PCA/LDA output without a second request.
  rows: Record<string, unknown>[];
};

const CLASS_COLORS = ["#35604A", "#C4531D", "#3B5D8A", "#7A5FA0", "#B8952E", "#4B7A6B"];

function IconSparkle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
    </svg>
  );
}

function IconTarget() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : "/api";

// ---------- Algorithm processing simulation ----------
// The real /apply-algorithms call is a single blocking server request with no progress
// events, so there's nothing to report mid-flight. This walks through the actual algorithmic
// stages PCA and LDA go through on a fixed clock, purely so the user sees *what* the server
// is doing rather than a bare spinner. It loops back to the top if the request runs long
// (e.g. a cold Render instance waking up) instead of stalling on the last step.
type SimStepState = "done" | "active" | "upcoming";

const PCA_SIM_STEPS = [
  "Detecting numeric columns",
  "Centering & scaling data",
  "Computing covariance matrix",
  "Extracting eigenvectors",
  "Projecting onto PC1 / PC2",
];

const LDA_SIM_STEPS = [
  "Grouping rows by class label",
  "Computing within-class scatter",
  "Computing between-class scatter",
  "Solving the eigenproblem",
  "Validating on a held-out split",
];

// ---------- Animated "how it works" diagrams ----------
// Illustrative only — a fixed, hand-placed synthetic point cloud, not the user's actual
// data. Real PCA/LDA math runs server-side against the real dataset; these SVGs just act
// out the geometric idea (find a direction, project points onto it) on a loop using native
// SMIL animation, so no JS timers or extra renders are needed to drive them.
const PCA_POINTS: [number, number][] = [
  [120.7, 118.4], [116.6, 105.7], [82.2, 123.5], [188.3, 85.3], [183.4, 84.5],
  [150.9, 98.5], [52.7, 156.1], [158.6, 100.5], [33.9, 119.0], [82.5, 118.9],
  [144.9, 97.2], [151.6, 83.6], [148.1, 103.5], [108.7, 145.3], [165.8, 109.4], [94.1, 108.7],
];
const PCA_FEET: [number, number][] = [
  [117.2, 111.0], [118.7, 110.3], [83.7, 126.6], [185.4, 79.2], [181.7, 80.9],
  [149.7, 95.8], [46.9, 143.7], [155.2, 93.2], [45.7, 144.3], [85.7, 125.7],
  [145.2, 97.9], [155.9, 92.9], [145.4, 97.8], [97.1, 120.4], [157.7, 92.1], [99.1, 119.4],
];
const PCA_CENTROID = { x: 130, y: 105 };
const PCA_AXIS = { x1: 30.3, y1: 151.5, x2: 229.7, y2: 58.5 };
const PCA_AXIS2 = { x1: 113.1, y1: 68.7, x2: 146.9, y2: 141.3 };

function PCAAnimation() {
  const pivot = `${PCA_CENTROID.x} ${PCA_CENTROID.y}`;
  return (
    <svg
      viewBox="0 0 260 200"
      className="algo-anim-svg"
      role="img"
      aria-label="Animated illustration of PCA sweeping toward the direction of maximum variance, then projecting points onto it"
    >
      {/* PC2 — fades in once PC1 has settled */}
      <line
        x1={PCA_AXIS2.x1} y1={PCA_AXIS2.y1} x2={PCA_AXIS2.x2} y2={PCA_AXIS2.y2}
        stroke="var(--rule)" strokeWidth="1.4" strokeDasharray="3 3" opacity="0"
      >
        <animate attributeName="opacity" values="0;0;0.8;0.8;0" keyTimes="0;0.5;0.6;0.92;1" dur="8s" repeatCount="indefinite" />
      </line>

      {/* Faint projection guides from each point down to its spot on PC1 */}
      {PCA_POINTS.map(([x, y], i) => {
        const [fx, fy] = PCA_FEET[i];
        return (
          <line key={`g${i}`} x1={x} y1={y} x2={fx} y2={fy} stroke="var(--pine)" strokeWidth="0.8" strokeDasharray="2 2" opacity="0">
            <animate attributeName="opacity" values="0;0;0.45;0.45;0" keyTimes="0;0.45;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
          </line>
        );
      })}

      {/* PC1 — sweeps through a few candidate directions, settles on max-variance axis */}
      <line x1={PCA_AXIS.x1} y1={PCA_AXIS.y1} x2={PCA_AXIS.x2} y2={PCA_AXIS.y2} stroke="var(--pine)" strokeWidth="2.2" strokeLinecap="round">
        <animateTransform
          attributeName="transform" type="rotate"
          values={`70 ${pivot};-55 ${pivot};45 ${pivot};0 ${pivot};0 ${pivot}`}
          keyTimes="0;0.15;0.3;0.45;1" dur="8s" repeatCount="indefinite"
        />
      </line>

      {/* Original points — dim once they've "handed off" to the projected copy */}
      {PCA_POINTS.map(([x, y], i) => (
        <circle key={`p${i}`} cx={x} cy={y} r="3" fill="var(--ink-soft)">
          <animate attributeName="opacity" values="0.85;0.85;0.3;0.3;0.85" keyTimes="0;0.4;0.5;0.85;1" dur="8s" repeatCount="indefinite" />
        </circle>
      ))}

      {/* Projected copies — slide onto PC1 and back, showing the 2D→1D collapse */}
      {PCA_POINTS.map(([x, y], i) => {
        const [fx, fy] = PCA_FEET[i];
        return (
          <circle key={`m${i}`} r="3.2" fill="var(--pine)" opacity="0">
            <animate attributeName="cx" values={`${x};${x};${fx};${fx};${x}`} keyTimes="0;0.42;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
            <animate attributeName="cy" values={`${y};${y};${fy};${fy};${y}`} keyTimes="0;0.42;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.42;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
          </circle>
        );
      })}

      <circle cx={PCA_CENTROID.x} cy={PCA_CENTROID.y} r="2.2" fill="var(--ink)" />
    </svg>
  );
}

const LDA_A_POINTS: [number, number][] = [
  [83.4, 126.0], [101.9, 138.0], [85.3, 114.0], [73.4, 142.1], [72.1, 127.1],
  [106.0, 113.6], [84.7, 147.5], [49.9, 110.6], [91.7, 118.4],
];
const LDA_A_FEET: [number, number][] = [
  [83.5, 126.2], [91.5, 121.2], [90.2, 122.0], [69.1, 135.1], [74.8, 131.5],
  [105.4, 112.7], [74.8, 131.5], [66.1, 136.9], [92.9, 120.4],
];
const LDA_B_POINTS: [number, number][] = [
  [185.6, 72.9], [140.8, 69.9], [184.3, 87.5], [203.0, 85.6], [183.7, 53.8],
  [190.7, 66.6], [171.7, 50.0], [157.5, 55.7], [211.4, 53.0],
];
const LDA_B_FEET: [number, number][] = [
  [181.3, 65.9], [150.2, 85.1], [173.8, 70.5], [188.2, 61.6], [188.4, 61.5],
  [187.8, 61.9], [181.4, 65.8], [168.6, 73.7], [208.9, 48.9],
];
const LDA_PIVOT = { x: 132.1, y: 96.2 };
const LDA_AXIS = { x1: 46.9, y1: 148.7, x2: 217.2, y2: 43.8 };
const LDA_MEAN_A = { x: 83.2, y: 126.4 };
const LDA_MEAN_B = { x: 181.0, y: 66.1 };

function LDAAnimation() {
  const pivot = `${LDA_PIVOT.x} ${LDA_PIVOT.y}`;
  const renderClass = (points: [number, number][], feet: [number, number][], color: string, keyPrefix: string) => (
    <>
      {points.map(([x, y], i) => {
        const [fx, fy] = feet[i];
        return (
          <line key={`${keyPrefix}g${i}`} x1={x} y1={y} x2={fx} y2={fy} stroke={color} strokeWidth="0.8" strokeDasharray="2 2" opacity="0">
            <animate attributeName="opacity" values="0;0;0.45;0.45;0" keyTimes="0;0.45;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
          </line>
        );
      })}
      {points.map(([x, y], i) => (
        <circle key={`${keyPrefix}p${i}`} cx={x} cy={y} r="3" fill={color}>
          <animate attributeName="opacity" values="0.85;0.85;0.3;0.3;0.85" keyTimes="0;0.4;0.5;0.85;1" dur="8s" repeatCount="indefinite" />
        </circle>
      ))}
      {points.map(([x, y], i) => {
        const [fx, fy] = feet[i];
        return (
          <circle key={`${keyPrefix}m${i}`} r="3.2" fill={color} opacity="0">
            <animate attributeName="cx" values={`${x};${x};${fx};${fx};${x}`} keyTimes="0;0.42;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
            <animate attributeName="cy" values={`${y};${y};${fy};${fy};${y}`} keyTimes="0;0.42;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.42;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
          </circle>
        );
      })}
    </>
  );

  return (
    <svg
      viewBox="0 0 260 200"
      className="algo-anim-svg"
      role="img"
      aria-label="Animated illustration of LDA sweeping toward the axis that best separates two classes, then projecting points onto it"
    >
      {renderClass(LDA_A_POINTS, LDA_A_FEET, "var(--pine)", "a")}
      {renderClass(LDA_B_POINTS, LDA_B_FEET, "var(--clay)", "b")}

      {/* Class means */}
      <circle cx={LDA_MEAN_A.x} cy={LDA_MEAN_A.y} r="3.4" fill="none" stroke="var(--pine)" strokeWidth="1.6" />
      <circle cx={LDA_MEAN_B.x} cy={LDA_MEAN_B.y} r="3.4" fill="none" stroke="var(--clay)" strokeWidth="1.6" />

      {/* Discriminant axis — sweeps, then settles where class separation is greatest */}
      <line x1={LDA_AXIS.x1} y1={LDA_AXIS.y1} x2={LDA_AXIS.x2} y2={LDA_AXIS.y2} stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" opacity="0.75">
        <animateTransform
          attributeName="transform" type="rotate"
          values={`-80 ${pivot};60 ${pivot};-40 ${pivot};0 ${pivot};0 ${pivot}`}
          keyTimes="0;0.15;0.3;0.45;1" dur="8s" repeatCount="indefinite"
        />
      </line>
    </svg>
  );
}

function SimTrack({
  label,
  icon,
  accent,
  steps,
  activeIndex,
  animation,
}: {
  label: string;
  icon: React.ReactNode;
  accent: "pine" | "clay";
  steps: string[];
  activeIndex: number;
  animation?: React.ReactNode;
}) {
  return (
    <div className={`algo-sim-track accent-${accent}`}>
      <div className="algo-sim-track-head">
        <span className={`algo-icon ${accent} small`}>{icon}</span>
        <span className="algo-sim-track-title">{label}</span>
      </div>
      {animation && (
        <div className="algo-anim-wrap">
          {animation}
          <p className="algo-anim-caption">Illustrative example — not your actual data</p>
        </div>
      )}
      <ul className="algo-sim-steps">
        {steps.map((step, i) => {
          const state: SimStepState = i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
          return (
            <li key={step} className={`algo-sim-step ${state}`}>
              <span className="algo-sim-marker">
                {state === "done" ? <IconCheckCircle /> : <span className="algo-sim-dot" />}
              </span>
              <span className="algo-sim-step-label">{step}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Isolated into its own component with its own local state/timers on purpose — same fix as
// the Step4Offload white-screen bug: frequent interval-driven state updates need to live
// below the root App component, not on it, or a high update frequency can lock up the page.
function AlgorithmSimulation({ rowsHint }: { rowsHint?: number }) {
  const [pcaStep, setPcaStep] = useState(0);
  const [ldaStep, setLdaStep] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setPcaStep(0);
    setLdaStep(0);
    setElapsedMs(0);

    const pcaTimer = setInterval(() => {
      setPcaStep((s) => (s + 1) % PCA_SIM_STEPS.length);
    }, 900);
    const ldaTimer = setInterval(() => {
      setLdaStep((s) => (s + 1) % LDA_SIM_STEPS.length);
    }, 1050);
    const clockTimer = setInterval(() => {
      setElapsedMs(Date.now() - startRef.current);
    }, 100);

    return () => {
      clearInterval(pcaTimer);
      clearInterval(ldaTimer);
      clearInterval(clockTimer);
    };
  }, []);

  const slow = elapsedMs > 8000;

  return (
    <div className="algo-sim">
      <div className="algo-sim-clock">
        <span className="algo-sim-pulse" />
        <span>
          {formatDuration(elapsedMs)} elapsed{rowsHint ? ` · ${rowsHint} rows` : ""}
        </span>
      </div>
      <div className="algo-sim-tracks">
        <SimTrack
          label="PCA"
          icon={<IconSparkle />}
          accent="pine"
          steps={PCA_SIM_STEPS}
          activeIndex={pcaStep}
          animation={<PCAAnimation />}
        />
        <SimTrack
          label="LDA"
          icon={<IconTarget />}
          accent="clay"
          steps={LDA_SIM_STEPS}
          activeIndex={ldaStep}
          animation={<LDAAnimation />}
        />
      </div>
      <p className="meta small algo-sim-hint">
        {slow
          ? "Still working — free-tier Render backends can take 30–60s to wake up from a cold start."
          : "Running the real PCA/LDA pipeline on the server — this usually takes just a few seconds."}
      </p>
    </div>
  );
}

const NONE = "__none__";

function LdaScatter({
  scatter,
  classes,
  numericColumns,
  labelColumn,
  accuracy,
  ld1Ratio,
}: {
  scatter: ScatterPoint[];
  classes: string[];
  numericColumns: string[];
  labelColumn: string;
  accuracy: number | null;
  ld1Ratio?: number;
}) {
  const width = 560;
  const height = 300;
  const pad = 36;

  const xs = scatter.map((p) => p.x);
  const ys = scatter.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  const minY = yRange < 1e-6 ? -1 : Math.min(...ys);
  const maxY = yRange < 1e-6 ? 1 : Math.max(...ys);

  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;

  const toSvgX = (x: number) => pad + ((x - minX) / xSpan) * (width - pad * 2);
  const toSvgY = (y: number) => height - pad - ((y - minY) / ySpan) * (height - pad * 2);

  const colorFor = (cls: string) => CLASS_COLORS[classes.indexOf(cls) % CLASS_COLORS.length];

  return (
    <div className="analysis-panel">
      <p className="meta">
        Using <strong>{numericColumns.join(", ")}</strong>, LDA separates {classes.length} classes of{" "}
        <strong>{labelColumn}</strong>
        {accuracy !== null ? <> with {accuracy.toFixed(1)}% held-out accuracy</> : null}
        {ld1Ratio !== undefined ? (
          <>
            . LD1 alone captures {ld1Ratio.toFixed(1)}% of the between-class separation
          </>
        ) : null}
        .
      </p>

      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="scatter-svg">
          <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="scatter-axis" />
          <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="scatter-axis" />
          <text x={width / 2} y={height - 8} className="scatter-axis-label" textAnchor="middle">
            LD1
          </text>
          <text
            x={-height / 2}
            y={14}
            className="scatter-axis-label"
            textAnchor="middle"
            transform="rotate(-90)"
          >
            LD2
          </text>
          {scatter.map((p, i) => (
            <circle
              key={i}
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={4}
              fill={colorFor(p.class)}
              fillOpacity={0.75}
              stroke="#fff"
              strokeWidth={0.5}
            />
          ))}
        </svg>
      </div>

      <div className="scatter-legend">
        {classes.map((c) => (
          <span className="legend-item" key={c}>
            <span className="legend-swatch" style={{ background: colorFor(c) }} />
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceAxisMax(maxValue: number): number {
  if (maxValue <= 0) return 10;
  const rawMax = maxValue * 1.15;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const residual = rawMax / magnitude;
  let niceResidual: number;
  if (residual > 5) niceResidual = 10;
  else if (residual > 2) niceResidual = 5;
  else if (residual > 1) niceResidual = 2;
  else niceResidual = 1;
  return niceResidual * magnitude;
}

function VerticalBarChart({
  components,
  barColor,
  barColorAlt,
}: {
  components: { label: string; ratio: number }[];
  barColor: string;
  barColorAlt: string;
}) {
  const width = 300;
  const height = 200;
  const padLeft = 38;
  const padBottom = 26;
  const padTop = 14;
  const chartHeight = height - padTop - padBottom;
  const chartWidth = width - padLeft - 12;

  const maxRatio = Math.max(...components.map((c) => c.ratio), 1);
  const axisMax = niceAxisMax(maxRatio);
  const ticks = [0, axisMax / 4, axisMax / 2, (axisMax * 3) / 4, axisMax];

  const barSlot = chartWidth / components.length;
  const barWidth = barSlot * 0.55;

  const toY = (v: number) => padTop + chartHeight - (v / axisMax) * chartHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padLeft}
            x2={width - 8}
            y1={toY(t)}
            y2={toY(t)}
            stroke="#dde1d5"
            strokeDasharray="2,2"
          />
          <text x={padLeft - 6} y={toY(t) + 3} textAnchor="end" fontSize="9" fill="#5B6459" fontFamily="IBM Plex Mono, monospace">
            {Math.round(t)}%
          </text>
        </g>
      ))}
      <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + chartHeight} stroke="#C3CBBB" />
      <line x1={padLeft} x2={width - 8} y1={padTop + chartHeight} y2={padTop + chartHeight} stroke="#C3CBBB" />
      {components.map((c, i) => {
        const barH = (c.ratio / axisMax) * chartHeight;
        const x = padLeft + i * barSlot + (barSlot - barWidth) / 2;
        const y = padTop + chartHeight - barH;
        const fill = i === 0 ? barColor : barColorAlt;
        return (
          <g key={c.label}>
            <title>{`${c.label}: ${c.ratio.toFixed(1)}%`}</title>
            <rect x={x} y={y} width={barWidth} height={Math.max(barH, 1)} rx={3} fill={fill} />
            <text x={x + barWidth / 2} y={padTop + chartHeight + 16} textAnchor="middle" fontSize="10" fill="#1C2621" fontFamily="Inter, sans-serif">
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PcaLdaDashboard({
  pcaComponents,
  ldaComponents,
  ldaAccuracy,
  ldaClasses,
}: {
  pcaComponents: AlgorithmComponent[];
  ldaComponents: AlgorithmComponent[];
  ldaAccuracy: number | null;
  ldaClasses: number;
}) {
  const pcaTotal = pcaComponents.reduce((s, c) => s + c.ratio, 0);
  const ldaTotal = ldaComponents.reduce((s, c) => s + c.ratio, 0);

  return (
    <div className="pca-lda-dashboard">
      <h3 className="pca-lda-heading">
        <IconSparkle /> PCA &amp; LDA Analysis
      </h3>

      <div className="pca-lda-stats-grid">
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">PCA total variance</span>
          <span className="pca-lda-stat-value pine">{pcaTotal.toFixed(1)}%</span>
        </div>
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">LDA total variance</span>
          <span className="pca-lda-stat-value clay">{ldaTotal.toFixed(1)}%</span>
        </div>
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">LDA VARIANCE</span>
          <span className="pca-lda-stat-value clay">{ldaAccuracy !== null ? `${ldaAccuracy.toFixed(1)}%` : "—"}</span>
        </div>
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">LDA classes</span>
          <span className="pca-lda-stat-value">{ldaClasses}</span>
        </div>
      </div>

      <div className="pca-lda-charts-grid">
        <div className="pca-lda-chart-card">
          <h4>PCA Explained Variance</h4>
          <VerticalBarChart components={pcaComponents} barColor="#35604A" barColorAlt="#8fb5a2" />
        </div>
        <div className="pca-lda-chart-card">
          <h4>LDA Explained Variance</h4>
          <VerticalBarChart components={ldaComponents} barColor="#C4531D" barColorAlt="#e0a578" />
        </div>
      </div>
    </div>
  );
}

type Severity = "good" | "moderate" | "attention" | "neutral";

function SeverityBadge({ severity, label }: { severity: Severity; label?: string }) {
  const text = label ?? (severity === "good" ? "Good" : severity === "moderate" ? "Moderate" : severity === "attention" ? "Needs Attention" : "—");
  return <span className={`severity-badge ${severity}`}>{text}</span>;
}

function InterpretationCard({
  icon,
  title,
  severity,
  severityLabel,
  headline,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  severity: Severity;
  severityLabel?: string;
  headline: string;
  detail: string;
}) {
  return (
    <div className="interp-card">
      <div className="interp-card-head">
        <span className="interp-icon">{icon}</span>
        <span className="interp-title">{title}</span>
        <SeverityBadge severity={severity} label={severityLabel} />
      </div>
      <p className="interp-headline">{headline}</p>
      <p className="interp-detail">{detail}</p>
    </div>
  );
}

function PcaScatter({ scores }: { scores: number[][] }) {
  const width = 560;
  const height = 300;
  const pad = 36;

  const xs = scores.map((s) => s[0]);
  const ys = scores.map((s) => s[1] ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;

  const toSvgX = (x: number) => pad + ((x - minX) / xSpan) * (width - pad * 2);
  const toSvgY = (y: number) => height - pad - ((y - minY) / ySpan) * (height - pad * 2);

  return (
    <div className="scatter-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="scatter-svg">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="scatter-axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="scatter-axis" />
        <text x={width / 2} y={height - 8} className="scatter-axis-label" textAnchor="middle">
          PC1
        </text>
        <text x={-height / 2} y={14} className="scatter-axis-label" textAnchor="middle" transform="rotate(-90)">
          PC2
        </text>
        {scores.map((s, i) => (
          <circle
            key={i}
            cx={toSvgX(s[0])}
            cy={toSvgY(s[1] ?? 0)}
            r={4}
            fill="#35604A"
            fillOpacity={0.65}
            stroke="#fff"
            strokeWidth={0.5}
          />
        ))}
      </svg>
    </div>
  );
}

function ComparisonTable({
  pcaTotal,
  ldaTotal,
  pc1Ratio,
  ld1Ratio,
  pcaComponentCount,
  ldaComponentCount,
}: {
  pcaTotal: number;
  ldaTotal: number;
  pc1Ratio: number;
  ld1Ratio: number;
  pcaComponentCount: number;
  ldaComponentCount: number;
}) {
  const rows: { metric: string; pca: string; lda: string; description: string }[] = [
    {
      metric: "Algorithm Type",
      pca: "Unsupervised",
      lda: "Supervised",
      description: "PCA ignores class labels; LDA uses them to maximize class separation.",
    },
    {
      metric: "Components Extracted",
      pca: String(pcaComponentCount),
      lda: String(ldaComponentCount),
      description: "Number of new axes (dimensions) produced by each algorithm.",
    },
    {
      metric: "Total Variance Explained",
      pca: `${pcaTotal.toFixed(2)}%`,
      lda: `${ldaTotal.toFixed(2)}%`,
      description: "Sum of variance captured across all retained components.",
    },
    {
      metric: "Dominant Component (1st axis)",
      pca: `${pc1Ratio.toFixed(2)}%`,
      lda: `${ld1Ratio.toFixed(2)}%`,
      description: "Variance carried by the strongest single component.",
    },
    {
      metric: "Reconstruction / PCA Accuracy",
      pca: `${pcaTotal.toFixed(2)}%`,
      lda: "—",
      description: "How much of the original data PCA can rebuild from the chosen components.",
    },
  ];

  return (
    <div className="comparison-table-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="pca-col">PCA</th>
            <th className="lda-col">LDA</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric}>
              <td>{r.metric}</td>
              <td className="pca-col">{r.pca}</td>
              <td className="lda-col">{r.lda}</td>
              <td className="comparison-desc">{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getAnalysisData(algoResult: AlgorithmsResponse) {
  const pcaComponents = algoResult.pca.components;
  const ldaComponents = algoResult.lda.components;
  const pcaTotal = pcaComponents.reduce((s, c) => s + c.ratio, 0);
  const ldaTotal = ldaComponents.reduce((s, c) => s + c.ratio, 0);
  const pc1Ratio = pcaComponents[0]?.ratio ?? 0;
  const ld1Ratio = ldaComponents[0]?.ratio ?? 0;
  const ldaAccuracy = algoResult.lda.accuracy;

  const retentionSeverity: Severity = pcaTotal >= 80 ? "good" : pcaTotal >= 50 ? "moderate" : "attention";
  const retentionHeadline =
    retentionSeverity === "good"
      ? `PCA retains ${pcaTotal.toFixed(1)}% — strong retention.`
      : retentionSeverity === "moderate"
      ? `PCA retains ${pcaTotal.toFixed(1)}% — moderate retention, some patterns may be diluted.`
      : `PCA retains only ${pcaTotal.toFixed(1)}% — low retention detected.`;
  const retentionDetail =
    "Variance retention measures how much of the original dataset's information is preserved after dimensionality reduction. PCA transforms high-dimensional data into a smaller set of uncorrelated components ranked by the amount of variance they capture. Retention above 80% means the reduced representation closely mirrors the original data structure with minimal information loss. Between 50–80%, some patterns may be diluted — consider retaining additional components. Below 50%, the data has high intrinsic dimensionality that 2 components alone can't fully capture.";

  const reconSeverity: Severity = pcaTotal >= 80 ? "good" : pcaTotal >= 60 ? "moderate" : "attention";
  const reconHeadline =
    reconSeverity === "good"
      ? `${pcaTotal.toFixed(1)}% reconstruction accuracy — faithful summary.`
      : reconSeverity === "moderate"
      ? `${pcaTotal.toFixed(1)}% reconstruction accuracy — acceptable for exploration.`
      : `${pcaTotal.toFixed(1)}% reconstruction accuracy — significant loss.`;
  const reconDetail =
    "PCA accuracy here means reconstruction accuracy — the cumulative percentage of variance recovered when the data is rebuilt from the selected principal components. Above 80% indicates the projection is a faithful summary of the data; between 60–80% is acceptable for exploration but may hide subtle patterns; below 60% indicates the original data is too complex to represent in only 2 components.";

  const sepSeverity: Severity = ldaAccuracy === null ? "neutral" : ldaAccuracy >= 85 ? "good" : ldaAccuracy >= 70 ? "moderate" : "attention";
  const sepHeadline =
    ldaAccuracy === null
      ? "Accuracy not available — too few rows were held out to measure this reliably."
      : sepSeverity === "good"
      ? `${ldaAccuracy.toFixed(1)}% accuracy — strong class separation.`
      : sepSeverity === "moderate"
      ? `${ldaAccuracy.toFixed(1)}% accuracy — partial overlap between classes.`
      : `${ldaAccuracy.toFixed(1)}% accuracy — classes are poorly separated.`;
  const sepDetail =
    "Class separability quantifies how well LDA can distinguish between predefined classes. Unlike PCA, which is unsupervised, LDA uses class labels to find linear combinations of features that maximize the ratio of between-class variance to within-class variance. Accuracy above 85% indicates clear, well-separated clusters. Between 70–85%, there's partial overlap between classes. Below 70%, the classes are poorly separated by the features available.";

  const domSeverity: Severity = "neutral";
  const domLabel = pc1Ratio >= 50 ? "Concentrated" : "Distributed";
  const domHeadline =
    pc1Ratio >= 50
      ? `PC1 explains ${pc1Ratio.toFixed(1)}% — a single strong pattern governs the data.`
      : `PC1 explains ${pc1Ratio.toFixed(1)}% — variance is distributed across components.`;
  const domDetail =
    "Dominant component analysis examines how much variance the first principal component (PC1) captures relative to the total. When PC1 explains more than 50%, it indicates a single strong underlying pattern governs the data. When PC1 explains less than 50%, the data exhibits multidimensional complexity with several independent sources of variation contributing roughly equally.";

  return {
    pcaComponents,
    ldaComponents,
    pcaTotal,
    ldaTotal,
    pc1Ratio,
    ld1Ratio,
    ldaAccuracy,
    retentionSeverity,
    retentionHeadline,
    retentionDetail,
    reconSeverity,
    reconHeadline,
    reconDetail,
    sepSeverity,
    sepHeadline,
    sepDetail,
    domSeverity,
    domLabel,
    domHeadline,
    domDetail,
  };
}

// Two side-by-side tables: ALL of the originally uploaded data, and the (possibly filtered)
// subset PCA/LDA actually ran on with the resulting PC1/PC2/LD1/LD2 columns appended — so the
// effect of "applying the algorithms" is visible as actual data, not just summary stats/charts.
//
// These two tables intentionally do NOT show the same row count when a filter was applied
// upstream of running the algorithms: "Before" is fetched fresh via /api/full-data with no
// filters, so it always reflects the complete active dataset (everything uploaded, minus only
// exact duplicates dedup already removed) — e.g. 10,000 rows. "After" comes straight from the
// /api/apply-algorithms response already in memory (algoResult.rows), which is whatever subset a
// filter narrowed things down to before the algorithms ran — e.g. 1,215 rows. Comparing the two
// is the point: it shows how much a filter reduced the dataset before PCA/LDA ever saw it.
//
// "Before" always renders every row it fetches — it's plain data with no derived values to
// compute per row, so there's no reason to hide any of it behind pagination; the scrollable
// container just lets a long table scroll internally instead of stretching the page. "After"
// stays paginated, since each visible row there also does a small amount of per-row work
// (zipping in PCA/LDA output) that's cheap for 50 rows but wasteful to redo for thousands at once.
const BEFORE_AFTER_PAGE_SIZE = 50;
// Large enough to fetch the whole active dataset in one request for any realistically-sized
// upload (matches the backend's own /api/full-data hard cap).
const BEFORE_TABLE_FETCH_LIMIT = 20000;

function BeforeAfterTables({ algoResult, fileId }: { algoResult: AlgorithmsResponse; fileId: string }) {
  const [afterVisibleCount, setAfterVisibleCount] = useState(BEFORE_AFTER_PAGE_SIZE);
  const [beforeData, setBeforeData] = useState<{ columns: string[]; rows: FullDataRow[]; rowCount: number } | null>(
    null
  );
  const [beforeStatus, setBeforeStatus] = useState<"loading" | "idle" | "error">("loading");
  const [beforeError, setBeforeError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadBefore() {
      setBeforeStatus("loading");
      setBeforeError("");
      try {
        const res = await fetch(`${API_BASE}/full-data`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId, limit: BEFORE_TABLE_FETCH_LIMIT }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load the original data.");
        if (!cancelled) {
          setBeforeData({ columns: data.columns, rows: data.rows, rowCount: data.rowCount });
          setBeforeStatus("idle");
        }
      } catch (err) {
        if (!cancelled) {
          setBeforeStatus("error");
          setBeforeError(err instanceof Error ? err.message : "Could not load the original data.");
        }
      }
    }
    loadBefore();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const afterRows = algoResult.rows;
  const originalColumns = afterRows.length > 0 ? Object.keys(afterRows[0]) : [];
  const afterColumns = [...originalColumns, ...algoResult.pca.columnNames, ...algoResult.lda.columnNames];
  const afterVisibleRows = afterRows.slice(0, afterVisibleCount);

  if (afterRows.length === 0) return null;

  return (
    <div className="before-after-section">
      <div className="section-head">
        <h2>Before &amp; After</h2>
        <span className="section-tag">
          {afterRows.length.toLocaleString()} row{afterRows.length === 1 ? "" : "s"} used for PCA/LDA
        </span>
      </div>
      <p className="meta">
        All of the originally uploaded data, and the rows PCA/LDA actually ran on with the resulting component
        columns appended.
      </p>

      <div className="before-after-grid">
        <div className="before-after-col">
          <p className="before-after-label">
            Before — original data
            {beforeData && ` (${beforeData.rowCount.toLocaleString()} rows)`}
          </p>
          {beforeStatus === "loading" && <p className="status">Loading the original data…</p>}
          {beforeStatus === "error" && <p className="status error">{beforeError}</p>}
          {beforeData && beforeStatus === "idle" && (
            <div className="preview-wrap preview-wrap-scroll">
              <table className="preview">
                <thead>
                  <tr>
                    {beforeData.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {beforeData.rows.map((row) => (
                    <tr key={row.index}>
                      {beforeData.columns.map((c) => (
                        <td key={c}>{String(row.data[c] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="before-after-col">
          <p className="before-after-label">After — PCA/LDA output appended</p>
          <div className="preview-wrap preview-wrap-scroll">
            <table className="preview">
              <thead>
                <tr>
                  {afterColumns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {afterVisibleRows.map((row, i) => {
                  const pcaVals = algoResult.pca.scores[i] ?? [];
                  const ldaPoint = algoResult.lda.scatter[i];
                  // LD1 = scatter.x always; LD2 (if a second LDA component exists) = scatter.y.
                  const ldaVals = algoResult.lda.columnNames.map((_, j) => (j === 0 ? ldaPoint?.x : ldaPoint?.y));
                  return (
                    <tr key={i}>
                      {originalColumns.map((c) => (
                        <td key={c}>{String(row[c] ?? "")}</td>
                      ))}
                      {algoResult.pca.columnNames.map((name, j) => (
                        <td key={name} className="cell-derived">
                          {pcaVals[j] !== undefined ? pcaVals[j].toFixed(3) : ""}
                        </td>
                      ))}
                      {algoResult.lda.columnNames.map((name, j) => (
                        <td key={name} className="cell-derived">
                          {ldaVals[j] !== undefined ? (ldaVals[j] as number).toFixed(3) : ""}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {afterRows.length > afterVisibleCount && (
            <div className="preview-pagination">
              <span className="preview-pagination-count">
                Showing {afterVisibleRows.length.toLocaleString()} of {afterRows.length.toLocaleString()} rows
              </span>
              <button
                type="button"
                className="secondary small"
                onClick={() => setAfterVisibleCount((n) => Math.min(afterRows.length, n + BEFORE_AFTER_PAGE_SIZE))}
              >
                Show {Math.min(BEFORE_AFTER_PAGE_SIZE, afterRows.length - afterVisibleCount)} more
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VisualizeAnalysisSection({ algoResult }: { algoResult: AlgorithmsResponse }) {
  const d = getAnalysisData(algoResult);

  return (
    <div className="visualize-analysis">
      <div className="va-header">
        <span className="va-header-icon">
          <IconEye />
        </span>
        <div>
          <h2 className="va-title">Visualize &amp; Analysis</h2>
          <p className="meta">2D scatter plots, variance analysis, and detailed interpretation.</p>
        </div>
      </div>

      <h3 className="va-section-heading">
        <IconSparkle /> Data Interpretation
      </h3>

      <div className="pca-lda-stats-grid va-top-stats">
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">Datasets</span>
          <span className="pca-lda-stat-value">1</span>
        </div>
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">PCA variance</span>
          <span className="pca-lda-stat-value pine">{d.pcaTotal.toFixed(1)}%</span>
        </div>
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">PCA accuracy</span>
          <span className="pca-lda-stat-value pine">{d.pcaTotal.toFixed(1)}%</span>
        </div>
        <div className="pca-lda-stat">
          <span className="pca-lda-stat-label">LDA VARIANCE</span>
          <span className="pca-lda-stat-value clay">{d.ldaAccuracy !== null ? `${d.ldaAccuracy.toFixed(1)}%` : "—"}</span>
        </div>
      </div>

      <div className="interp-grid">
        <InterpretationCard
          icon={<IconSparkle />}
          title="Variance Retention"
          severity={d.retentionSeverity}
          headline={d.retentionHeadline}
          detail={d.retentionDetail}
        />
        <InterpretationCard
          icon={<IconTarget />}
          title="PCA Accuracy (Reconstruction)"
          severity={d.reconSeverity}
          headline={d.reconHeadline}
          detail={d.reconDetail}
        />
        <InterpretationCard
          icon={<IconTarget />}
          title="Class Separability (LDA)"
          severity={d.sepSeverity}
          headline={d.sepHeadline}
          detail={d.sepDetail}
        />
        <InterpretationCard
          icon={<IconSparkle />}
          title="Dominant Component"
          severity={d.domSeverity}
          severityLabel={d.domLabel}
          headline={d.domHeadline}
          detail={d.domDetail}
        />
      </div>

      <h3 className="va-section-heading">
        <IconEye /> Data Visualization
      </h3>

      <div className="va-viz-grid">
        <div className="va-viz-card">
          <p className="va-viz-title">
            <span className="legend-swatch" style={{ background: "#35604A" }} /> PCA — 2D Projection
          </p>
          <p className="va-viz-callout">
            The PCA 2D Projection plots each record onto the two strongest principal components (PC1 horizontal, PC2
            vertical) — the directions that capture the most variance. Points close together share similar feature
            patterns; points far apart are most different. This view reveals natural clusters, outliers, and the
            overall shape of the data <strong>without</strong> using any class labels.
          </p>
          <PcaScatter scores={algoResult.pca.scores} />
        </div>
        <div className="va-viz-card">
          <p className="va-viz-title">
            <span className="legend-swatch" style={{ background: "#7A5FA0" }} /> LDA — 2D Projection
          </p>
          <p className="va-viz-callout">
            The LDA 2D Projection plots each record onto the two strongest discriminant axes (LD1 horizontal, LD2
            vertical) — directions chosen to <strong>maximize separation between classes</strong> and minimize
            variation within each class. Tight, well-separated groups indicate the features distinguish the classes
            effectively; overlapping points indicate weak class boundaries.
          </p>
          <LdaScatter
            scatter={algoResult.lda.scatter}
            classes={algoResult.lda.classes}
            numericColumns={algoResult.numericColumns}
            labelColumn={algoResult.lda.labelColumn}
            accuracy={algoResult.lda.accuracy}
            ld1Ratio={d.ld1Ratio}
          />
        </div>
      </div>

      <PcaLdaDashboard
        pcaComponents={d.pcaComponents}
        ldaComponents={d.ldaComponents}
        ldaAccuracy={d.ldaAccuracy}
        ldaClasses={algoResult.lda.classes.length}
      />

      <h3 className="va-section-heading">Detailed Comparison Summary</h3>
      <p className="meta" style={{ marginBottom: 10 }}>
        Side-by-side comparison of every metric produced by both algorithms, including components, total variance,
        dominant axis, PCA reconstruction accuracy, and LDA class accuracy.
      </p>
      <ComparisonTable
        pcaTotal={d.pcaTotal}
        ldaTotal={d.ldaTotal}
        pc1Ratio={d.pc1Ratio}
        ld1Ratio={d.ld1Ratio}
        pcaComponentCount={d.pcaComponents.length}
        ldaComponentCount={d.ldaComponents.length}
      />
    </div>
  );
}

function ReportSection({ algoResult }: { algoResult: AlgorithmsResponse }) {
  const d = getAnalysisData(algoResult);

  return (
    <div className="visualize-analysis">
      <div className="va-header">
        <span className="va-header-icon">
          <IconDocument />
        </span>
        <div>
          <h2 className="va-title">Report</h2>
          <p className="meta">A written summary of everything found above.</p>
        </div>
      </div>

      <div className="report-text">
        <p>
          This dataset was analyzed using <strong>{algoResult.numericColumns.join(", ")}</strong> as the numeric
          features. <strong>PCA</strong> (unsupervised) retained {d.pcaTotal.toFixed(1)}% of total variance across{" "}
          {d.pcaComponents.length} components, with PC1 alone accounting for {d.pc1Ratio.toFixed(1)}% —{" "}
          {d.pc1Ratio >= 50
            ? "meaning a single dominant pattern drives most of the variation in this data."
            : "meaning variation is spread fairly evenly across multiple underlying patterns rather than one dominant axis."}
        </p>
        <p>
          <strong>LDA</strong> (supervised), using <strong>{algoResult.lda.labelColumn}</strong> as the class label
          across {algoResult.lda.classes.length} classes, achieved{" "}
          {d.ldaAccuracy !== null ? (
            <>
              {d.ldaAccuracy.toFixed(1)}% held-out classification accuracy
              {algoResult.lda.testSetSize < 5 ? " (measured on a very small held-out set, so treat this as indicative rather than definitive)" : ""}
            </>
          ) : (
            "no measurable held-out accuracy, since too few rows were available to hold out a reliable test set"
          )}
          , with LD1 capturing {d.ld1Ratio.toFixed(1)}% of the between-class separation.
        </p>
        <p>
          Overall,{" "}
          {d.retentionSeverity === "good" && d.sepSeverity === "good"
            ? "both the unsupervised structure (PCA) and the class-driven structure (LDA) are well captured in just two dimensions — this is a strong candidate for 2D visualization and downstream modeling."
            : d.retentionSeverity === "attention" && d.sepSeverity !== "attention"
            ? "while PCA alone loses a fair amount of the original variance in 2 dimensions, the class labels give LDA meaningfully more to work with — the class structure is clearer than the raw variance structure."
            : d.sepSeverity === "attention"
            ? `the classes in ${algoResult.lda.labelColumn} are not cleanly separated by ${algoResult.numericColumns.join(", ")} alone — consider whether additional or different features might better distinguish these groups.`
            : "the two methods offer complementary views: PCA shows the natural shape of the data, while LDA highlights how well the current features distinguish the chosen classes."}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [fileInfo, setFileInfo] = useState<UploadResponse | null>(null);

  // One or more column = value conditions, combined with AND (e.g. Gender = Male AND
  // Location = Laguna). `column` is NONE until the user picks one; `value` is "" until chosen.
  type FilterCondition = { id: string; column: string; value: string };
  const makeEmptyCondition = (): FilterCondition => ({ id: crypto.randomUUID(), column: NONE, value: "" });
  const [filters, setFilters] = useState<FilterCondition[]>([makeEmptyCondition()]);

  // Only the fully-filled-in conditions (column chosen + value chosen) count as "active" and
  // get sent to the backend — a half-filled row being edited shouldn't block anything.
  const activeFilters = filters.filter((f) => f.column !== NONE && f.value !== "");
  const filterColumns = activeFilters.map((f) => f.column);
  // A row where a column was picked but no value yet — shouldn't silently be dropped from export.
  const hasIncompleteFilter = filters.some((f) => f.column !== NONE && f.value === "");

  function updateFilterCondition(id: string, patch: Partial<FilterCondition>) {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setFilteredCount(null);
    setExcludedCount(null);
    setFilterHistoryOpen(false);
    setFilterError("");
    setSortPreviewPoints(null);
    setSortPreviewMeta(null);
    setFilteredPreviewOpen(false);
    setFilteredRowsData(null);
  }

  function addFilterCondition() {
    setFilters((prev) => [...prev, makeEmptyCondition()]);
  }

  function removeFilterCondition(id: string) {
    setFilters((prev) => {
      const next = prev.filter((f) => f.id !== id);
      return next.length > 0 ? next : [makeEmptyCondition()];
    });
    setFilteredCount(null);
    setExcludedCount(null);
    setFilterHistoryOpen(false);
    setFilterError("");
    setSortPreviewPoints(null);
    setSortPreviewMeta(null);
    setFilteredPreviewOpen(false);
    setFilteredRowsData(null);
  }

  const [sortColumn, setSortColumn] = useState<string>(NONE);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [status, setStatus] = useState<"idle" | "uploading" | "sorting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [proceeded, setProceeded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  // Rows the current filter excludes (after folding in any restored/"kept" overrides) — comes
  // back from /api/filter-count alongside rowCount. Drives the "Review excluded rows" button.
  const [excludedCount, setExcludedCount] = useState<number | null>(null);
  const [filterHistoryOpen, setFilterHistoryOpen] = useState(false);
  // PDF-only: whether to append the removed/excluded-rows history (dedup + filter) as extra
  // tables at the end of the downloaded PDF.
  const [includeRemovedRows, setIncludeRemovedRows] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"idle" | "checking" | "error">("idle");
  const [filterError, setFilterError] = useState<string>("");

  // "Review filtered rows" panel: shows the ACTUAL rows a filter kept (not just the count from
  // /api/filter-count), reusing the same paginated /api/full-data endpoint the "Preview Dataset"
  // panel uses, just with the active filters passed through. Kept as its own state (rather than
  // reusing `fullData`) so opening one panel never clobbers the other.
  const [filteredPreviewOpen, setFilteredPreviewOpen] = useState(false);
  const [filteredRowsData, setFilteredRowsData] = useState<FullDataResponse | null>(null);
  const [filteredRowsStatus, setFilteredRowsStatus] = useState<"idle" | "loading" | "error">("idle");
  const [filteredRowsError, setFilteredRowsError] = useState<string>("");
  const [filteredRowsLoadingMore, setFilteredRowsLoadingMore] = useState(false);

  async function applyFilter() {
    if (!fileInfo || activeFilters.length === 0) return;
    setFilterStatus("checking");
    setFilterError("");
    try {
      const res = await fetch(`${API_BASE}/filter-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: fileInfo.fileId,
          filters: activeFilters.map(({ column, value }) => ({ column, value })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not apply filter.");
      }
      setFilteredCount(data.rowCount);
      setExcludedCount(typeof data.excludedCount === "number" ? data.excludedCount : null);
      setFilterStatus("idle");
    } catch (err) {
      setFilterStatus("error");
      setFilterError(err instanceof Error ? err.message : "Could not apply filter.");
    }
  }

  type SortPoint = { label: string; value: number };
  const [sortPreviewPoints, setSortPreviewPoints] = useState<SortPoint[] | null>(null);
  const [sortPreviewIsNumeric, setSortPreviewIsNumeric] = useState(true);
  const [, setSortPreviewMeta] = useState<{ rowCount: number; sampled: boolean } | null>(null);
  const [sortPreviewStatus, setSortPreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [sortPreviewError, setSortPreviewError] = useState<string>("");
  const [sortPreviewSummary, setSortPreviewSummary] = useState<SortSummary | null>(null);

  async function runSortPreview() {
    if (!fileInfo || sortColumn === NONE) return;
    setSortPreviewStatus("loading");
    setSortPreviewError("");
    try {
      const res = await fetch(`${API_BASE}/sort-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: fileInfo.fileId,
          sortColumn,
          sortOrder,
          filters: activeFilters.length > 0 ? activeFilters.map(({ column, value }) => ({ column, value })) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not build the sort graph.");
      }
      setSortPreviewPoints(data.points);
      setSortPreviewIsNumeric(data.isNumeric);
      setSortPreviewMeta({ rowCount: data.rowCount, sampled: data.sampled });
      const summary: SortSummary | null = data.summary ?? null;
      setSortPreviewSummary(summary);
      setSortPreviewStatus("idle");
    } catch (err) {
      setSortPreviewStatus("error");
      setSortPreviewError(err instanceof Error ? err.message : "Could not build the sort graph.");
    }
  }

  function clearFilter() {
    setFilters([makeEmptyCondition()]);
    setFilteredCount(null);
    setExcludedCount(null);
    setFilterHistoryOpen(false);
    setFilterStatus("idle");
    setFilterError("");
    setSortPreviewPoints(null);
    setSortPreviewMeta(null);
    setFilteredPreviewOpen(false);
    setFilteredRowsData(null);
  }

  const [algoOpen, setAlgoOpen] = useState(false);
  const [showSimModule, setShowSimModule] = useState(false);
  const [labelColumn, setLabelColumn] = useState<string>(NONE);
  const [algoStatus, setAlgoStatus] = useState<"idle" | "running" | "error">("idle");
  const [algoError, setAlgoError] = useState<string>("");
  const [algoResult, setAlgoResult] = useState<AlgorithmsResponse | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<"xlsx" | "pdf" | null>(null);
  const [currentStep, setCurrentStep] = useState(1);

  // Start/End Time + Process Duration — timed client-side around the whole upload/import
  // pipeline (network + parsing), not just server-side parse time like fileInfo.runtimeMs.
  const [processStartTime, setProcessStartTime] = useState<number | null>(null);
  const [processEndTime, setProcessEndTime] = useState<number | null>(null);

  // Full dataset preview (every uploaded record, with missing-value detection), loaded on
  // demand when the user opens the preview panel — the upload response itself only carries
  // a 5-row sample to keep that payload small.
  const [fullData, setFullData] = useState<FullDataResponse | null>(null);
  const [fullDataStatus, setFullDataStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fullDataError, setFullDataError] = useState<string>("");
  const [fullDataLoadingMore, setFullDataLoadingMore] = useState(false);

  // Duplicate Records History — reviewing/keeping/deleting exact-duplicate rows found on upload.
  const [dupHistoryOpen, setDupHistoryOpen] = useState(false);

  async function runAlgorithmsRequest() {
    if (!fileInfo || labelColumn === NONE) return;
    setAlgoStatus("running");
    setAlgoError("");
    setAlgoResult(null);
    try {
      const res = await fetch(`${API_BASE}/apply-algorithms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: fileInfo.fileId,
          labelColumn,
          filters: activeFilters.length > 0 ? activeFilters.map(({ column, value }) => ({ column, value })) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not run algorithms.");
      }
      setAlgoResult(data);
      setAlgoStatus("idle");
    } catch (err) {
      setAlgoStatus("error");
      setAlgoError(err instanceof Error ? err.message : "Could not run algorithms.");
    }
  }

  function resetAlgorithms() {
    setAlgoOpen(false);
    setLabelColumn(NONE);
    setAlgoStatus("idle");
    setAlgoError("");
    if (fileInfo && !fileInfo.columns.includes(sortColumn) && sortColumn !== NONE) {
      setSortColumn(NONE);
    }
    setAlgoResult(null);
    setDownloaded(false);
  }

  const FULL_DATA_PAGE_SIZE = 2000;

  async function loadFullPreview(append = false) {
    if (!fileInfo) return;
    const offset = append && fullData ? fullData.rows.length : 0;
    setFullDataStatus(append ? "idle" : "loading");
    if (append) setFullDataLoadingMore(true);
    setFullDataError("");
    try {
      const res = await fetch(`${API_BASE}/full-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: fileInfo.fileId, offset, limit: FULL_DATA_PAGE_SIZE }),
      });
      const data: FullDataResponse = await res.json();
      if (!res.ok) {
        throw new Error((data as unknown as { error?: string }).error || "Could not load the dataset preview.");
      }
      setFullData((prev) =>
        append && prev ? { ...data, rows: [...prev.rows, ...data.rows] } : data
      );
      setFullDataStatus("idle");
    } catch (err) {
      setFullDataStatus("error");
      setFullDataError(err instanceof Error ? err.message : "Could not load the dataset preview.");
    } finally {
      setFullDataLoadingMore(false);
    }
  }

  function togglePreview() {
    setPreviewOpen((v) => {
      const next = !v;
      if (next && !fullData && fullDataStatus !== "loading") {
        loadFullPreview();
      }
      return next;
    });
  }

  async function loadFilteredRows(append = false) {
    if (!fileInfo || activeFilters.length === 0) return;
    const offset = append && filteredRowsData ? filteredRowsData.rows.length : 0;
    setFilteredRowsStatus(append ? "idle" : "loading");
    if (append) setFilteredRowsLoadingMore(true);
    setFilteredRowsError("");
    try {
      const res = await fetch(`${API_BASE}/full-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: fileInfo.fileId,
          offset,
          limit: FULL_DATA_PAGE_SIZE,
          filters: activeFilters.map(({ column, value }) => ({ column, value })),
        }),
      });
      const data: FullDataResponse = await res.json();
      if (!res.ok) {
        throw new Error((data as unknown as { error?: string }).error || "Could not load the filtered rows.");
      }
      setFilteredRowsData((prev) =>
        append && prev ? { ...data, rows: [...prev.rows, ...data.rows] } : data
      );
      setFilteredRowsStatus("idle");
    } catch (err) {
      setFilteredRowsStatus("error");
      setFilteredRowsError(err instanceof Error ? err.message : "Could not load the filtered rows.");
    } finally {
      setFilteredRowsLoadingMore(false);
    }
  }

  function toggleFilteredPreview() {
    setFilteredPreviewOpen((v) => {
      const next = !v;
      if (next && !filteredRowsData && filteredRowsStatus !== "loading") {
        loadFilteredRows();
      }
      return next;
    });
  }

  async function processFile(file: File) {
    const processStart = Date.now();
    setProcessStartTime(processStart);
    setProcessEndTime(null);
    setStatus("uploading");
    setErrorMsg("");
    setFileInfo(null);
    setProceeded(false);
    setPreviewOpen(false);
    setFullData(null);
    setFullDataStatus("idle");
    setFullDataError("");
    setDupHistoryOpen(false);
    setFilteredCount(null);
    setExcludedCount(null);
    setFilterHistoryOpen(false);
    setFilterStatus("idle");
    setFilterError("");
    setDownloaded(false);
    setSortPreviewPoints(null);
    setSortPreviewMeta(null);
    setCurrentStep(1);
    resetAlgorithms();

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      setFileInfo(data);
      setFilters([makeEmptyCondition()]);
      setSortColumn(NONE);
      setSortOrder("asc");
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProcessEndTime(Date.now());
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (status === "uploading" || status === "sorting") return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processFile(file);
  }

  async function handleExportAndDownload(format: "xlsx" | "pdf" = "xlsx") {
    if (!fileInfo) return;
    if (!algoResult) return;

    setStatus("sorting");
    setDownloadFormat(format);
    setErrorMsg("");

    try {
      const res = await fetch(`${API_BASE}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: fileInfo.fileId,
          filters: activeFilters.length > 0 ? activeFilters.map(({ column, value }) => ({ column, value })) : undefined,
          sortColumn: sortColumn === NONE ? undefined : sortColumn,
          sortOrder: sortColumn === NONE ? undefined : sortOrder,
          format,
          // PDF-only: lets the "Row Reduction Summary" chart compare the originally uploaded row
          // count against how many rows the applied algorithm actually used, rather than
          // comparing before/after this export's own filter.
          algoRowsUsed: algoResult.rowsUsed,
          includeRemovedRows: format === "pdf" ? includeRemovedRows : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Download failed.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");

      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : format === "pdf" ? "export.pdf" : "export.xlsx";

      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setStatus("idle");
      setDownloadFormat(null);
      setDownloaded(true);
    } catch (err) {
      setStatus("error");
      setDownloadFormat(null);
      setErrorMsg(err instanceof Error ? err.message : "Download failed.");
    }
  }

  function handleReset() {
    setFileInfo(null);
    setFilters([makeEmptyCondition()]);
    setSortColumn(NONE);
    setSortOrder("asc");
    setStatus("idle");
    setErrorMsg("");
    setProceeded(false);
    setPreviewOpen(false);
    setFullData(null);
    setFullDataStatus("idle");
    setFullDataError("");
    setFilteredCount(null);
    setExcludedCount(null);
    setFilterHistoryOpen(false);
    setFilterStatus("idle");
    setFilterError("");
    setSortPreviewPoints(null);
    setSortPreviewMeta(null);
    setProcessStartTime(null);
    setProcessEndTime(null);
    resetAlgorithms();
    setCurrentStep(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  type StepStatus = "done" | "active" | "upcoming";
  const steps: { n: number; label: string; icon: React.ReactNode; status: StepStatus }[] = [
    { n: 1, label: "Upload Data", icon: <IconUpload />, status: fileInfo ? "done" : "active" },
    {
      n: 2,
      label: "Preprocess",
      icon: <IconSettings />,
      status: !fileInfo ? "upcoming" : proceeded ? "done" : "active",
    },
    {
      n: 3,
      label: "Algorithms",
      icon: <IconPulse />,
      status: !proceeded ? "upcoming" : algoResult ? "done" : "active",
    },
    {
      n: 4,
      label: "Visualize & Analysis",
      icon: <IconEye />,
      status: !algoResult ? "upcoming" : currentStep > 4 ? "done" : "active",
    },
    {
      n: 5,
      label: "Report",
      icon: <IconDocument />,
      status: !algoResult ? "upcoming" : currentStep > 5 ? "done" : "active",
    },
    {
      n: 6,
      label: "Export",
      icon: <IconDownload />,
      status: !algoResult ? "upcoming" : downloaded ? "done" : "active",
    },
  ];

  // Steps 4-6 (Visualize & Analysis, Report, Export) are all just different views of the same
  // already-computed algoResult, so once it exists all three become freely reachable.
  const maxStepReached = !fileInfo ? 1 : !proceeded ? 2 : !algoResult ? 3 : 6;

  function goToStep(n: number) {
    if (n <= maxStepReached) setCurrentStep(n);
  }

  const progressPct = Math.round((currentStep / steps.length) * 100);

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>
            Rows go in. <em>Order</em> comes out.
          </h1>
        </div>
        <div className="sort-signature" aria-hidden="true">
          <span className="sig-label">sorting…</span>
          <div className="sig-bars">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
        </div>
      </section>

      <div className="workspace">
        <aside className="sidebar-dark" aria-label="Progress">
          <div className="sidebar-logo-row">
            <span className="sidebar-logo-badge">
              <IconPulse />
            </span>
            <div>
              <div className="sidebar-logo-title">DimReduce</div>
              <div className="sidebar-logo-subtitle">Analysis System</div>
            </div>
          </div>

          <div className="sidebar-progress-row">
            <div className="sidebar-progress-label-row">
              <span className="sidebar-progress-label">Progress</span>
              <span className="sidebar-progress-pct">{progressPct}%</span>
            </div>
            <div className="sidebar-progress-track">
              <div className="sidebar-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <ol className="sidebar-dark-steps">
            {steps.map((s) => (
              <li
                key={s.n}
                className={`sidebar-dark-step ${s.n === currentStep ? "current" : ""} ${
                  s.n <= maxStepReached ? "reachable" : ""
                } ${s.status}`}
                onClick={() => goToStep(s.n)}
                role={s.n <= maxStepReached ? "button" : undefined}
                tabIndex={s.n <= maxStepReached ? 0 : undefined}
              >
                <span className="sidebar-dark-step-icon">
                  {s.status === "done" ? <IconCheckCircle /> : s.icon}
                </span>
                <span className="sidebar-dark-step-label">{s.label}</span>
                {s.n === currentStep && (
                  <span className="sidebar-dark-step-chevron">
                    <IconArrowRight />
                  </span>
                )}
              </li>
            ))}
          </ol>

          <button type="button" className="sidebar-sim-link" onClick={() => setShowSimModule(true)}>
            <IconSparkle /> How PCA &amp; LDA work
          </button>

          <MemoryUsageBadge />
        </aside>

        <nav className="stepper-mobile" aria-label="Progress">
          {steps.map((s) => (
            <div
              key={s.n}
              className={`step ${s.n === currentStep ? "active" : s.status === "done" ? "done" : ""} ${
                s.n <= maxStepReached ? "reachable" : ""
              }`}
              onClick={() => goToStep(s.n)}
            >
              <span className="num">{s.n}</span> {s.label}
            </div>
          ))}
        </nav>

        <div className="main-content">

      {currentStep === 1 && !fileInfo && (
      <div
        className={`card upload-card ${isDragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (status !== "uploading" && status !== "sorting") setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div
          className="upload-zone"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="upload-icon">
            <IconUpload />
          </div>
          <p className="upload-title">Drop a spreadsheet here or browse</p>
          <p className="meta">Accepts .xlsx, .xls, and .csv — parsed entirely in memory, nothing is stored server-side</p>
          <button
            type="button"
            className="browse-btn"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            disabled={status === "uploading" || status === "sorting"}
          >
            <IconFile /> Choose file
          </button>
          <input
            id="file-input"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            disabled={status === "uploading" || status === "sorting"}
            style={{ display: "none" }}
          />
        </div>

        {status === "uploading" && <p className="status">Reading file…</p>}
        {status === "error" && <p className="status error">{errorMsg}</p>}
      </div>
      )}

      {currentStep === 1 && fileInfo && (
        <div className="card dataset-card">
          <div className="dataset-header">
            <span className="dataset-title">Uploaded dataset</span>
          </div>
          <div className="dataset-row">
            <div className="dataset-file">
              <span className="dataset-file-icon">
                <IconFile />
              </span>
              <div>
                <p className="dataset-name">{fileInfo.fileName}</p>
                <p className="meta small">{fileInfo.columns.length} columns</p>
              </div>
            </div>
            <div className="dataset-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={togglePreview}
                aria-label={previewOpen ? "Hide dataset preview" : "Preview full dataset"}
                title={previewOpen ? "Hide dataset preview" : "Preview full dataset"}
              >
                <IconEye />
              </button>
              <button type="button" className="icon-btn danger" onClick={handleReset} aria-label="Remove file">
                <IconTrash />
              </button>
            </div>
          </div>

          {(fileInfo.importNotes.headerRowsSkipped > 0 ||
            fileInfo.importNotes.columnsRealigned.length > 0 ||
            fileInfo.importNotes.dividerRowsRemoved > 0 ||
            fileInfo.importNotes.subtotalRowsRemoved > 0) && (
            <div className="import-notes">
              <span className="import-notes-icon">
                <IconSparkle />
              </span>
              <div>
                <p className="import-notes-title">Smart import cleaned this file</p>
                <p className="import-notes-text">
                  {fileInfo.importNotes.headerRowsSkipped > 0 && (
                    <>Skipped {fileInfo.importNotes.headerRowsSkipped} title/header row(s) before the real data. </>
                  )}
                  {fileInfo.importNotes.columnsRealigned.length > 0 && (
                    <>
                      Corrected {fileInfo.importNotes.columnsRealigned.length} misaligned column
                      {fileInfo.importNotes.columnsRealigned.length > 1 ? "s" : ""} (
                      {fileInfo.importNotes.columnsRealigned.map((c) => c.label).join(", ")}).{" "}
                    </>
                  )}
                  {fileInfo.importNotes.dividerRowsRemoved > 0 && (
                    <>
                      Found {fileInfo.importNotes.groupsDetected.length} section
                      {fileInfo.importNotes.groupsDetected.length > 1 ? "s" : ""} and added a{" "}
                      <strong>Group</strong> column.{" "}
                    </>
                  )}
                  {fileInfo.importNotes.subtotalRowsRemoved > 0 && (
                    <>Removed {fileInfo.importNotes.subtotalRowsRemoved} subtotal/summary row(s).</>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="section" style={{ marginBottom: 16 }}>
            <div className="section-head">
              <h2>Filter</h2>
              <span className="section-tag">optional</span>
            </div>
            <p className="meta">
              Keep only rows matching every condition below — e.g. Gender = Male AND Location = Laguna.
            </p>

            <div className="filter-conditions">
              {filters.map((cond, i) => {
                // A column already used in another row shouldn't be offered again — picking the
                // same column twice with two different values could never match any row.
                const usedElsewhere = filters.filter((f) => f.id !== cond.id).map((f) => f.column);
                const columnOptions = Object.keys(fileInfo.uniqueValues).filter(
                  (col) => col === cond.column || !usedElsewhere.includes(col)
                );
                return (
                  <div className="filter-condition-row" key={cond.id}>
                    {i > 0 && <span className="filter-and-tag">AND</span>}
                    <div className="field-row">
                      <label>
                        Column
                        <select
                          value={cond.column}
                          onChange={(e) => {
                            updateFilterCondition(cond.id, { column: e.target.value, value: "" });
                            resetAlgorithms();
                          }}
                        >
                          <option value={NONE}>No filter</option>
                          {columnOptions.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </label>

                      {cond.column !== NONE && (
                        <label>
                          Value
                          <select
                            value={cond.value}
                            onChange={(e) => updateFilterCondition(cond.id, { value: e.target.value })}
                          >
                            <option value="">Choose a value…</option>
                            {(fileInfo.uniqueValues[cond.column] || []).map((val) => (
                              <option key={val} value={val}>
                                {val}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {filters.length > 1 && (
                        <button
                          type="button"
                          className="secondary small ghost filter-remove-btn"
                          onClick={() => removeFilterCondition(cond.id)}
                          aria-label="Remove this condition"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="filter-apply-row">
              {filters.length < Object.keys(fileInfo.uniqueValues).length && (
                <button type="button" className="secondary small ghost" onClick={addFilterCondition}>
                  + Add condition
                </button>
              )}
              {activeFilters.length > 0 && (
                <>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={applyFilter}
                    disabled={filterStatus === "checking"}
                  >
                    {filterStatus === "checking" ? "Filtering…" : "Apply filter"}
                  </button>
                  {filteredCount !== null && filterStatus !== "checking" && (
                    <button type="button" className="secondary small ghost" onClick={clearFilter}>
                      Clear
                    </button>
                  )}
                </>
              )}
            </div>
            {filterStatus === "error" && <p className="status error">{filterError}</p>}
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Rows before</span>
              <span className="stat-value">{fileInfo.rowsBefore}</span>
            </div>
            <div className="stat-card highlight">
              <span className="stat-label">Rows after</span>
              <span className="stat-value">{filteredCount !== null ? filteredCount : fileInfo.rowsAfter}</span>
              {filteredCount !== null && (
                <>
                  <span className="stat-note">filtered</span>
                  <button
                    type="button"
                    className="secondary small ghost stat-card-action"
                    onClick={toggleFilteredPreview}
                  >
                    {filteredPreviewOpen ? "Hide rows" : "Review"}
                  </button>
                </>
              )}
            </div>
            {excludedCount !== null && excludedCount > 0 && (
              <div className="stat-card">
                <span className="stat-label">Rows excluded by filter</span>
                <span className="stat-value">{excludedCount}</span>
                <button
                  type="button"
                  className="secondary small ghost stat-card-action"
                  onClick={() => setFilterHistoryOpen(true)}
                >
                  Review
                </button>
              </div>
            )}
            <div className="stat-card">
              <span className="stat-label">Duplicates removed</span>
              <span className="stat-value">{fileInfo.duplicatesRemoved}</span>
              {fileInfo.duplicatesRemoved > 0 && (
                <button
                  type="button"
                  className="secondary small ghost stat-card-action"
                  onClick={() => setDupHistoryOpen(true)}
                >
                  Review
                </button>
              )}
            </div>
            <div className="stat-card">
              <span className="stat-label">Null / blank cells</span>
              <span className="stat-value">{fileInfo.nullCells}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Runtime</span>
              <span className="stat-value">{fileInfo.runtimeMs} ms</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Start time</span>
              <span className="stat-value compact">{processStartTime ? formatTimestamp(processStartTime) : "—"}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">End time</span>
              <span className="stat-value compact">{processEndTime ? formatTimestamp(processEndTime) : "—"}</span>
            </div>
            <div className="stat-card highlight">
              <span className="stat-label">Process duration</span>
              <span className="stat-value compact">
                {processStartTime && processEndTime
                  ? formatDuration(processEndTime - processStartTime)
                  : "—"}
              </span>
            </div>
          </div>

          {filteredCount !== null && (
            <div className="filtering-summary">
              <p className="filtering-summary-title">Before and After Filtering</p>
              <p className="meta small">
                The system compares the total number of uploaded content before filtering with the
                number of content remaining after the filtering process.
              </p>
              <div className="filtering-summary-cols">
                <div>
                  <p className="filtering-summary-heading">Before Filtering</p>
                  <p className="filtering-summary-line">
                    Total uploaded content: <strong>{fileInfo.rowsBefore.toLocaleString()}</strong>
                  </p>
                </div>
                <div>
                  <p className="filtering-summary-heading">After Filtering</p>
                  <p className="filtering-summary-line">
                    Content remaining after filtering: <strong>{filteredCount.toLocaleString()}</strong>
                  </p>
                  <p className="filtering-summary-line">
                    Content filtered out:{" "}
                    <strong>{Math.max(0, fileInfo.rowsBefore - filteredCount).toLocaleString()}</strong>
                  </p>
                </div>
              </div>
              <p className="filtering-summary-formula">
                Filtered Out = Total Uploaded − Remaining After Filtering
                <br />
                {fileInfo.rowsBefore.toLocaleString()} − {filteredCount.toLocaleString()} ={" "}
                {Math.max(0, fileInfo.rowsBefore - filteredCount).toLocaleString()}
              </p>
            </div>
          )}

          {previewOpen && (
            <div className="dataset-preview-panel" style={{ marginTop: 16 }}>
              {fullDataStatus === "loading" && <p className="status">Loading the full dataset…</p>}
              {fullDataStatus === "error" && <p className="status error">{fullDataError}</p>}

              {fullData && fullDataStatus === "idle" && (
                <>
                  <div className="missing-summary">
                    <span className="missing-summary-item">
                      <strong>{fullData.rowCount}</strong> record{fullData.rowCount === 1 ? "" : "s"} total
                    </span>
                    <span
                      className={`missing-summary-item ${fullData.incompleteRowCount > 0 ? "warn" : "ok"}`}
                    >
                      <strong>{fullData.incompleteRowCount}</strong> record
                      {fullData.incompleteRowCount === 1 ? "" : "s"} with missing values
                    </span>
                    <span
                      className={`missing-summary-item ${fullData.totalMissingCells > 0 ? "warn" : "ok"}`}
                    >
                      <strong>{fullData.totalMissingCells}</strong> missing cell
                      {fullData.totalMissingCells === 1 ? "" : "s"}
                    </span>
                  </div>

                  {fullData.totalMissingCells > 0 && (
                    <div className="missing-by-column">
                      {fullData.columns
                        .filter((col) => fullData.missingByColumn[col] > 0)
                        .map((col) => (
                          <span key={col} className="missing-chip">
                            {col}: {fullData.missingByColumn[col]} missing
                          </span>
                        ))}
                    </div>
                  )}

                  <div className="preview-wrap preview-wrap-scroll">
                    <table className="preview">
                      <thead>
                        <tr>
                          <th className="row-index-col">#</th>
                          {fullData.columns.map((col) => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fullData.rows.map((row) => (
                          <tr key={row.index} className={row.isIncomplete ? "row-incomplete" : ""}>
                            <td className="row-index-col">{row.index + 1}</td>
                            {fullData.columns.map((col) => {
                              const missing = row.missingFields.includes(col);
                              return (
                                <td key={col} className={missing ? "cell-missing" : ""}>
                                  {missing ? <span className="missing-tag">missing</span> : String(row.data[col])}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="preview-pagination">
                    <span className="preview-pagination-count">
                      Showing {fullData.rows.length.toLocaleString()} of {fullData.rowCount.toLocaleString()} records
                    </span>
                    {fullData.hasMore && (
                      <button
                        type="button"
                        className="secondary small"
                        disabled={fullDataLoadingMore}
                        onClick={() => loadFullPreview(true)}
                      >
                        {fullDataLoadingMore
                          ? "Loading…"
                          : `Load next ${Math.min(FULL_DATA_PAGE_SIZE, fullData.rowCount - fullData.rows.length).toLocaleString()} rows`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {filteredPreviewOpen && (
            <div className="dataset-preview-panel filtered-preview-panel" style={{ marginTop: 16 }}>
              <p className="meta small filtered-preview-heading">
                Rows matching: <strong>{activeFilters.map((f) => `${f.column} = ${f.value}`).join(" AND ")}</strong>
              </p>
              {filteredRowsStatus === "loading" && <p className="status">Loading filtered rows…</p>}
              {filteredRowsStatus === "error" && <p className="status error">{filteredRowsError}</p>}

              {filteredRowsData && filteredRowsStatus === "idle" && (
                <>
                  {filteredRowsData.rowCount === 0 ? (
                    <p className="status">No rows match this filter.</p>
                  ) : (
                    <>
                      <div className="preview-wrap preview-wrap-scroll">
                        <table className="preview">
                          <thead>
                            <tr>
                              {filteredRowsData.columns.map((col) => (
                                <th key={col}>{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRowsData.rows.map((row) => (
                              <tr key={row.index} className={row.isIncomplete ? "row-incomplete" : ""}>
                                {filteredRowsData.columns.map((col) => {
                                  const missing = row.missingFields.includes(col);
                                  return (
                                    <td key={col} className={missing ? "cell-missing" : ""}>
                                      {missing ? <span className="missing-tag">missing</span> : String(row.data[col])}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="preview-pagination">
                        <span className="preview-pagination-count">
                          Showing {filteredRowsData.rows.length.toLocaleString()} of{" "}
                          {filteredRowsData.rowCount.toLocaleString()} matching rows
                        </span>
                        {filteredRowsData.hasMore && (
                          <button
                            type="button"
                            className="secondary small"
                            disabled={filteredRowsLoadingMore}
                            onClick={() => loadFilteredRows(true)}
                          >
                            {filteredRowsLoadingMore
                              ? "Loading…"
                              : `Load next ${Math.min(
                                  FULL_DATA_PAGE_SIZE,
                                  filteredRowsData.rowCount - filteredRowsData.rows.length
                                ).toLocaleString()} rows`}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {!proceeded && (
            <div className="proceed-row">
              <button
                type="button"
                className="proceed-btn"
                onClick={() => {
                  setProceeded(true);
                  setCurrentStep(2);
                }}
              >
                Proceed to preprocessing <IconArrowRight />
              </button>
            </div>
          )}
        </div>
      )}

      {currentStep === 2 && fileInfo && proceeded && (
        <div className="card">
          <div className="controls">
            {activeFilters.length > 0 && (
              <p className="meta filter-reminder">
                Filter active:{" "}
                <strong>{activeFilters.map((f) => `${f.column} = ${f.value}`).join(" AND ")}</strong>
              </p>
            )}
            <div className="section">
              <div className="section-head">
                <h2>Sort</h2>
                <span className="section-tag">optional</span>
              </div>
              <div className="field-row">
                <label>
                  Column
                  <select
                    value={sortColumn}
                    onChange={(e) => {
                      setSortColumn(e.target.value);
                      setSortPreviewPoints(null);
                    }}
                  >
                    <option value={NONE}>No sorting</option>
                    {fileInfo.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </label>

                {sortColumn !== NONE && (
                  <label>
                    Order
                    <select
                      value={sortOrder}
                      onChange={(e) => {
                        setSortOrder(e.target.value as "asc" | "desc");
                        setSortPreviewPoints(null);
                      }}
                    >
                      <option value="asc">Ascending (A→Z, 0→9)</option>
                      <option value="desc">Descending (Z→A, 9→0)</option>
                    </select>
                  </label>
                )}
              </div>

              {sortColumn !== NONE && (
                <>
                  <div className="filter-apply-row">
                    <button
                      type="button"
                      onClick={runSortPreview}
                      disabled={sortPreviewStatus === "loading"}
                    >
                      <IconSparkle /> {sortPreviewStatus === "loading" ? "Building graph…" : "Graph the sort result"}
                    </button>
                  </div>
                  {sortPreviewStatus === "error" && <p className="status error">{sortPreviewError}</p>}
                  {sortPreviewPoints && sortPreviewPoints.length > 0 && (
                    <div className="sort-graph-panel">
                      <div className="sort-graph-head">
                        <span className="sort-graph-title">
                          <IconSparkle /> Sort Result Graph
                        </span>
                      </div>
                      {sortPreviewSummary && (
                        <SortPieChart
                          categories={sortPreviewSummary.categories}
                          categoryMode={sortPreviewSummary.categoryMode}
                          columnLabel={sortColumn}
                        />
                      )}
                      {sortPreviewSummary && (
                        <SortInterpretation
                          summary={sortPreviewSummary}
                          columnLabel={sortColumn}
                          order={sortOrder}
                          isNumeric={sortPreviewIsNumeric}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <p className="meta small preprocess-next-note">
              Next: run <strong>Apply Algorithms</strong> — download becomes available once results are ready.
            </p>

            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setAlgoOpen(true);
                  setCurrentStep(3);
                }}
                disabled={algoOpen}
              >
                {algoResult ? "Re-run Algorithms" : "Apply Algorithms"}
              </button>
              <button className="secondary" onClick={handleReset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStep === 3 && fileInfo && (
        <div className="card algo-card">
          <div className="algo-header">
            <span className="algo-header-icon">
              <IconSparkle />
            </span>
            <div>
              <h2 className="algo-title">Apply Algorithms</h2>
              <p className="meta">Run PCA and LDA dimensionality reduction on the numeric columns.</p>
            </div>
            <button type="button" className="algo-header-sim-btn" onClick={() => setShowSimModule(true)}>
              How it works
            </button>
          </div>

          {!algoResult && (
            <div className="section" style={{ marginTop: 4 }}>
              <div className="field-row">
                <label>
                  Class / label column (for LDA)
                  <select
                    value={labelColumn}
                    onChange={(e) => {
                      setLabelColumn(e.target.value);
                      setAlgoResult(null);
                      setAlgoStatus("idle");
                      setAlgoError("");
                    }}
                  >
                    <option value={NONE}>Choose a column…</option>
                    {fileInfo &&
                      Object.keys(fileInfo.uniqueValues)
                        .filter((col) => !filterColumns.includes(col))
                        .map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                  </select>
                </label>
              </div>
              <p className="meta small">
                PCA runs unsupervised on all numeric columns. LDA additionally uses this column as the class label.
              </p>
              <div className="filter-apply-row">
                <button
                  type="button"
                  onClick={runAlgorithmsRequest}
                  disabled={labelColumn === NONE || algoStatus === "running"}
                >
                  {algoStatus === "running" ? "Running…" : "Run Algorithms"}
                </button>
                <button
                  type="button"
                  className="secondary small ghost"
                  onClick={() => {
                    resetAlgorithms();
                    setCurrentStep(2);
                  }}
                >
                  Cancel
                </button>
              </div>
              {algoStatus === "running" && <AlgorithmSimulation rowsHint={fileInfo?.rowsAfter} />}
              {algoStatus === "error" && <p className="status error">{algoError}</p>}
            </div>
          )}

          {algoResult && (
            <>
              <div className="algo-grid">
                <div className="algo-result-card">
                  <div className="algo-result-head">
                    <span className="algo-icon pine">
                      <IconSparkle />
                    </span>
                    <div>
                      <p className="algo-result-title">PCA</p>
                      <p className="algo-result-subtitle">Principal Component Analysis</p>
                    </div>
                  </div>
                  <p className="meta">Unsupervised linear transformation to maximize variance retention.</p>
                  <span className="algo-status-badge done">
                    <IconCheckCircle /> Completed
                  </span>
                  <div className="algo-bars">
                    {algoResult.pca.components.map((c) => (
                      <div className="algo-bar-row" key={c.label}>
                        <span className="algo-bar-label">{c.label}</span>
                        <span className="algo-bar-track">
                          <span className="algo-bar-fill" style={{ width: `${Math.min(c.ratio, 100)}%` }} />
                        </span>
                        <span className="algo-bar-value">{c.ratio.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="algo-result-card">
                  <div className="algo-result-head">
                    <span className="algo-icon clay">
                      <IconTarget />
                    </span>
                    <div>
                      <p className="algo-result-title">LDA</p>
                      <p className="algo-result-subtitle">Linear Discriminant Analysis</p>
                    </div>
                  </div>
                  <p className="meta">
                    Supervised method to maximize separability of <strong>{algoResult.lda.labelColumn}</strong>.
                  </p>
                  <span className="algo-status-badge done">
                    <IconCheckCircle /> Completed
                  </span>
                  <div className="algo-bars">
                    {algoResult.lda.accuracy !== null && (
                      <div className="algo-bar-row accuracy">
                        <span className="algo-bar-label">Accuracy</span>
                        <span className="algo-bar-track" />
                        <span className="algo-bar-value">{algoResult.lda.accuracy.toFixed(1)}%</span>
                      </div>
                    )}
                    {algoResult.lda.components.map((c) => (
                      <div className="algo-bar-row" key={c.label}>
                        <span className="algo-bar-label">{c.label}</span>
                        <span className="algo-bar-track">
                          <span className="algo-bar-fill clay" style={{ width: `${Math.min(c.ratio, 100)}%` }} />
                        </span>
                        <span className="algo-bar-value">{c.ratio.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                  {algoResult.lda.note && <p className="meta small algo-note">{algoResult.lda.note}</p>}
                </div>
              </div>

              <div className="algo-banner">
                <IconCheckCircle /> Both algorithms completed successfully — ready for analysis.
              </div>

              <div className="algo-actions">
                <button type="button" className="secondary" onClick={() => setCurrentStep(2)}>
                  <IconArrowLeft /> Back
                </button>
                <button type="button" className="proceed-btn" onClick={() => setCurrentStep(4)}>
                  Continue to Visualize &amp; Analysis <IconArrowRight />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {currentStep === 4 && fileInfo && algoResult && (
        <div className="card algo-card">
          <VisualizeAnalysisSection algoResult={algoResult} />
          <BeforeAfterTables algoResult={algoResult} fileId={fileInfo.fileId} />
          <AlgorithmComputationSteps pcaSteps={algoResult.pca.steps} ldaSteps={algoResult.lda.steps} />
          <div className="algo-actions" style={{ marginTop: 18 }}>
            <button type="button" className="secondary" onClick={() => setCurrentStep(3)}>
              <IconArrowLeft /> Back
            </button>
            <button type="button" className="proceed-btn" onClick={() => setCurrentStep(5)}>
              Continue to Report <IconArrowRight />
            </button>
          </div>
        </div>
      )}

      {currentStep === 5 && fileInfo && algoResult && (
        <div className="card algo-card">
          <ReportSection algoResult={algoResult} />
          <div className="algo-actions" style={{ marginTop: 18 }}>
            <button type="button" className="secondary" onClick={() => setCurrentStep(4)}>
              <IconArrowLeft /> Back
            </button>
            <button type="button" className="proceed-btn" onClick={() => setCurrentStep(6)}>
              Continue to Export <IconArrowRight />
            </button>
          </div>
        </div>
      )}

      {currentStep === 6 && fileInfo && algoResult && (
        <div className="card download-card">
          <div className="algo-header">
            <span className="algo-header-icon">
              <IconDownload />
            </span>
            <div>
              <h2 className="algo-title">Export</h2>
              <p className="meta">Your file is ready, with everything above applied.</p>
            </div>
          </div>

          <ul className="download-summary">
            <li>
              <span className="download-summary-key">Filter</span>
              <span className="download-summary-val">
                {activeFilters.length > 0
                  ? activeFilters.map((f) => `${f.column} = ${f.value}`).join(" AND ")
                  : "None"}
              </span>
            </li>
            <li>
              <span className="download-summary-key">Sort</span>
              <span className="download-summary-val">
                {sortColumn !== NONE ? `${sortColumn}, ${sortOrder === "asc" ? "ascending" : "descending"}` : "None"}
              </span>
            </li>
          </ul>

          {status === "error" && <p className="status error">{errorMsg}</p>}

          {hasIncompleteFilter && (
            <p className="status error">
              One of your filter conditions is missing a value — finish or remove it before exporting.
            </p>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeRemovedRows}
              onChange={(e) => setIncludeRemovedRows(e.target.checked)}
            />
            <span>
              Include removed/excluded rows history in the PDF (duplicates removed at upload, and
              any rows this export's filter excluded)
            </span>
          </label>

          <div className="actions">
            <button
              onClick={() => handleExportAndDownload("xlsx")}
              disabled={status === "sorting" || hasIncompleteFilter}
            >
              {status === "sorting" && downloadFormat === "xlsx"
                ? "Processing…"
                : downloaded
                ? "Download Excel Again"
                : "Download Excel"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => handleExportAndDownload("pdf")}
              disabled={status === "sorting" || hasIncompleteFilter}
            >
              <IconDownload /> {status === "sorting" && downloadFormat === "pdf" ? "Processing…" : "Download PDF"}
            </button>
            <button type="button" className="secondary" onClick={handleReset}>
              Start Over
            </button>
          </div>
        </div>
      )}
        </div>
      </div>
      {showSimModule && <AlgorithmSimulationModule onClose={() => setShowSimModule(false)} />}
      {dupHistoryOpen && fileInfo && (
        <DuplicateHistoryPanel
          fileId={fileInfo.fileId}
          columns={fileInfo.columns}
          onClose={() => setDupHistoryOpen(false)}
          onRowsChanged={(rowsAfter) =>
            setFileInfo((prev) => (prev ? { ...prev, rowsAfter } : prev))
          }
        />
      )}
      {filterHistoryOpen && fileInfo && (
        <FilterHistoryPanel
          fileId={fileInfo.fileId}
          columns={fileInfo.columns}
          onClose={() => setFilterHistoryOpen(false)}
          onResolved={applyFilter}
        />
      )}
    </div>
  );
}