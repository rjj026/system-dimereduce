import { Matrix, EigenvalueDecomposition, inverse } from "ml-matrix";

// --- Where things live in this file -------------------------------------------------------
// Manuscript Ch.3 methodology: PCA and LDA run SEQUENTIALLY (see runAlgorithms() below), not
// independently — PCA first reduces the raw numeric features to X_PCA, and LDA is then fit on
// X_PCA rather than on the raw features (manuscript step "Y = X_PCA · V_lda").
//
// PCA (Principal Component Analysis)  -> runPCA()      — dimensionality reduction, unsupervised.
//   Implemented from scratch (no library) via the manuscript's own 4 steps: center the data,
//   compute the covariance matrix, eigen-decompose it, project onto the top eigenvectors. Doing
//   this by hand (rather than delegating to a PCA library) is what lets every intermediate value
//   — the mean vector, the covariance matrix, every eigenvalue, the chosen eigenvectors — be
//   captured and returned in `steps` for the thesis's step-by-step computation requirement.
// LDA (Linear Discriminant Analysis)  -> fitLDA() / runLDA() — supervised, needs a label column,
//   fit on PCA's output (X_PCA), not the raw features.
//   Implemented from scratch via the classic within/between-class scatter matrix generalized
//   eigenvalue problem (manuscript: S_w^-1 S_b v = λv): see the step-by-step comments inside
//   fitLDA(). runLDA() wraps fitLDA() twice — once on the full dataset (for the reported
//   components/scatter plot/steps) and once on a stratified 80/20 split (fitLDA on train, tested
//   on the held-out 20%) purely to produce a held-out accuracy figure; the two fits never affect
//   each other, and only the full-dataset fit's steps are reported.
// Numeric-column detection            -> detectNumericColumns() / looksLikeIdColumn()
//   Decides which sheet columns are candidates for PCA's raw input matrix (X) in the first place.
// Step-by-step computation capture    -> ComputationStep / StepResult types, buildPcaSteps(),
//   buildLdaSteps() — each algorithm's real, computed numbers (not illustrative placeholders),
//   formula-by-formula, for display in the app and inclusion in the thesis.
// Entry point (called from index.ts)  -> runAlgorithms() — validates inputs, runs the PCA→LDA
//   pipeline in sequence, and assigns collision-safe output column names (pickColumnNames()).
// ---------------------------------------------------------------------------------------------

export type AlgorithmComponent = {
  label: string;
  ratio: number; // percentage, 0-100
};

export type ScatterPoint = {
  class: string;
  x: number;
  y: number;
};

// A single panel of computed output within a ComputationStep. A step can show more than one of
// these (e.g. both the mean vector AND a preview of the centered data), so `results` on
// ComputationStep is an array of these rather than one fixed shape.
export type StepResult =
  | { kind: "vector"; label: string; values: number[]; labels?: string[] }
  | { kind: "matrix"; label: string; values: number[][]; rowLabels?: string[]; colLabels?: string[] }
  // Row-wise data (X, X_centered, X_PCA, ...) is potentially thousands of rows — `rows` is only
  // a preview (see PREVIEW_ROW_COUNT), with totalRows/shown telling the caller how much was cut.
  | { kind: "table"; label: string; columns: string[]; rows: (string | number)[][]; totalRows: number; shown: number }
  | { kind: "scalars"; label: string; entries: { label: string; value: number | string }[] };

export type ComputationStep = {
  step: number;
  title: string;
  formula: string;
  description: string;
  results: StepResult[];
};

export type AlgorithmsResult = {
  numericColumns: string[];
  rowsUsed: number;
  pca: {
    components: AlgorithmComponent[];
    columnNames: string[]; // e.g. ["PC1", "PC2"] — collision-safe against existing sheet columns
    scores: number[][]; // one entry per row, aligned to columnNames
    steps: ComputationStep[]; // Chapter 3, Step 1: PCA Formulation — with this run's real numbers
  };
  lda: {
    // Fit on pca.scores (X_PCA), not on the raw numericColumns — see runAlgorithms().
    labelColumn: string;
    classes: string[];
    components: AlgorithmComponent[];
    accuracy: number | null; // percentage, 0-100, or null if it couldn't be evaluated
    testSetSize: number;
    note?: string;
    columnNames: string[]; // e.g. ["LD1", "LD2"] — collision-safe against existing sheet columns
    scatter: ScatterPoint[]; // rows projected onto LD1/LD2 (LD2 = 0 if only one component exists)
    steps: ComputationStep[]; // Chapter 3, Step 2: LDA Formulation — with this run's real numbers
  };
};

