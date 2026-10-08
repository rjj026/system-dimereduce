import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake";

const fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

const COLOR_INK = "#1C2621";
const COLOR_INK_SOFT = "#5B6459";
const COLOR_RULE = "#C3CBBB";
const COLOR_PAPER = "#EDEFE7";
const COLOR_STRIPE = "#F6F7F3";
const COLOR_BAR_BEFORE = "#8A9384";
const COLOR_BAR_BEFORE_LIGHT = "#B9C2AF";
const COLOR_BAR_AFTER = "#3F5B4C";
const COLOR_BAR_AFTER_LIGHT = "#6C8879";
const COLOR_BAR_REDUCED = "#B1553A";
const COLOR_BAR_REDUCED_LIGHT = "#D08A75";

export type RemovedRowSection = {
  label: string;
  description: string;
  rows: Record<string, unknown>[];
};

export type PdfExportMeta = {
  fileName: string;
  rowCount: number;
  filterDescription?: string;
  sortDescription?: string;
  // Row counts for the "Rows Reduced" summary chart. Both optional so callers that don't have
  // this context (or ever stop tracking it) simply get a PDF without the chart section.
  rowsBeforeProcessing?: number;
  rowsAfterProcessing?: number;
  // "Before and After Filtering" text summary: total uploaded vs. rows remaining once THIS
  // export's filter ran. Distinct from rowsBeforeProcessing/rowsAfterProcessing above (which,
  // when algoRowsUsed is supplied, instead compares uploaded vs. algorithm-used rows) — this one
  // is specifically the filtering figure, always uploaded-count vs. post-filter count.
  filteringSummary?: { totalUploaded: number; remainingAfterFiltering: number };
  // Rows still sitting in a "bin" (removed at upload via dedup, and/or excluded by this export's
  // filter), grouped by why they were removed. Each non-empty section gets its own appendix
  // table after the main one, so removed-rows history can be reviewed from inside the PDF itself.
  removedRowSections?: RemovedRowSection[];
};

// Height (pt) of the tallest possible bar in the chart.
const CHART_BAR_MAX_HEIGHT = 90;
const CHART_BAR_WIDTH = 56;
const CHART_BAR_GAP = 28;
// Each bar is rendered as a row of thin vertical stripes rather than one solid block, echoing
// the app's own sort-preview chart (many slim bars in a single accent color).
const CHART_STRIPE_COUNT = 9;
const CHART_STRIPE_GAP = 1;

function buildStripedBarShapes(width: number, height: number, colorDark: string, colorLight: string) {
  const stripeWidth = (width - (CHART_STRIPE_COUNT - 1) * CHART_STRIPE_GAP) / CHART_STRIPE_COUNT;
  const shapes: Record<string, unknown>[] = [];
  for (let i = 0; i < CHART_STRIPE_COUNT; i++) {
    shapes.push({
      type: "rect",
      x: i * (stripeWidth + CHART_STRIPE_GAP),
      y: 0,
      w: stripeWidth,
      h: height,
      color: i % 2 === 0 ? colorDark : colorLight,
    });
  }
  return shapes;
}

// Builds one striped bar (bottom-aligned within a fixed-height column) plus its value and label
// underneath, sized relative to `maxValue` so all three bars in the row share one scale.
function buildBar(label: string, value: number, maxValue: number, colorDark: string, colorLight: string) {
  // Deliberately NOT rounded: when "Rows Before" and "Rows After" are both large and close
  // together (e.g. 5000 vs 4980), rounding to a whole point collapses both to the same pixel
  // height (round(5000/5000*90) === round(4980/5000*90) === 90), making the two bars look
  // identical even though the row counts differ. Keeping the fractional height preserves that
  // difference, however small.
  const barHeight = maxValue > 0 ? (value / maxValue) * CHART_BAR_MAX_HEIGHT : 0;
  // Keep a sliver visible even for a value of 0, so the bar (and its label) doesn't disappear.
  const drawnHeight = Math.max(barHeight, value > 0 ? 2 : 1);

  return {
    width: CHART_BAR_WIDTH,
    stack: [
      {
        canvas: buildStripedBarShapes(CHART_BAR_WIDTH, drawnHeight, colorDark, colorLight),
        margin: [0, CHART_BAR_MAX_HEIGHT - drawnHeight, 0, 0] as [number, number, number, number],
      },
      {
        text: value.toLocaleString(),
        alignment: "center" as const,
        fontSize: 9,
        bold: true,
        color: COLOR_INK,
        margin: [0, 4, 0, 0] as [number, number, number, number],
      },
      {
        text: label,
        alignment: "center" as const,
        fontSize: 7.5,
        color: COLOR_INK_SOFT,
        margin: [0, 1, 0, 0] as [number, number, number, number],
      },
    ],
  };
}

