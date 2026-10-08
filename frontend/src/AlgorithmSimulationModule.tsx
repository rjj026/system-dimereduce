import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// AlgorithmSimulationModule
//
// A standalone, always-available "how it works" module — separate from the
// actual PCA/LDA run in the wizard. It doesn't touch fileInfo/algoResult/
// algoStatus at all, so it can be opened at any point in the flow (or before
// a file is even uploaded) to explain the two algorithms this system runs.
//
// The point cloud and class clusters drawn here are a fixed, hand-placed
// synthetic dataset for illustration only — not the user's real data. The
// diagrams animate on a loop via native SVG/SMIL (<animate>/<animateTransform>),
// so no interval/timer drives the drawing itself; the only local state is the
// small "which stage is highlighted" pointer and a play/pause flag, kept
// local to each panel so they can't affect anything outside this module.
// ---------------------------------------------------------------------------

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

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
}

type Stage = { title: string; description: string };

const PCA_STAGES: Stage[] = [
  {
    title: "Standardize the data",
    description:
      "Every numeric column is centered to mean 0 and scaled to unit variance, so a column measured in the thousands doesn't dominate one measured in single digits.",
  },
  {
    title: "Compute the covariance matrix",
    description:
      "Captures how every pair of columns varies together across all rows — the raw material PCA searches for structure in.",
  },
  {
    title: "Extract eigenvectors & eigenvalues",
    description:
      "Eigenvectors point along the directions of greatest spread in the data; their eigenvalues rank how much variance each direction explains.",
  },
  {
    title: "Keep the top two components",
    description:
      "The eigenvectors with the two largest eigenvalues become PC1 and PC2 — the axes that preserve the most information in 2D.",
  },
  {
    title: "Project every row",
    description:
      "Each row's original values are converted into just two numbers: its coordinates along PC1 and PC2.",
  },
];

const LDA_STAGES: Stage[] = [
  {
    title: "Group rows by class label",
    description: "Rows are split into groups according to the label column chosen for LDA.",
  },
  {
    title: "Compute within-class scatter",
    description: "Measures how spread out the rows inside each individual class are around that class's own mean.",
  },
  {
    title: "Compute between-class scatter",
    description: "Measures how far apart the different classes' means are from each other and from the overall mean.",
  },
  {
    title: "Solve the eigenproblem",
    description:
      "Finds the direction that maximizes between-class separation relative to within-class spread — the axis that best tells the classes apart.",
  },
  {
    title: "Validate on a held-out split",
    description:
      "80% of rows fit the discriminant axis; the remaining 20% test how well it classifies rows it never saw, giving an honest accuracy figure.",
  },
];

// ---------- Synthetic point clouds (illustration only) ----------
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
      className="sim-module-anim-svg"
      role="img"
      aria-label="Animated illustration of PCA sweeping toward the direction of maximum variance, then projecting points onto it"
    >
      <line
        x1={PCA_AXIS2.x1} y1={PCA_AXIS2.y1} x2={PCA_AXIS2.x2} y2={PCA_AXIS2.y2}
        stroke="var(--rule)" strokeWidth="1.4" strokeDasharray="3 3" opacity="0"
      >
        <animate attributeName="opacity" values="0;0;0.8;0.8;0" keyTimes="0;0.5;0.6;0.92;1" dur="8s" repeatCount="indefinite" />
      </line>

      {PCA_POINTS.map(([x, y], i) => {
        const [fx, fy] = PCA_FEET[i];
        return (
          <line key={`g${i}`} x1={x} y1={y} x2={fx} y2={fy} stroke="var(--pine)" strokeWidth="0.8" strokeDasharray="2 2" opacity="0">
            <animate attributeName="opacity" values="0;0;0.45;0.45;0" keyTimes="0;0.45;0.55;0.85;1" dur="8s" repeatCount="indefinite" />
          </line>
        );
      })}

      <line x1={PCA_AXIS.x1} y1={PCA_AXIS.y1} x2={PCA_AXIS.x2} y2={PCA_AXIS.y2} stroke="var(--pine)" strokeWidth="2.2" strokeLinecap="round">
        <animateTransform
          attributeName="transform" type="rotate"
          values={`70 ${pivot};-55 ${pivot};45 ${pivot};0 ${pivot};0 ${pivot}`}
          keyTimes="0;0.15;0.3;0.45;1" dur="8s" repeatCount="indefinite"
        />
      </line>

      {PCA_POINTS.map(([x, y], i) => (
        <circle key={`p${i}`} cx={x} cy={y} r="3" fill="var(--ink-soft)">
          <animate attributeName="opacity" values="0.85;0.85;0.3;0.3;0.85" keyTimes="0;0.4;0.5;0.85;1" dur="8s" repeatCount="indefinite" />
        </circle>
      ))}

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
      className="sim-module-anim-svg"
      role="img"
      aria-label="Animated illustration of LDA sweeping toward the axis that best separates two classes, then projecting points onto it"
    >
      {renderClass(LDA_A_POINTS, LDA_A_FEET, "var(--pine)", "a")}
      {renderClass(LDA_B_POINTS, LDA_B_FEET, "var(--clay)", "b")}

      <circle cx={LDA_MEAN_A.x} cy={LDA_MEAN_A.y} r="3.4" fill="none" stroke="var(--pine)" strokeWidth="1.6" />
      <circle cx={LDA_MEAN_B.x} cy={LDA_MEAN_B.y} r="3.4" fill="none" stroke="var(--clay)" strokeWidth="1.6" />

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