// How many data rows to include in a step's row-wise preview (X_centered, X_PCA, Y, ...). Full
// datasets can be thousands of rows; the step display only needs enough to show the formula
// actually being applied, not a full re-render of the sheet (which the Before/After tables
// already cover elsewhere in the app).
const PREVIEW_ROW_COUNT = 8;
// Decimal places for numbers shown in step results — raw floats (0.30000000000000004) are
// unreadable; this keeps enough precision to verify the arithmetic by hand without the noise.
const DISPLAY_PRECISION = 5;

function round(n: number): number {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** DISPLAY_PRECISION;
  return Math.round(n * factor) / factor;
}

function roundRow(row: number[]): number[] {
  return row.map(round);
}

// Picks column names like "PC1"/"PC2" for the new algorithm-output columns, avoiding collisions
// with columns already in the sheet (e.g. if the user's data already has a "PC1" column).
function pickColumnNames(prefix: string, count: number, existingColumns: string[]): string[] {
  const existing = new Set(existingColumns);
  const names: string[] = [];
  for (let i = 1; i <= count; i++) {
    let base = `${prefix}${i}`;
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate) || names.includes(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix++;
    }
    names.push(candidate);
  }
  return names;
}

export class AlgorithmError extends Error {}

// A column is treated as numeric only if every row has a value that parses to a finite number.
// This is intentionally conservative: a single blank or text value excludes the column, so PCA/LDA
// never silently run on partially-numeric data.
//
// Columns that look like row identifiers (e.g. "ID", "StudentID", "student_id") are excluded even
// if numeric — they're labels, not measurements, and including them distorts PCA/LDA badly since
// they're often just a sequential counter with no real variance structure.
export function looksLikeIdColumn(header: string): boolean {
  const trimmed = header.trim();
  if (trimmed.toLowerCase() === "id") return true;
  if (/_id$/i.test(trimmed)) return true; // student_id, row_id
  if (trimmed.length > 2 && trimmed.slice(-2) === "ID") return true; // StudentID, RowID (camelCase)
  return false;
}

export function detectNumericColumns(
  rows: Record<string, unknown>[],
  columns: string[],
  exclude: string[] = []
): string[] {
  return columns.filter((col) => {
    if (exclude.includes(col)) return false;
    if (looksLikeIdColumn(col)) return false;
    return rows.every((row) => {
      const val = row[col];
      if (val === "" || val === null || val === undefined) return false;
      const n = Number(val);
      return Number.isFinite(n);
    });
  });
}

function toMatrix(rows: Record<string, unknown>[], numericColumns: string[]): number[][] {
  return rows.map((row) => numericColumns.map((col) => Number(row[col])));
}

function mean(rows: number[][]): number[] {
  const d = rows[0].length;
  const m = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) m[j] += r[j] / rows.length;
  return m;
}

function outer(a: number[], b: number[]): Matrix {
  const m = new Matrix(a.length, b.length);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) m.set(i, j, a[i] * b[j]);
  return m;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- PCA -------------------------------------------------------------------------------------
// Manuscript Ch.3, "Step 1: PCA Formulation", computed from scratch with ml-matrix so every
// intermediate value below is real (this run's actual numbers), not illustrative.
//
//   1. X_centered = X - μ                          (center())
//   2. C = (1 / (n-1)) · X_centered^T · X_centered  (covariance())
//   3. C V_k = V_k Λ                                (eigen-decomposition of C, top-k kept)
//   4. X_PCA = X_centered · V_k                     (projection)
//
// Objective being maximized: Tr(V_k^T C V_k) — the variance captured in the reduced space.