// "Rows Before" / "Rows After" / "Rows Reduced" bar chart, summarizing how many rows the
// upload's smart-import + duplicate-removal step took out of the original dataset. Leads with an
// explicit "rows remaining" readout so that figure doesn't have to be read off the bar heights.
function buildRowsReducedChart(rowsBefore: number, rowsAfter: number) {
  const rowsReduced = Math.max(0, rowsBefore - rowsAfter);
  const maxValue = Math.max(rowsBefore, rowsAfter, rowsReduced, 1);
  const chartWidth = CHART_BAR_WIDTH * 3 + CHART_BAR_GAP * 2;

  return {
    margin: [0, 2, 0, 14] as [number, number, number, number],
    stack: [
      { text: "Row Reduction Summary", fontSize: 11, bold: true, color: COLOR_INK, margin: [0, 0, 0, 4] },
      {
        text: [
          { text: "Rows remaining after processing:  ", fontSize: 9.5, color: COLOR_INK_SOFT },
          { text: rowsAfter.toLocaleString(), fontSize: 10.5, bold: true, color: COLOR_BAR_AFTER },
        ],
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },
      {
        columns: [
          buildBar("Rows Before", rowsBefore, maxValue, COLOR_BAR_BEFORE, COLOR_BAR_BEFORE_LIGHT),
          buildBar("Rows After", rowsAfter, maxValue, COLOR_BAR_AFTER, COLOR_BAR_AFTER_LIGHT),
          buildBar("Rows Reduced", rowsReduced, maxValue, COLOR_BAR_REDUCED, COLOR_BAR_REDUCED_LIGHT),
        ],
        columnGap: CHART_BAR_GAP,
      },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: chartWidth, y2: 0, lineWidth: 0.75, lineColor: COLOR_RULE }],
      },
    ],
  };
}

