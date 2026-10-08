import { useState } from "react";

// ---------------------------------------------------------------------------
// SortInsights
//
// Everything the Sort Result Graph needs beyond the line/bar chart itself:
//
//   * SortPieChart       — a donut chart of each slice's share of rows. For columns with many
//                          distinct values the backend groups them first (numbers into value
//                          ranges, text into the most common values plus "Other"), so the pie
//                          stays readable for any column.
//   * SortInterpretation — a plain-language reading of the results plus suggested next steps,
//                          generated from the summary statistics /api/sort-preview computes over
//                          ALL filtered rows (not just the ≤300 points drawn on the graph).
//
// The wording is rule-based, not AI-generated, so it is instant, deterministic and offline.
// ---------------------------------------------------------------------------

export type SortSummary = {
  totalRows: number;
  blankCount: number;
  distinctCount: number;
  categories: { label: string; count: number }[];
  categoryMode: "values" | "ranges" | "top";
  topValues: { label: string; count: number }[];
  numeric?: {
    min: number;
    max: number;
    mean: number;
    median: number;
    q1: number;
    q3: number;
    stdDev: number;
    outlierLow: number;
    outlierHigh: number;
    lowFence: number;
    highFence: number;
  };
};

// Keep in sync with PIE_MAX_SLICES in the backend's index.ts.
const PIE_MAX_SLICES = 8;

const MODE_CAPTION: Record<SortSummary["categoryMode"], string> = {
  values: "Each slice is one value in the column, in sorted order.",
  ranges: "This column has many distinct numbers, so they are grouped into equal-width value ranges.",
  top: "This column has many distinct values, so the most common ones are shown and the rest are combined into “Other”.",
};

const SLICE_COLORS = ["#35604A", "#C4531D", "#8A9384", "#D9A441", "#5B7F95", "#7A4E6D", "#9BB59A", "#B08968"];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toLocaleString();
  return Number(n.toPrecision(4)).toLocaleString();
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