function buildPcaSteps(args: {
  numericColumns: string[];
  n: number;
  meanVector: number[];
  centered: Matrix;
  covariance: Matrix;
  sortedEigenvalues: number[]; // ALL eigenvalues, descending
  varianceExplainedPct: number[]; // ALL, aligned to sortedEigenvalues, sums to 100
  numComponents: number;
  Vk: Matrix; // d x numComponents, columns = chosen eigenvectors
  pcaColumnNames: string[];
  scores: number[][]; // n x numComponents
}): ComputationStep[] {
  const { numericColumns, n, meanVector, centered, covariance, sortedEigenvalues, varianceExplainedPct, numComponents, Vk, pcaColumnNames, scores } = args;

  const centeredPreviewRows = centered.to2DArray().slice(0, PREVIEW_ROW_COUNT).map(roundRow);
  const scoresPreviewRows = scores.slice(0, PREVIEW_ROW_COUNT).map(roundRow);

  return [
    {
      step: 1,
      title: "Center the Data",
      formula: "X_centered = X − μ",
      description:
        `Each of the ${numericColumns.length} numeric column(s) is centered by subtracting its own mean (μ), so PCA measures ` +
        "variation around zero rather than around each column's raw scale. This is the preprocessing step for PCA fitting.",
      results: [
        { kind: "vector", label: "Mean vector (μ)", values: meanVector.map(round), labels: numericColumns },
        {
          kind: "table",
          label: "X_centered (preview)",
          columns: numericColumns,
          rows: centeredPreviewRows,
          totalRows: n,
          shown: centeredPreviewRows.length,
        },
      ],
    },
    {
      step: 2,
      title: "Compute the Covariance Matrix",
      formula: "C = (1 / (n − 1)) · X_centeredᵀ · X_centered",
      description:
        "Describes how every pair of numeric columns varies together across all rows — the raw material PCA searches for structure in.",
      results: [
        {
          kind: "matrix",
          label: `Covariance matrix (C), ${numericColumns.length}×${numericColumns.length}`,
          values: covariance.to2DArray().map(roundRow),
          rowLabels: numericColumns,
          colLabels: numericColumns,
        },
      ],
    },
    {
      step: 3,
      title: "Eigen Decomposition",
      formula: "C · V = V · Λ",
      description:
        `Eigenvectors of C point along the directions of greatest spread in the data; their eigenvalues (Λ) rank how much variance ` +
        `each direction explains. The top ${numComponents} eigenvector(s) — by largest eigenvalue — are kept as V_k and become ` +
        `${pcaColumnNames.join("/")}.`,
      results: [
        { kind: "vector", label: "Eigenvalues (Λ), sorted descending", values: sortedEigenvalues.map(round) },
        { kind: "vector", label: "Variance explained per component (%)", values: varianceExplainedPct.map(round) },
        {
          kind: "matrix",
          label: `Selected eigenvectors (V_k columns) — ${pcaColumnNames.join(", ")}`,
          values: Vk.to2DArray().map(roundRow),
          rowLabels: numericColumns,
          colLabels: pcaColumnNames,
        },
      ],
    },
    {
      step: 4,
      title: "Project Data onto Principal Components",
      formula: "X_PCA = X_centered · V_k",
      description: "Each row's original values are converted into its coordinates along the kept principal component(s).",
      results: [
        {
          kind: "table",
          label: "X_PCA (preview)",
          columns: pcaColumnNames,
          rows: scoresPreviewRows,
          totalRows: n,
          shown: scoresPreviewRows.length,
        },
      ],
    },
  ];
}