// ---------- Panel: diagram + auto-advancing, clickable stage list ----------
function AlgorithmPanel({
  title,
  subtitle,
  accent,
  icon,
  stages,
  diagram,
}: {
  title: string;
  subtitle: string;
  accent: "pine" | "clay";
  icon: React.ReactNode;
  stages: Stage[];
  diagram: React.ReactNode;
}) {
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setStage((s) => (s + 1) % stages.length), 2400);
    return () => clearInterval(t);
  }, [paused, stages.length]);

  function togglePause() {
    setPaused((wasPaused) => {
      const svg = wrapRef.current?.querySelector("svg") as
        | (SVGSVGElement & { pauseAnimations?: () => void; unpauseAnimations?: () => void })
        | null;
      if (svg) {
        if (!wasPaused) svg.pauseAnimations?.();
        else svg.unpauseAnimations?.();
      }
      return !wasPaused;
    });
  }

  return (
    <div className={`sim-module-panel accent-${accent}`}>
      <div className="sim-module-panel-head">
        <span className={`algo-icon ${accent}`}>{icon}</span>
        <div className="sim-module-panel-titles">
          <p className="sim-module-panel-title">{title}</p>
          <p className="sim-module-panel-subtitle">{subtitle}</p>
        </div>
        <button
          type="button"
          className="sim-module-pause"
          onClick={togglePause}
          aria-label={paused ? "Play animation" : "Pause animation"}
          title={paused ? "Play" : "Pause"}
        >
          {paused ? <IconPlay /> : <IconPause />}
        </button>
      </div>

      <div className="sim-module-anim-wrap" ref={wrapRef}>
        {diagram}
        <p className="sim-module-anim-caption">Illustrative example — not your actual data</p>
      </div>

      <ol className="sim-module-stages">
        {stages.map((s, i) => (
          <li
            key={s.title}
            className={`sim-module-stage ${i === stage ? "active" : i < stage ? "done" : ""}`}
            onClick={() => {
              setStage(i);
              setPaused(true);
            }}
          >
            <span className="sim-module-stage-num">{i + 1}</span>
            <div>
              <p className="sim-module-stage-title">{s.title}</p>
              {i === stage && <p className="sim-module-stage-desc">{s.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function AlgorithmSimulationModule({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sim-module-overlay" role="dialog" aria-modal="true" aria-label="How PCA and LDA work">
      <div className="sim-module-card" onClick={(e) => e.stopPropagation()}>
        <div className="sim-module-header">
          <div>
            <h2 className="sim-module-title">How the Algorithms Work</h2>
            <p className="meta">
              A simulated walk-through of PCA and LDA — the two dimensionality-reduction methods this system runs
              against your uploaded data. Click any stage below to jump to it, or let it play on its own.
            </p>
          </div>
          <button type="button" className="sim-module-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="sim-module-grid">
          <AlgorithmPanel
            title="PCA"
            subtitle="Principal Component Analysis — unsupervised"
            accent="pine"
            icon={<IconSparkle />}
            stages={PCA_STAGES}
            diagram={<PCAAnimation />}
          />
          <AlgorithmPanel
            title="LDA"
            subtitle="Linear Discriminant Analysis — supervised"
            accent="clay"
            icon={<IconTarget />}
            stages={LDA_STAGES}
            diagram={<LDAAnimation />}
          />
        </div>
      </div>
    </div>
  );
}