function shorten(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// ---------------------------------------------------------------------------
// Pie (donut) chart
// ---------------------------------------------------------------------------

export function SortPieChart({
  categories,
  categoryMode,
  columnLabel,
}: {
  categories: { label: string; count: number }[];
  categoryMode: SortSummary["categoryMode"];
  columnLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const total = categories.reduce((acc, c) => acc + c.count, 0);
  const size = 200;
  const center = size / 2;
  const radius = 64;
  const strokeWidth = 34;
  const circumference = 2 * Math.PI * radius;
  const gap = categories.length > 1 ? 1.5 : 0;

  let cumulative = 0;
  const slices = categories.map((c, i) => {
    const frac = total > 0 ? c.count / total : 0;
    const length = frac * circumference;
    const offset = -cumulative * circumference;
    cumulative += frac;
    return { ...c, i, length, offset, color: SLICE_COLORS[i % SLICE_COLORS.length] };
  });

  return (
    <div className="sort-pie-wrap">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="sort-pie-svg"
        role="img"
        aria-label={`Share of rows for each value of ${columnLabel}`}
      >
        <g transform={`rotate(-90 ${center} ${center})`}>
          {slices.map((s) => (
            <circle
              key={s.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={active === s.i ? strokeWidth + 6 : strokeWidth}
              strokeDasharray={`${Math.max(s.length - gap, 0)} ${circumference}`}
              strokeDashoffset={s.offset}
              opacity={active === null || active === s.i ? 1 : 0.45}
              style={{ transition: "opacity 0.15s ease, stroke-width 0.15s ease" }}
              onMouseEnter={() => setActive(s.i)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${s.label}: ${s.count.toLocaleString()} rows (${pct(s.count, total)})`}</title>
            </circle>
          ))}
        </g>
        <text x={center} y={center - 2} textAnchor="middle" className="sort-pie-center-num">
          {active !== null ? pct(slices[active].count, total) : total.toLocaleString()}
        </text>
        <text x={center} y={center + 14} textAnchor="middle" className="sort-pie-center-label">
          {active !== null ? shorten(slices[active].label, 14) : "rows"}
        </text>
      </svg>

      <ul className="sort-pie-legend">
        {slices.map((s) => (
          <li
            key={s.label}
            className={active === s.i ? "active" : ""}
            onMouseEnter={() => setActive(s.i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="legend-swatch" style={{ background: s.color }} />
            <span className="sort-pie-legend-label" title={s.label}>
              {shorten(s.label)}
            </span>
            <span className="sort-pie-legend-count">{s.count.toLocaleString()}</span>
            <span className="sort-pie-legend-pct">{pct(s.count, total)}</span>
          </li>
        ))}
      </ul>
      <p className="meta small sort-pie-caption">{MODE_CAPTION[categoryMode]}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interpretation + suggestions
// ---------------------------------------------------------------------------

type Suggestion = { tone: "warn" | "info" | "ok"; text: string };

export function interpretSort(
  summary: SortSummary,
  columnLabel: string,
  order: "asc" | "desc",
  isNumeric: boolean
): { insights: string[]; suggestions: Suggestion[] } {
  const insights: string[] = [];
  const suggestions: Suggestion[] = [];

  const nonBlank = summary.totalRows - summary.blankCount;
  const distinct = summary.distinctCount;
  const col = `"${columnLabel}"`;
  const direction = order === "asc" ? "smallest first" : "largest first";

  insights.push(
    `${summary.totalRows.toLocaleString()} row${summary.totalRows === 1 ? "" : "s"} were sorted by ${col} (${direction}), ` +
      `containing ${distinct.toLocaleString()} distinct value${distinct === 1 ? "" : "s"}.`
  );

  // ---- Degenerate case: nothing to sort ----
  if (nonBlank === 0) {
    insights.push(`Every cell in ${col} is blank, so the sort could not order anything.`);
    suggestions.push({ tone: "warn", text: "Pick a column that actually contains values to sort by." });
    return { insights, suggestions };
  }
  if (distinct === 1) {
    insights.push(`Every non-blank row holds the same value (${shorten(summary.topValues[0].label, 40)}), so sorting did not change the row order.`);
    suggestions.push({ tone: "info", text: "A constant column carries no information for sorting — try a column with more variation." });
  }

  // ---- Numeric columns ----
  if (isNumeric && summary.numeric && distinct > 1) {
    const n = summary.numeric;
    insights.push(
      `Values run from ${fmt(n.min)} to ${fmt(n.max)}, with a median of ${fmt(n.median)} and a mean of ${fmt(n.mean)}. ` +
        `The middle half of the rows sits between ${fmt(n.q1)} and ${fmt(n.q3)}.`
    );

    if (n.stdDev > 0) {
      const skew = (n.mean - n.median) / n.stdDev;
      if (skew > 0.3) {
        insights.push("The mean is noticeably above the median, so a minority of large values is pulling the average up (right-skewed).");
        suggestions.push({
          tone: "info",
          text: "Because the data is right-skewed, the median describes a typical row better than the mean. If you plan to analyse it, consider whether a log transform is appropriate.",
        });
      } else if (skew < -0.3) {
        insights.push("The mean is noticeably below the median, so a minority of small values is pulling the average down (left-skewed).");
        suggestions.push({
          tone: "info",
          text: "Because the data is left-skewed, the median describes a typical row better than the mean. Check whether the low values are genuine.",
        });
      } else {
        insights.push("The mean and median are close together, so the values are spread fairly symmetrically.");
      }
    }

    const outliers = n.outlierLow + n.outlierHigh;
    if (outliers > 0) {
      const where =
        n.outlierLow > 0 && n.outlierHigh > 0
          ? "at both ends"
          : n.outlierHigh > 0
          ? `at the ${order === "asc" ? "end" : "start"}`
          : `at the ${order === "asc" ? "start" : "end"}`;
      insights.push(
        `${outliers.toLocaleString()} value${outliers === 1 ? " is" : "s are"} unusually far from the rest ` +
          `(outside ${fmt(n.lowFence)} – ${fmt(n.highFence)}), and they sit ${where} of the sorted order.`
      );
      suggestions.push({
        tone: "warn",
        text: "Check those extreme rows for typos or unit mistakes. PCA standardizes columns and builds on variance, so a few extreme values can distort the components.",
      });
    }

    if (distinct <= PIE_MAX_SLICES) {
      insights.push(`Only ${distinct} distinct values appear, so this column behaves like a set of categories — each slice of the pie is one value.`);
    } else {
      const tieShare = (nonBlank - distinct) / nonBlank;
      if (tieShare > 0.3) {
        insights.push(`${pct(nonBlank - distinct, nonBlank)} of rows repeat a value that already appeared, so many rows tie in the sort.`);
        suggestions.push({
          tone: "info",
          text: "Rows with equal values keep their upload order. If the order within ties matters, sort by a more unique column.",
        });
      }
    }
  }

  // ---- Category-like columns (text, or numeric with few distinct values) ----
  // Share-of-rows insights only make sense when each slice is a real value, not a grouped range.
  const categoryLike = distinct > 1 && summary.categoryMode !== "ranges" && (summary.categoryMode === "values" || !isNumeric);
  if (categoryLike) {
    // In "top" mode the last slice is the combined "Other" bucket, which isn't a single value.
    const real = summary.categoryMode === "top" ? summary.categories.slice(0, -1) : summary.categories;
    const sorted = [...real].sort((a, b) => b.count - a.count);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const topShare = top.count / nonBlank;

    insights.push(
      `The most common value is "${shorten(top.label, 30)}" with ${top.count.toLocaleString()} rows (${pct(top.count, nonBlank)}); ` +
        `the least common is "${shorten(bottom.label, 30)}" with ${bottom.count.toLocaleString()} (${pct(bottom.count, nonBlank)}).`
    );

    if (topShare >= 0.6) {
      suggestions.push({
        tone: "warn",
        text: `One value makes up ${pct(top.count, nonBlank)} of the rows. If this column is the LDA class label, that imbalance can bias the discriminant toward the majority class — consider balancing the classes.`,
      });
    }
    if (bottom.count < 5 || bottom.count / nonBlank < 0.05) {
      suggestions.push({
        tone: "warn",
        text: `"${shorten(bottom.label, 30)}" has very few rows (${bottom.count.toLocaleString()}). As an LDA label, a class that small may be missing from the held-out 20% test split or be too thin to model reliably.`,
      });
    }
    if (topShare < 0.6 && bottom.count >= 5 && bottom.count / nonBlank >= 0.05) {
      suggestions.push({
        tone: "ok",
        text: "The values are reasonably balanced, so this column would work well as an LDA class label.",
      });
    }
  }

  // ---- High-cardinality text columns ----
  if (!isNumeric && distinct > PIE_MAX_SLICES) {
    const unique = distinct === nonBlank;
    insights.push(
      unique
        ? `Every value is unique, so ${col} looks like an identifier rather than a measurement.`
        : `${col} is text with ${distinct.toLocaleString()} distinct values.`
    );
    insights.push("Because there are so many different values, the pie shows only the most common ones and groups the rest under “Other”.");
    suggestions.push({
      tone: "info",
      text: unique
        ? "Sorting by an identifier is fine for ordering the export, but it won't reveal patterns. Pick a numeric column for a meaningful curve."
        : "To see every value as its own slice, filter down to 8 or fewer values first, or sort by a numeric column instead.",
    });
  }

  // ---- Blanks ----
  if (summary.blankCount > 0) {
    insights.push(`${summary.blankCount.toLocaleString()} row${summary.blankCount === 1 ? " has" : "s have"} a blank ${col} cell (${pct(summary.blankCount, summary.totalRows)}).`);
    suggestions.push({
      tone: "warn",
      text: "Decide how to treat the blank cells — fill them in or filter those rows out — before running the algorithms, since blanks are ordered separately and can skew the results.",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({ tone: "ok", text: "Nothing in this sort calls for cleanup. The column looks well-behaved, so you can move on to the next step." });
  }

  return { insights, suggestions };
}

const TONE_LABEL: Record<Suggestion["tone"], string> = { warn: "Check", info: "Tip", ok: "Good" };

export default function SortInterpretation({
  summary,
  columnLabel,
  order,
  isNumeric,
}: {
  summary: SortSummary;
  columnLabel: string;
  order: "asc" | "desc";
  isNumeric: boolean;
}) {
  const { insights, suggestions } = interpretSort(summary, columnLabel, order, isNumeric);

  return (
    <div className="sort-insights">
      <div className="sort-insights-block">
        <p className="sort-insights-heading">What the results show</p>
        <ul className="sort-insights-list">
          {insights.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="sort-insights-block">
        <p className="sort-insights-heading">Suggestions</p>
        <ul className="sort-suggestions">
          {suggestions.map((s, i) => (
            <li key={i} className={`sort-suggestion ${s.tone}`}>
              <span className="sort-suggestion-tag">{TONE_LABEL[s.tone]}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="meta small">
        Generated automatically from statistics of the sorted column across all rows — a starting point, not a verdict.
      </p>
    </div>
  );
}