function runPCA(
  matrixRows: number[][],
  numericColumns: string[],
  pcaColumnNames: string[]
): { components: AlgorithmComponent[]; scores: number[][]; steps: ComputationStep[] } {
  const n = matrixRows.length;
  const d = matrixRows[0].length;

  // Step 1: X_centered = X - μ
  const meanVector = mean(matrixRows);
  const X = new Matrix(matrixRows);
  const centered = X.subRowVector(meanVector);

  // Step 2: C = (1/(n-1)) X_centered^T X_centered
  const covariance = centered.transpose().mmul(centered).div(Math.max(1, n - 1));

  // Step 3: C V = V Λ. Covariance matrices are symmetric, so all eigenvalues are real.
  const evd = new EigenvalueDecomposition(covariance);
  const eigenvalues = evd.realEigenvalues;
  const eigenvectors = evd.eigenvectorMatrix; // columns are eigenvectors, aligned to eigenvalues

  const order = eigenvalues.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const totalVariance = order.reduce((sum, o) => sum + Math.max(o.v, 0), 0) || 1;
  const sortedEigenvalues = order.map((o) => o.v);
  const varianceExplainedPct = order.map((o) => (Math.max(o.v, 0) / totalVariance) * 100);

  // Keep the top 2 components — the 2D scatter/report visualization elsewhere in the app depends
  // on exactly PC1/PC2 existing, so this is fixed rather than picked via a variance threshold.
  const numComponents = Math.min(2, d);
  const topIdx = order.slice(0, numComponents).map((o) => o.i);

  const Vk = new Matrix(d, numComponents);
  topIdx.forEach((colIdx, k) => {
    const col = eigenvectors.getColumn(colIdx);
    for (let r = 0; r < d; r++) Vk.set(r, k, col[r]);
  });

  // Step 4: X_PCA = X_centered · V_k
  const projected = centered.mmul(Vk);
  const scores: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < numComponents; j++) row.push(projected.get(i, j));
    scores.push(row);
  }

  const components = topIdx.map((idx, k) => ({
    label: pcaColumnNames[k],
    ratio: (Math.max(eigenvalues[idx], 0) / totalVariance) * 100,
  }));

  const steps = buildPcaSteps({
    numericColumns,
    n,
    meanVector,
    centered,
    covariance,
    sortedEigenvalues,
    varianceExplainedPct,
    numComponents,
    Vk,
    pcaColumnNames,
    scores,
  });

  return { components, scores, steps };
}

// --- LDA -------------------------------------------------------------------------------------

type FittedLDA = {
  classes: string[];
  classMeans: Record<string, number[]>;
  overallMean: number[];
  components: { label: string; ratio: number; vector: number[] }[];
  // Captured purely for step display (the full-dataset fit only — see runLDA).
  debug: {
    Sw: Matrix;
    Sb: Matrix;
    epsilon: number;
    sortedEigenvalues: number[];
    ratios: number[];
  };
};