// "Before and After Filtering" text summary — total uploaded content vs. content remaining once
// this export's filter ran, plus how much was filtered out and the formula behind that figure.
// Deliberately plain text (not a chart) and worded to match the manuscript's reporting format
// exactly: "Total uploaded content", "Content remaining after filtering", "Content filtered out".
function buildFilteringSummary(totalUploaded: number, remainingAfterFiltering: number) {
  const filteredOut = Math.max(0, totalUploaded - remainingAfterFiltering);
  const bullet = (label: string, value: number) => ({
    text: [
      { text: "•  ", fontSize: 9.5, color: COLOR_INK_SOFT },
      { text: `${label}: `, fontSize: 9.5, color: COLOR_INK_SOFT },
      { text: value.toLocaleString(), fontSize: 9.5, bold: true, color: COLOR_INK },
    ],
    margin: [0, 0, 0, 2] as [number, number, number, number],
  });

  return {
    margin: [0, 2, 0, 16] as [number, number, number, number],
    stack: [
      { text: "Before and After Filtering", fontSize: 11, bold: true, color: COLOR_INK, margin: [0, 0, 0, 6] },
      {
        text:
          "The system compares the total number of uploaded content before filtering with the number of content remaining after the filtering process.",
        fontSize: 8.5,
        color: COLOR_INK_SOFT,
        margin: [0, 0, 0, 8] as [number, number, number, number],
      },
      { text: "Before Filtering", fontSize: 9.5, bold: true, color: COLOR_INK, margin: [0, 0, 0, 3] },
      bullet("Total uploaded content", totalUploaded),
      { text: "After Filtering", fontSize: 9.5, bold: true, color: COLOR_INK, margin: [6, 6, 0, 3] as [number, number, number, number] },
      bullet("Content remaining after filtering", remainingAfterFiltering),
      bullet("Content filtered out", filteredOut),
      {
        text:
          "The Before value represents the complete set of uploaded content, while the After value represents the content that remained after applying the system's filtering and classification process.",
        fontSize: 8.5,
        color: COLOR_INK_SOFT,
        margin: [0, 8, 0, 8] as [number, number, number, number],
      },
      { text: "Formula:", fontSize: 9, bold: true, color: COLOR_INK, margin: [0, 0, 0, 2] },
      {
        text: "Filtered Out = Total Uploaded - Remaining After Filtering",
        fontSize: 9,
        font: "Helvetica",
        italics: true,
        color: COLOR_INK_SOFT,
        margin: [0, 0, 0, 2] as [number, number, number, number],
      },
      {
        text: `${totalUploaded.toLocaleString()} - ${remainingAfterFiltering.toLocaleString()} = ${filteredOut.toLocaleString()}`,
        fontSize: 9,
        italics: true,
        color: COLOR_INK_SOFT,
        margin: [0, 0, 0, 8] as [number, number, number, number],
      },
      {
        text: `Therefore, ${remainingAfterFiltering.toLocaleString()} out of ${totalUploaded.toLocaleString()} uploaded items remained after filtering.`,
        fontSize: 9,
        color: COLOR_INK,
      },
      {
        canvas: [{ type: "line", x1: 0, y1: 12, x2: 250, y2: 12, lineWidth: 0.75, lineColor: COLOR_RULE }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Column layout
//
// pdfmake's "*" widths can't shrink a column below its longest word, so a wide sheet used to push
// the table off the right edge of the page and hide every column past the first few. Instead the
// layout is planned from the real content:
//
//   1. Measure each column (Helvetica metrics) so it is as wide as its longest value — capped at
//      MAX_COLUMN_WIDTH, beyond which text simply wraps onto more lines, never truncates.
//   2. Use the smallest page that fits every column at that width: A4 portrait, then A4
//      landscape, then A3 landscape.
//   3. If even A3 is too narrow, keep A4 landscape and split the columns into groups ("bands"),
//      each printed as its own full-height table with a "#" row-number column repeated, so rows
//      can still be matched up across groups.
// ---------------------------------------------------------------------------------------------

// Helvetica advance widths (1/1000 em) for ASCII 32–126. Anything else is treated as average width.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const AVERAGE_CHAR_WIDTH = 556;
const BOLD_FACTOR = 1.08; // Helvetica-Bold runs a little wider than regular

function charWidth(code: number): number {
  return code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32] : AVERAGE_CHAR_WIDTH;
}

// Width in points of the widest line of `text` (cells can contain line breaks).
function textWidth(text: string, fontSize: number, bold = false): number {
  let widest = 0;
  for (const line of text.split(/\r?\n/)) {
    let w = 0;
    for (let i = 0; i < line.length; i++) w += charWidth(line.charCodeAt(i));
    widest = Math.max(widest, w);
  }
  return ((widest * fontSize) / 1000) * (bold ? BOLD_FACTOR : 1);
}

// Cell text as a string ("" for null/undefined) — one place so measuring and rendering agree.
function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

// Space a cell uses besides its text: left+right margin (3+3), the two 0.5pt borders, and a little
// slack for rounding in the font metrics above.
const CELL_H_OVERHEAD = 3 + 3 + 1 + 2;
// Widest a column may grow; longer text wraps within it.
const MAX_COLUMN_WIDTH = 150;
const PAGE_MARGIN_X = 24;

type PageChoice = { pageSize: "A4" | "A3"; pageOrientation: "portrait" | "landscape"; width: number };
const PAGE_CHOICES: PageChoice[] = [
  { pageSize: "A4", pageOrientation: "portrait", width: 595.28 },
  { pageSize: "A4", pageOrientation: "landscape", width: 841.89 },
  { pageSize: "A3", pageOrientation: "landscape", width: 1190.55 },
];

type Band = { columnIndexes: number[]; widths: number[]; showRowNumber: boolean; rowNumberWidth: number };
type LayoutPlan = { page: PageChoice; bands: Band[] };

function planLayout(
  columns: string[],
  rowGroups: Record<string, unknown>[][],
  headerFontSize: number,
  bodyFontSize: number
): LayoutPlan {
  // 1. Target width per column: wide enough for its widest value (header included), up to the cap.
  const targets = columns.map((c) => {
    let natural = textWidth(c, headerFontSize, true);
    for (const rows of rowGroups) {
      for (const row of rows) natural = Math.max(natural, textWidth(cellText(row[c]), bodyFontSize));
    }
    return Math.min(natural, MAX_COLUMN_WIDTH) + CELL_H_OVERHEAD;
  });
  const totalTarget = targets.reduce((a, b) => a + b, 0);

  // Scale a set of targets up to fill `usable` (never shrinks, and never stretches past 2x so a
  // table of a few narrow columns doesn't spread out absurdly).
  const fill = (ws: number[], usable: number) => {
    const sum = ws.reduce((a, b) => a + b, 0);
    const scale = Math.min(Math.max(usable / sum, 1), 2);
    return ws.map((w) => w * scale);
  };

  // 2. Smallest page where everything fits on one row of columns.
  for (const page of PAGE_CHOICES) {
    const usable = page.width - PAGE_MARGIN_X * 2;
    if (totalTarget <= usable) {
      return {
        page,
        bands: [
          {
            columnIndexes: columns.map((_, i) => i),
            widths: fill(targets, usable),
            showRowNumber: false,
            rowNumberWidth: 0,
          },
        ],
      };
    }
  }

  // 3. Too wide even for A3: A4 landscape, columns split into bands with a repeated "#" column.
  const page = PAGE_CHOICES[1];
  const usable = page.width - PAGE_MARGIN_X * 2;
  const maxRows = Math.max(1, ...rowGroups.map((r) => r.length));
  const rowNumberWidth = Math.max(textWidth("#", headerFontSize, true), textWidth(String(maxRows), bodyFontSize)) + CELL_H_OVERHEAD;
  const available = usable - rowNumberWidth;

  const bands: Band[] = [];
  let current: number[] = [];
  let currentWidth = 0;
  const flush = () => {
    if (current.length === 0) return;
    const widths = fill([rowNumberWidth, ...current.map((i) => targets[i])], usable);
    bands.push({ columnIndexes: current, widths: widths.slice(1), showRowNumber: true, rowNumberWidth: widths[0] });
    current = [];
    currentWidth = 0;
  };
  targets.forEach((w, i) => {
    if (current.length > 0 && currentWidth + w > available) flush();
    current.push(i);
    currentWidth += w;
  });
  flush();

  return { page, bands };
}

// Breaks any unbroken run of characters wider than `maxWidth` (a long URL, say) with line breaks so
// it wraps inside its cell instead of spilling into the next column. Ordinary text is untouched —
// pdfmake already wraps that at spaces.
function wrapLongTokens(text: string, maxWidth: number, fontSize: number, bold = false): string {
  if (text.length === 0) return text;
  const factor = bold ? BOLD_FACTOR : 1;
  return text.replace(/\S+/g, (token) => {
    if (textWidth(token, fontSize, bold) <= maxWidth) return token;
    let out = "";
    let lineWidth = 0;
    for (const ch of token) {
      const w = (charWidth(ch.charCodeAt(0)) * fontSize * factor) / 1000;
      if (lineWidth + w > maxWidth && lineWidth > 0) {
        out += "\n";
        lineWidth = 0;
      }
      out += ch;
      lineWidth += w;
    }
    return out;
  });
}

// Horizontal cell padding is already handled by each cell's own margin, so the table layout adds
// none of its own (pdfmake's default of 4pt each side would eat into every column).
const TABLE_LAYOUT = {
  hLineColor: () => COLOR_RULE,
  vLineColor: () => COLOR_RULE,
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 0,
  paddingRight: () => 0,
};

// One data table per column band (usually just one). Every band repeats the header row on each
// page it spans, and bands after the first start on a new page.
function buildDataTables(opts: {
  columns: string[];
  rows: Record<string, unknown>[];
  plan: LayoutPlan;
  headerFontSize: number;
  bodyFontSize: number;
  headerFill: string;
  bodyColor: string;
  pageBreakBeforeFirst: boolean;
}) {
  const { columns, rows, plan, headerFontSize, bodyFontSize, headerFill, bodyColor } = opts;

  return plan.bands.map((band, bandIndex) => {
    const bandColumns = band.columnIndexes.map((i) => columns[i]);
    const textWidths = band.widths.map((w) => Math.max(w - CELL_H_OVERHEAD, 1));

    const headerRow: Record<string, unknown>[] = [];
    if (band.showRowNumber) {
      headerRow.push({ text: "#", fontSize: headerFontSize, bold: true, color: COLOR_INK, fillColor: headerFill, margin: [3, 3, 3, 3] });
    }
    bandColumns.forEach((c, k) => {
      headerRow.push({
        text: wrapLongTokens(c, textWidths[k], headerFontSize, true),
        fontSize: headerFontSize,
        bold: true,
        color: COLOR_INK,
        fillColor: headerFill,
        margin: [3, 3, 3, 3],
      });
    });

    const body = rows.map((row, r) => {
      const cells: Record<string, unknown>[] = [];
      const fillColor = r % 2 === 1 ? COLOR_STRIPE : undefined;
      if (band.showRowNumber) {
        cells.push({ text: String(r + 1), fontSize: bodyFontSize, color: COLOR_INK_SOFT, fillColor, margin: [3, 2, 3, 2] });
      }
      bandColumns.forEach((c, k) => {
        cells.push({
          text: wrapLongTokens(cellText(row[c]), textWidths[k], bodyFontSize),
          fontSize: bodyFontSize,
          color: bodyColor,
          fillColor,
          margin: [3, 2, 3, 2],
        });
      });
      return cells;
    });

    const widths = band.showRowNumber ? [band.rowNumberWidth, ...band.widths] : band.widths;
    const pageBreak = bandIndex > 0 || opts.pageBreakBeforeFirst;

    return {
      ...(pageBreak ? { pageBreak: "before" as const } : {}),
      stack: [
        ...(plan.bands.length > 1
          ? [
              {
                text: `Columns ${band.columnIndexes[0] + 1}–${band.columnIndexes[band.columnIndexes.length - 1] + 1} of ${columns.length}  ·  group ${bandIndex + 1} of ${plan.bands.length}`,
                fontSize: 8.5,
                color: COLOR_INK_SOFT,
                margin: [0, 0, 0, 4] as [number, number, number, number],
              },
            ]
          : []),
        { table: { headerRows: 1, dontBreakRows: true, widths, body: [headerRow, ...body] }, layout: TABLE_LAYOUT },
      ],
    };
  });
}

// One appendix block for a single "why was this removed" group (e.g. duplicates, or rows a filter
// excluded): a title and description, then the same column layout as the main table so it reads as
// "the same shape of data, just excluded." `pageBreakBefore` only applies to the FIRST section in
// the appendix (see buildRemovedRowsAppendix) — subsequent sections just stack underneath it.
const COLOR_REMOVED_HEADER = "#F1E4DE";
function buildRemovedRowsTable(
  columns: string[],
  section: RemovedRowSection,
  pageBreakBefore: boolean,
  plan: LayoutPlan,
  bodyFontSize: number
) {
  const removedBodySize = Math.min(bodyFontSize, 7);
  const tables = buildDataTables({
    columns,
    rows: section.rows,
    plan,
    headerFontSize: removedBodySize + 0.5,
    bodyFontSize: removedBodySize,
    headerFill: COLOR_REMOVED_HEADER,
    bodyColor: COLOR_BAR_REDUCED,
    pageBreakBeforeFirst: false,
  });

  return {
    ...(pageBreakBefore ? { pageBreak: "before" as const } : {}),
    margin: [0, 0, 0, 18] as [number, number, number, number],
    stack: [
      {
        text: `${section.label} (${section.rows.length})`,
        fontSize: 12,
        bold: true,
        color: COLOR_INK,
        margin: [0, 0, 0, 2] as [number, number, number, number],
      },
      {
        text: section.description,
        fontSize: 8.5,
        color: COLOR_INK_SOFT,
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },
      ...tables,
    ],
  };
}

// Builds every non-empty removed-row section as one appendix block: a single page break before
// the FIRST section (so the appendix as a whole starts on its own page), then each section
// stacked in order after that.
function buildRemovedRowsAppendix(columns: string[], sections: RemovedRowSection[], plan: LayoutPlan, bodyFontSize: number) {
  const nonEmpty = sections.filter((s) => s.rows.length > 0);
  return nonEmpty.map((section, i) => buildRemovedRowsTable(columns, section, i === 0, plan, bodyFontSize));
}

export function generatePdf(
  columns: string[],
  rows: Record<string, unknown>[],
  meta: PdfExportMeta
): Promise<Buffer> {
  const printer = new PdfPrinter(fonts);

  // Wide tables get cramped fast — scale font size down a little as column count grows (but never
  // below 7.5pt: past that, extra columns go onto more page space instead, see planLayout).
  const bodyFontSize = columns.length > 20 ? 7.5 : columns.length > 10 ? 8 : 8.5;
  const headerFontSize = bodyFontSize + 0.5;

  // Plan the page size and column widths from ALL the rows that will be printed (main table plus
  // any removed-rows appendix) so every table in the document fits the same page.
  const removedSizeForPlan = Math.min(bodyFontSize, 7);
  const plan = planLayout(
    columns,
    [rows, ...(meta.removedRowSections ?? []).map((section) => section.rows)],
    Math.max(headerFontSize, removedSizeForPlan + 0.5),
    Math.max(bodyFontSize, removedSizeForPlan)
  );

  const subtitleParts: string[] = [];
  if (meta.filterDescription) subtitleParts.push(`Filter: ${meta.filterDescription}`);
  if (meta.sortDescription) subtitleParts.push(`Sort: ${meta.sortDescription}`);
  subtitleParts.push(`${meta.rowCount} row${meta.rowCount === 1 ? "" : "s"}`);

  const docDefinition: TDocumentDefinitions = {
    pageSize: plan.page.pageSize,
    pageOrientation: plan.page.pageOrientation,
    pageMargins: [PAGE_MARGIN_X, 50, PAGE_MARGIN_X, 36],
    defaultStyle: { font: "Helvetica", fontSize: bodyFontSize, color: COLOR_INK },
    header: {
      margin: [PAGE_MARGIN_X, 16, PAGE_MARGIN_X, 0],
      columns: [
        { text: "Dimension Reduction", fontSize: 9, bold: true, color: COLOR_INK },
        { text: new Date().toLocaleString(), fontSize: 8, color: COLOR_INK_SOFT, alignment: "right" },
      ],
    },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [PAGE_MARGIN_X, 0, PAGE_MARGIN_X, 16],
      text: `Page ${currentPage} of ${pageCount}`,
      alignment: "center",
      fontSize: 8,
      color: COLOR_INK_SOFT,
    }),
    content: [
      { text: meta.fileName, fontSize: 14, bold: true, color: COLOR_INK, margin: [0, 0, 0, 2] },
      { text: subtitleParts.join("  ·  "), fontSize: 9, color: COLOR_INK_SOFT, margin: [0, 0, 0, 12] },
      ...(meta.rowsBeforeProcessing !== undefined && meta.rowsAfterProcessing !== undefined
        ? [buildRowsReducedChart(meta.rowsBeforeProcessing, meta.rowsAfterProcessing)]
        : []),
      ...(meta.filteringSummary
        ? [buildFilteringSummary(meta.filteringSummary.totalUploaded, meta.filteringSummary.remainingAfterFiltering)]
        : []),
      ...buildDataTables({
        columns,
        rows,
        plan,
        headerFontSize,
        bodyFontSize,
        headerFill: COLOR_PAPER,
        bodyColor: COLOR_INK,
        pageBreakBeforeFirst: false,
      }),
      ...(meta.removedRowSections ? buildRemovedRowsAppendix(columns, meta.removedRowSections, plan, bodyFontSize) : []),
    ],
  };

  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];
      pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
}