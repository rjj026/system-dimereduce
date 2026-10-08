import { useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// AlgorithmComputationSteps
//
// Shows the REAL, computed step-by-step arithmetic behind this run's PCA and
// LDA — formula, plain-language description, and the actual numbers from the
// user's own uploaded data (mean vectors, covariance/scatter matrices,
// eigenvalues, projected rows) — matching the manuscript's Chapter 3
// formulation step by step. This is deliberately distinct from
// AlgorithmSimulationModule, which illustrates the algorithms in the
// abstract using a fixed synthetic dataset; everything rendered here comes
// straight from /api/apply-algorithms's response for the file actually
// uploaded.
//
// The steps play automatically, like the AlgorithmSimulationModule: once a step has finished
// animating and had a moment to be read, the next one opens by itself — PCA step 1 through to the
// last LDA step — and then it stops on "Computation complete". Play/Pause and Replay controls sit
// above the list, and clicking any step or tab pauses auto-play so the user can explore at their
// own pace (press Play to pick the sequence back up).
//
// Opening a step briefly shows a "Computing…" indicator, then every number
// counts up from 0 to its real value (staggered cell-by-cell) and every
// table row fades in row-by-row, so it reads as the arithmetic actually
// happening rather than a static dump of results. Respects
// prefers-reduced-motion (values just appear immediately, no animation).
// ---------------------------------------------------------------------------

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

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// How long a value takes to count from 0 to its final number, and how much extra delay each
// subsequent cell gets so a vector/matrix/table fills in left-to-right, top-to-bottom rather
// than all at once. Capped at MAX_STAGGER_ITEMS so a huge matrix doesn't take forever to finish.
const COUNT_DURATION_MS = 650;
const STAGGER_MS = 30;
const MAX_STAGGER_ITEMS = 40;
const COMPUTING_DELAY_MS = 450;
// How long a finished step stays on screen, so its numbers can be read, before auto-play moves on.
const READ_DWELL_MS = 2500;

function staggerDelay(index: number, base = 0) {
  return base + Math.min(index, MAX_STAGGER_ITEMS) * STAGGER_MS;
}

// How long auto-play should stay on a step: the "Computing…" phase, the longest result animation
// inside it (they all start together), then a reading pause. With reduced motion there are no
// animations, so only the reading pause remains.
function estimateStepDurationMs(step: ComputationStep): number {
  if (prefersReducedMotion()) return READ_DWELL_MS;
  let longestDelay = 0;
  for (const r of step.results) {
    let lastDelay = 0;
    if (r.kind === "vector") lastDelay = staggerDelay(r.values.length - 1);
    else if (r.kind === "matrix") {
      const cols = r.values[0]?.length ?? 1;
      lastDelay = Math.max(staggerDelay(r.values.length * cols - 1), (r.values.length - 1) * 60);
    } else if (r.kind === "table") lastDelay = (r.rows.length - 1) * 50;
    else lastDelay = staggerDelay(r.entries.length - 1);
    longestDelay = Math.max(longestDelay, lastDelay, 0);
  }
  return COMPUTING_DELAY_MS + longestDelay + COUNT_DURATION_MS + READ_DWELL_MS;
}

function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = n.toString();
  if (s.includes("e") || s.includes("E")) return 5;
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}