// Fisher's Linear Discriminant Analysis, fit from scratch (no library). Input (trainX) is X_PCA
// — PCA's projected output, per the manuscript's sequential pipeline — not the raw features.
// Manuscript Ch.3 "LDA Formulation" steps 1-3:
//   1. Within-class scatter matrix: S_w = sum over all rows of (row - its class mean)(row - its
//      class mean)^T — quantifies the spread of points within each class.
//   2. Between-class scatter matrix: S_b = sum over classes of classSize * (classMean -
//      overallMean)(classMean - overallMean)^T — the distance of each class mean from the
//      overall mean.
//   3. Generalized eigenvalue problem: S_w^-1 S_b v = λv. Solved here via a plain eigen-
//      decomposition of the product matrix M = S_w^-1 S_b (after regularizing S_w — see the
//      shrinkage comment below). The top eigenvectors v (by eigenvalue λ, i.e. by how much
//      between-class variance they capture relative to within-class variance) are the LDA
//      discriminant vectors V_lda (LD1, LD2, ...); each eigenvalue's share of the total positive
//      eigenvalue sum becomes that component's reported ratio. Manuscript's LDA objective —
//      maximize the ratio of between-class to within-class variance — is exactly this quantity.
//      (Projecting a row onto V_lda, i.e. Y = X_PCA · V_lda, happens separately in project().)
function fitLDA(trainX: number[][], trainY: string[]): FittedLDA {
  const d = trainX[0].length;
  const classes = Array.from(new Set(trainY)).sort();
  const overallMean = mean(trainX);

  let Sw = Matrix.zeros(d, d);
  let Sb = Matrix.zeros(d, d);
  const classMeans: Record<string, number[]> = {};

  for (const c of classes) {
    const classRows = trainX.filter((_, i) => trainY[i] === c);
    const cMean = mean(classRows);
    classMeans[c] = cMean;
    for (const row of classRows) {
      const diff = row.map((v, j) => v - cMean[j]);
      Sw = Sw.add(outer(diff, diff)); // manuscript step 1: within-class scatter S_w
    }
    const diffOverall = cMean.map((v, j) => v - overallMean[j]);
    Sb = Sb.add(outer(diffOverall, diffOverall).mul(classRows.length)); // manuscript step 2: between-class scatter S_b
  }

  // Shrinkage regularization so Sw is always invertible, even with few samples per class.
  const trace = Sw.diagonal().reduce((a, b) => a + b, 0);
  const epsilon = Math.max(1e-6, 1e-6 * (trace / d));
  const SwRegularized = Sw.add(Matrix.eye(d).mul(epsilon));

  const SwInv = inverse(SwRegularized);
  const M = SwInv.mmul(Sb); // manuscript step 3a: forms S_w^-1 S_b for the eigenproblem S_w^-1 S_b v = λv

  const evd = new EigenvalueDecomposition(M); // manuscript step 3b: solves it via eigen-decomposition of M
  const realEig = evd.realEigenvalues;
  const eigVectors = evd.eigenvectorMatrix;

  const order = realEig.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  // Manuscript's LDA Discriminant Constraint: 1 <= #discriminants <= c - 1 (classes.length - 1).
  const numComponents = Math.min(classes.length - 1, d);
  const topComponents = order.slice(0, Math.min(2, numComponents));
  const totalPositive = order.reduce((sum, o) => sum + Math.max(o.v, 0), 0) || 1;

  const components = topComponents.map((o, idx) => ({
    label: `LD${idx + 1}`,
    ratio: (Math.max(o.v, 0) / totalPositive) * 100,
    vector: eigVectors.getColumn(o.i),
  }));

  return {
    classes,
    classMeans,
    overallMean,
    components,
    debug: {
      Sw, // unregularized, for display — matches the manuscript's formula exactly
      Sb,
      epsilon,
      sortedEigenvalues: order.map((o) => o.v),
      ratios: order.map((o) => (Math.max(o.v, 0) / totalPositive) * 100),
    },
  };
}

// Manuscript step "Project PCA-transformed data onto LDA space": Y = X_PCA · V_lda. `row` here is
// one record of X_PCA (already PCA-projected); `components[].vector` are the columns of V_lda.
// (Fisher's LDA projects the CENTERED input, so this also subtracts overallMean first.)
function project(row: number[], overallMean: number[], components: { vector: number[] }[]): number[] {
  const centered = row.map((v, j) => v - overallMean[j]);
  return components.map((c) => c.vector.reduce((sum, w, j) => sum + w * centered[j], 0));
}

function buildLdaSteps(args: {
  pcaColumnNames: string[];
  ldaColumnNames: string[];
  fit: FittedLDA;
  n: number;
  scatter: ScatterPoint[];
}): ComputationStep[] {
  const { pcaColumnNames, ldaColumnNames, fit, n, scatter } = args;
  const { classes, classMeans, overallMean, debug } = fit;

  const classMeanRows = classes.map((c) => roundRow(classMeans[c]));
  const scatterPreview = scatter
    .slice(0, PREVIEW_ROW_COUNT)
    .map((p) =>
      ldaColumnNames.length > 1
        ? ([p.class, round(p.x), round(p.y)] as (string | number)[])
        : ([p.class, round(p.x)] as (string | number)[])
    );
  const scatterColumns = ldaColumnNames.length > 1 ? ["Class", ...ldaColumnNames] : ["Class", ldaColumnNames[0]];

  return [
    {
      step: 1,
      title: "Within-Class Scatter Matrix",
      formula: "S_w = Σ_c Σ_(x ∈ c) (x − μ_c)(x − μ_c)ᵀ",
      description:
        `Measures how spread out the rows inside each of the ${classes.length} class(es) are around that class's own mean (μ_c), ` +
        "computed on X_PCA (PCA's output), per the manuscript's sequential PCA→LDA pipeline.",
      results: [
        {
          kind: "matrix",
          label: "Class means (μ_c)",
          values: classMeanRows,
          rowLabels: classes,
          colLabels: pcaColumnNames,
        },
        {
          kind: "matrix",
          label: `Within-class scatter matrix (S_w), ${pcaColumnNames.length}×${pcaColumnNames.length}`,
          values: debug.Sw.to2DArray().map(roundRow),
          rowLabels: pcaColumnNames,
          colLabels: pcaColumnNames,
        },
      ],
    },
    {
      step: 2,
      title: "Between-Class Scatter Matrix",
      formula: "S_b = Σ_c n_c (μ_c − μ)(μ_c − μ)ᵀ",
      description: "Measures how far apart the different classes' means (μ_c) are from each other and from the overall mean (μ).",
      results: [
        { kind: "vector", label: "Overall mean (μ)", values: overallMean.map(round), labels: pcaColumnNames },
        {
          kind: "matrix",
          label: `Between-class scatter matrix (S_b), ${pcaColumnNames.length}×${pcaColumnNames.length}`,
          values: debug.Sb.to2DArray().map(roundRow),
          rowLabels: pcaColumnNames,
          colLabels: pcaColumnNames,
        },
      ],
    },
    {
      step: 3,
      title: "Generalized Eigenvalue Problem",
      formula: "S_w⁻¹ S_b v = λv",
      description:
        "S_w is regularized (shrinkage) so it's always invertible, then S_w⁻¹S_b is formed and eigen-decomposed. The top " +
        `eigenvector(s) — by largest eigenvalue λ, i.e. by ratio of between-class to within-class variance — become V_lda ` +
        `(${ldaColumnNames.join("/")}).`,
      results: [
        { kind: "scalars", label: "Shrinkage regularization", entries: [{ label: "ε added to diagonal of S_w", value: round(debug.epsilon) }] },
        { kind: "vector", label: "Eigenvalues (λ), sorted descending", values: debug.sortedEigenvalues.map(round) },
        { kind: "vector", label: "Discriminant ratio per component (%)", values: debug.ratios.map(round) },
      ],
    },
    {
      step: 4,
      title: "Project Data onto LDA Space",
      formula: "Y = X_PCA · V_lda",
      description: "Each row of X_PCA is projected onto the discriminant vector(s), producing the final classification-ready output.",
      results: [
        {
          kind: "table",
          label: "Y (LDA-projected preview)",
          columns: scatterColumns,
          rows: scatterPreview,
          totalRows: n,
          shown: scatterPreview.length,
        },
      ],
    },
  ];
}