// Counts up from 0 to `value` on mount (so it re-triggers every time a step is reopened, since
// the whole results block only mounts once the step's brief "Computing…" phase finishes).
function AnimatedNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const [display, setDisplay] = useState(prefersReducedMotion() ? value : 0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    let startTs: number | null = null;
    const timer = setTimeout(() => {
      function tick(ts: number) {
        if (startTs === null) startTs = ts;
        const progress = Math.min(1, (ts - startTs) / COUNT_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        setDisplay(value * eased);
        if (progress < 1) raf = requestAnimationFrame(tick);
        else setDisplay(value);
      }
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay]);

  return <span className="calc-animated-num">{display.toFixed(decimalPlaces(value))}</span>;
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function StepResultView({ result }: { result: StepResult }) {
  if (result.kind === "vector") {
    return (
      <div className="calc-panel">
        <p className="calc-panel-label">{result.label}</p>
        <div className="calc-vector">
          {result.values.map((v, i) => (
            <span className="calc-vector-item calc-fade-in" style={{ animationDelay: `${staggerDelay(i)}ms` }} key={i}>
              {result.labels?.[i] && <span className="calc-vector-item-label">{result.labels[i]}</span>}
              <span className="calc-vector-item-value">
                <AnimatedNumber value={v} delay={staggerDelay(i)} />
              </span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (result.kind === "matrix") {
    const numCols = result.values[0]?.length ?? 1;
    return (
      <div className="calc-panel">
        <p className="calc-panel-label">{result.label}</p>
        <div className="calc-table-wrap">
          <table className="calc-matrix-table">
            {result.colLabels && (
              <thead>
                <tr>
                  {result.rowLabels && <th></th>}
                  {result.colLabels.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {result.values.map((row, i) => (
                <tr className="calc-fade-in" style={{ animationDelay: `${i * 60}ms` }} key={i}>
                  {result.rowLabels && <th>{result.rowLabels[i]}</th>}
                  {row.map((v, j) => (
                    <td key={j}>
                      <AnimatedNumber value={v} delay={staggerDelay(i * numCols + j)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (result.kind === "table") {
    return (
      <div className="calc-panel">
        <p className="calc-panel-label">
          {result.label}
          {result.totalRows > result.shown && (
            <span className="calc-panel-note">
              {" "}
              — showing {result.shown} of {result.totalRows.toLocaleString()} rows
            </span>
          )}
        </p>
        <div className="calc-table-wrap">
          <table className="calc-matrix-table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr className="calc-fade-in" style={{ animationDelay: `${i * 50}ms` }} key={i}>
                  {row.map((v, j) =>
                    typeof v === "number" ? (
                      <td key={j}>
                        <AnimatedNumber value={v} delay={i * 50} />
                      </td>
                    ) : (
                      <td key={j}>{v}</td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // "scalars"
  return (
    <div className="calc-panel">
      <p className="calc-panel-label">{result.label}</p>
      <ul className="calc-scalars">
        {result.entries.map((e, i) => (
          <li className="calc-fade-in" style={{ animationDelay: `${staggerDelay(i)}ms` }} key={i}>
            <span>{e.label}</span>
            <strong>{typeof e.value === "number" ? <AnimatedNumber value={e.value} delay={staggerDelay(i)} /> : e.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Mounted only while its step is open, so its "Computing…" phase (and every AnimatedNumber
// inside it) re-triggers fresh each time the step is opened — closing and reopening the same
// step plays the whole computation again rather than just snapping back to the final numbers.
function StepBody({ step }: { step: ComputationStep }) {
  const [computing, setComputing] = useState(!prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setTimeout(() => setComputing(false), COMPUTING_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="calc-step-body">
      <p className="calc-step-desc">{step.description}</p>
      {computing ? (
        <div className="calc-computing">
          <span className="calc-computing-dot" />
          <span className="calc-computing-dot" />
          <span className="calc-computing-dot" />
          <span className="calc-computing-label">Computing…</span>
        </div>
      ) : (
        step.results.map((r, i) => <StepResultView result={r} key={i} />)
      )}
    </div>
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

function IconReplay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

// Which step is open, and whether auto-play is running, are owned by the parent (so auto-play can
// carry on from the last PCA step into the first LDA step); this component only renders the list.
function ComputationStepsList({
  steps,
  openStep,
  playing,
  onToggle,
}: {
  steps: ComputationStep[];
  openStep: number | null;
  playing: boolean;
  onToggle: (step: number) => void;
}) {
  const stepRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const isFirstRun = useRef(true);

  // When auto-play opens the next step, bring it into view (only if it isn't already visible).
  // Skipped on first mount so simply arriving at this section doesn't jump the page.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (!playing || openStep === null) return;
    stepRefs.current[openStep]?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
  }, [openStep, playing]);

  return (
    <div className="calc-steps-list">
      {steps.map((s) => {
        const isOpen = openStep === s.step;
        return (
          <div
            className={`calc-step ${isOpen ? "open" : ""}`}
            key={s.step}
            ref={(el) => {
              stepRefs.current[s.step] = el;
            }}
          >
            <button type="button" className="calc-step-head" onClick={() => onToggle(s.step)} aria-expanded={isOpen}>
              <IconChevron open={isOpen} />
              <span className="calc-step-num">Step {s.step}</span>
              <span className="calc-step-title">{s.title}</span>
              <span className="calc-step-formula">{s.formula}</span>
            </button>
            {isOpen && <StepBody step={s} />}
          </div>
        );
      })}
    </div>
  );
}

export default function AlgorithmComputationSteps({
  pcaSteps,
  ldaSteps,
}: {
  pcaSteps: ComputationStep[];
  ldaSteps: ComputationStep[];
}) {
  const [tab, setTab] = useState<"pca" | "lda">("pca");
  const [openStep, setOpenStep] = useState<number | null>(pcaSteps[0]?.step ?? null);
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);

  // PCA's steps followed by LDA's: the order auto-play walks through.
  const sequence = useMemo(
    () => [
      ...pcaSteps.map((step) => ({ tab: "pca" as const, step })),
      ...ldaSteps.map((step) => ({ tab: "lda" as const, step })),
    ],
    [pcaSteps, ldaSteps]
  );
  const position = sequence.findIndex((x) => x.tab === tab && x.step.step === openStep);

  function restart() {
    setTab(pcaSteps.length > 0 ? "pca" : "lda");
    setOpenStep((pcaSteps.length > 0 ? pcaSteps : ldaSteps)[0]?.step ?? null);
    setFinished(false);
    setPlaying(true);
  }

  // A new run (new data) starts the whole walk-through again.
  useEffect(() => {
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcaSteps, ldaSteps]);

  // Auto-advance: wait out the current step, then open the next one — across the PCA → LDA
  // boundary — and stop with "complete" after the last.
  useEffect(() => {
    if (!playing || position < 0) return;
    const timer = setTimeout(() => {
      const next = sequence[position + 1];
      if (next) {
        setTab(next.tab);
        setOpenStep(next.step.step);
      } else {
        setPlaying(false);
        setFinished(true);
      }
    }, estimateStepDurationMs(sequence[position].step));
    return () => clearTimeout(timer);
  }, [playing, position, sequence]);

  function handleToggleStep(step: number) {
    setPlaying(false);
    setOpenStep(openStep === step ? null : step);
  }

  function handleTab(next: "pca" | "lda") {
    setPlaying(false);
    setTab(next);
    setOpenStep((next === "pca" ? pcaSteps : ldaSteps)[0]?.step ?? null);
  }

  function handlePlayPause() {
    if (playing) {
      setPlaying(false);
    } else if (finished || position < 0) {
      restart();
    } else {
      setPlaying(true);
    }
  }

  const progressPct = sequence.length === 0 ? 0 : finished ? 100 : ((position + 1) / sequence.length) * 100;
  const statusText = finished
    ? `Computation complete — all ${sequence.length} steps shown`
    : position >= 0
    ? `${sequence[position].tab === "pca" ? "PCA" : "LDA"} · step ${position + 1} of ${sequence.length}${playing ? "" : " · paused"}`
    : "Paused";
  const buttonLabel = playing ? "Pause" : finished || position < 0 ? "Replay" : "Play";

  return (
    <div className="computation-steps-section">
      <div className="section-head">
        <h2>Step-by-Step Computation</h2>
      </div>
      <p className="meta">
        The real, computed values behind this run — from the raw uploaded data to the final output —
        following the PCA and LDA formulation step by step. The steps play automatically; pause at any
        time, or click a step to look at it more closely.
      </p>

      <div className="calc-controls">
        <button
          type="button"
          className="sim-module-pause"
          onClick={handlePlayPause}
          aria-label={`${buttonLabel} step-by-step computation`}
          title={buttonLabel}
        >
          {playing ? <IconPause /> : finished || position < 0 ? <IconReplay /> : <IconPlay />}
        </button>
        <div
          className="calc-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={sequence.length}
          aria-valuenow={finished ? sequence.length : position + 1}
          aria-label="Computation progress"
        >
          <div className="calc-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className={`calc-controls-status ${finished ? "done" : ""}`} aria-live="polite">
          {statusText}
        </span>
      </div>

      <div className="calc-tabs">
        <button type="button" className={`calc-tab ${tab === "pca" ? "active" : ""}`} onClick={() => handleTab("pca")}>
          PCA — Step 1
        </button>
        <button type="button" className={`calc-tab ${tab === "lda" ? "active" : ""}`} onClick={() => handleTab("lda")}>
          LDA — Step 2
        </button>
      </div>

      <ComputationStepsList
        key={tab}
        steps={tab === "pca" ? pcaSteps : ldaSteps}
        openStep={openStep}
        playing={playing}
        onToggle={handleToggleStep}
      />
    </div>
  );
}