function runLDA(matrixRows: number[][], labels: string[], ldaColumnNames: string[], pcaColumnNames: string[]) {
  const classes = Array.from(new Set(labels));
  if (classes.length < 2) {
    throw new AlgorithmError("The selected label column needs at least 2 distinct values for LDA.");
  }

  // Fit on the full dataset — this is the "official" model: its components, explained-variance
  // ratios, and step-by-step values describe the whole dataset, and we project every row through
  // it for the scatter view.
  const fullFit = fitLDA(matrixRows, labels);
  const scatter: ScatterPoint[] = matrixRows.map((row, i) => {
    const p = project(row, fullFit.overallMean, fullFit.components);
    return { class: labels[i], x: p[0] ?? 0, y: p[1] ?? 0 };
  });

  const steps = buildLdaSteps({ pcaColumnNames, ldaColumnNames, fit: fullFit, n: matrixRows.length, scatter });

  // Separately, fit on a stratified 80/20 split so accuracy reflects generalization to unseen rows
  // rather than the optimistic in-sample number you'd get from testing on the same data it was fit on.
  const trainIdx: number[] = [];
  const testIdx: number[] = [];
  for (const c of classes) {
    const idxs = seededShuffle(
      labels.map((_, i) => i).filter((i) => labels[i] === c),
      42
    );
    const cut = Math.max(1, Math.round(idxs.length * 0.8));
    trainIdx.push(...idxs.slice(0, cut));
    testIdx.push(...idxs.slice(cut));
  }

  const trainX = trainIdx.map((i) => matrixRows[i]);
  const trainY = trainIdx.map((i) => labels[i]);
  const testX = testIdx.map((i) => matrixRows[i]);
  const testY = testIdx.map((i) => labels[i]);

  const heldOutFit = fitLDA(trainX, trainY);

  let accuracy: number | null = null;
  let note: string | undefined;

  if (testX.length === 0) {
    note = "Every class had too few rows to hold out a test set, so accuracy could not be measured.";
  } else {
    const centroidsInLDA: Record<string, number[]> = {};
    for (const c of heldOutFit.classes) {
      centroidsInLDA[c] = project(heldOutFit.classMeans[c], heldOutFit.overallMean, heldOutFit.components);
    }
    const classify = (row: number[]): string => {
      const p = project(row, heldOutFit.overallMean, heldOutFit.components);
      let best = heldOutFit.classes[0];
      let bestDist = Infinity;
      for (const c of heldOutFit.classes) {
        const dist = centroidsInLDA[c].reduce((sum, v, j) => sum + (v - p[j]) ** 2, 0);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      return best;
    };
    let correct = 0;
    for (let i = 0; i < testX.length; i++) {
      if (classify(testX[i]) === testY[i]) correct++;
    }
    accuracy = (correct / testX.length) * 100;
    if (testX.length < 5) {
      note = `Held out only ${testX.length} row(s) for testing — accuracy is indicative, not statistically reliable.`;
    }
  }

  return {
    classes: fullFit.classes,
    components: fullFit.components.map((c) => ({ label: c.label, ratio: c.ratio })),
    accuracy,
    testSetSize: testX.length,
    note,
    scatter,
    steps,
  };
}

export function runAlgorithms(
  rows: Record<string, unknown>[],
  columns: string[],
  labelColumn: string
): AlgorithmsResult {
  if (!columns.includes(labelColumn)) {
    throw new AlgorithmError(`Column "${labelColumn}" does not exist in the sheet.`);
  }

  const numericColumns = detectNumericColumns(rows, columns, [labelColumn]);
  if (numericColumns.length < 2) {
    throw new AlgorithmError(
      "Need at least 2 fully-numeric columns (besides the label column) to run PCA/LDA."
    );
  }
  if (rows.length < 4) {
    throw new AlgorithmError("Need at least 4 rows to run PCA/LDA meaningfully.");
  }

  const matrix = toMatrix(rows, numericColumns);
  const labels = rows.map((r) => String(r[labelColumn]));

  // Column names are picked up front so both PCA and LDA's step builders can label their
  // matrices/tables with the actual output column names (PC1/PC2, LD1/LD2, ...) rather than
  // generic indices.
  const pcaColumnNames = pickColumnNames("PC", Math.min(2, numericColumns.length), columns);

  // Manuscript Ch.3 methodology: PCA and LDA run SEQUENTIALLY, not independently on the same raw
  // features. PCA first produces X_PCA (pcaResult.scores); LDA is then fit on X_PCA rather than
  // on the raw numeric matrix ("Project PCA-transformed data onto LDA space: Y = X_PCA · V_lda").
  // This also means LDA's input dimensionality is however many PCA components were kept, not
  // numericColumns.length.
  const pcaResult = runPCA(matrix, numericColumns, pcaColumnNames);

  const classes = Array.from(new Set(labels));
  const ldaNumComponents = Math.min(Math.max(classes.length - 1, 0), pcaResult.scores[0]?.length ?? 0, 2);
  const ldaColumnNames = pickColumnNames("LD", Math.max(1, ldaNumComponents), columns.concat(pcaColumnNames));

  const ldaResult = runLDA(pcaResult.scores, labels, ldaColumnNames, pcaColumnNames);

  return {
    numericColumns,
    rowsUsed: rows.length,
    pca: {
      components: pcaResult.components,
      columnNames: pcaColumnNames,
      scores: pcaResult.scores,
      steps: pcaResult.steps,
    },
    lda: {
      labelColumn,
      classes: ldaResult.classes,
      components: ldaResult.components,
      accuracy: ldaResult.accuracy,
      testSetSize: ldaResult.testSetSize,
      note: ldaResult.note,
      columnNames: ldaColumnNames,
      scatter: ldaResult.scatter,
      steps: ldaResult.steps,
    },
  };
}