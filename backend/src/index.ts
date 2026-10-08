import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import * as XLSX from "xlsx";
import crypto from "crypto";
import os from "os";
import { runAlgorithms, AlgorithmError, looksLikeIdColumn } from "./algorithms";
import { smartImport } from "./smart-import";
import { generatePdf, RemovedRowSection } from "./pdf-export";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const ALLOWED_EXTENSIONS = /\.(xlsx|xls|csv)$/i;

// Raised well past the original 25MB so hundreds-of-thousands-of-rows workbooks (the kind
// used for local large-dataset testing / a live defense) don't get rejected outright.
// Override with MAX_UPLOAD_MB if an even larger ceiling is needed.
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 200;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_EXTENSIONS.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx, .xls, and .csv files are supported."));
    }
  },
});

// Wraps multer's single-file upload so rejected files (wrong type, too large, etc.) return a
// clean JSON error instead of falling through to Express's default HTML error page.
function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Could not upload the file.";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

// In-memory store: fileId -> { buffer, sheetName, uploadedAt }
type StoredFile = {
  workbook: XLSX.WorkBook;
  sheetName: string;
  originalName: string;
  uploadedAt: number;
  // Row count immediately after smart-import cleanup but before duplicate removal — i.e. the
  // "before processing" figure for the Rows Reduced chart in the PDF export. Fixed at upload
  // time; doesn't change even if duplicates are later restored/re-removed via the history panel.
  rowsBeforeDedup: number;
};
const fileStore = new Map<string, StoredFile>();

function getStoredRows(stored: StoredFile): Record<string, unknown>[] {
  const sheet = stored.workbook.Sheets[stored.sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function setStoredRows(stored: StoredFile, rows: Record<string, unknown>[], columns: string[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, stored.sheetName);
  stored.workbook = workbook;
}

// Clean up files older than 30 minutes
const FILE_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of fileStore.entries()) {
    if (now - entry.uploadedAt > FILE_TTL_MS) {
      fileStore.delete(id);
    }
  }
}, 5 * 60 * 1000);

// --- Duplicate Records History -------------------------------------------------------------
// Whenever /api/upload strips exact-duplicate rows out of a sheet, each one is kept here so the
// user can look back at what was removed and decide, per record, whether to permanently discard
// it or restore it into the active dataset. Entries persist for as long as the underlying file
// does (same TTL/cleanup as fileStore, keyed by the same fileId).
type DuplicateStatus = "removed" | "kept";

type DuplicateEntry = {
  id: string;
  row: Record<string, unknown>;
  detectedAt: number;
  status: DuplicateStatus;
  resolvedAt: number | null;
};

const duplicateHistoryStore = new Map<string, DuplicateEntry[]>();

// --- Filter-Exclusion History ---------------------------------------------------------------
// Same idea as duplicate history above, but for rows an export-time FILTER excludes rather than
// dedup. Recomputed (not appended-to) every time filters are checked/applied for a file — see
// applyFiltersWithHistory() — so it always reflects the most recently applied filter's
// exclusions. A row's "kept" status (restored despite not matching the filter) survives being
// recomputed, matched up by content via rowKey(), so re-checking the same filter after a restore
// doesn't lose the decision.
type FilterHistoryEntry = {
  id: string;
  row: Record<string, unknown>;
  detectedAt: number;
  status: DuplicateStatus; // "removed" = still excluded, "kept" = restored despite the filter
  resolvedAt: number | null;
};

const filterHistoryStore = new Map<string, FilterHistoryEntry[]>();

function rowKey(row: Record<string, unknown>): string {
  return JSON.stringify(row);
}

setInterval(() => {
  for (const id of duplicateHistoryStore.keys()) {
    if (!fileStore.has(id)) duplicateHistoryStore.delete(id);
  }
}, 5 * 60 * 1000);

// POST /api/upload - accepts an Excel file, returns fileId + columns + preview rows
app.post("/api/upload", handleUpload, (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const startedAt = Date.now();

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const imported = smartImport(sheet);
    const rawRows = imported.rows;

    if (rawRows.length === 0) {
      return res.status(400).json({ error: "The uploaded sheet has no data rows." });
    }

    const rowsBefore = rawRows.length;
    const columns = imported.columns;

    // Compare rows on everything except columns that look like row identifiers (ID, StudentID,
    // student_id, a timestamp-ish "detectedAt", etc). Those are near-guaranteed to differ between
    // otherwise-identical rows (an auto-incremented ID, a per-row timestamp), so keying the
    // dedup check on the full row would basically never find a duplicate. Falls back to every
    // column if the whole sheet looks like it's made of ID-like columns, so we never treat every
    // row as unique just because we couldn't find a "real" column to compare on.
    const nonIdColumns = columns.filter((c) => !looksLikeIdColumn(c));
    const dedupColumns = nonIdColumns.length > 0 ? nonIdColumns : columns;

    // Drop exact duplicate rows (every non-ID column value matches another row), and keep a record of
    // each one removed so it can be reviewed later via the Duplicate Records History panel.
    const seenRowKeys = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    const duplicateEntries: DuplicateEntry[] = [];
    const detectedAt = Date.now();
    for (const row of rawRows) {
      const key = JSON.stringify(dedupColumns.map((c) => row[c]));
      if (seenRowKeys.has(key)) {
        duplicateEntries.push({
          id: crypto.randomUUID(),
          row,
          detectedAt,
          status: "removed",
          resolvedAt: null,
        });
        continue;
      }
      seenRowKeys.add(key);
      rows.push(row);
    }
    const duplicatesRemoved = rowsBefore - rows.length;

    // Count blank/null cells across the cleaned data.
    let nullCells = 0;
    for (const row of rows) {
      for (const col of columns) {
        const val = row[col];
        if (val === "" || val === null || val === undefined) nullCells++;
      }
    }

    const fileId = crypto.randomUUID();

    // Store the deduplicated data so export/sort operate on the cleaned set.
    const cleanedSheet = XLSX.utils.json_to_sheet(rows, { header: columns });
    const cleanedWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(cleanedWorkbook, cleanedSheet, sheetName);

    fileStore.set(fileId, {
      workbook: cleanedWorkbook,
      sheetName,
      originalName: req.file.originalname,
      uploadedAt: Date.now(),
      rowsBeforeDedup: rowsBefore,
    });
    duplicateHistoryStore.set(fileId, duplicateEntries);

    // For each column, collect its distinct values (capped) so the frontend
    // can offer a "filter by value" dropdown, e.g. Gender -> ["Male", "Female"].
    const MAX_UNIQUE_VALUES = 50;
    const uniqueValues: Record<string, string[]> = {};
    for (const col of columns) {
      const seen = new Set<string>();
      for (const row of rows) {
        const val = String(row[col]).trim();
        if (val !== "") seen.add(val);
        if (seen.size > MAX_UNIQUE_VALUES) break;
      }
      // Only expose as a filter dropdown if it's a reasonably small set of
      // repeated values (categorical), not something like a unique ID/name column.
      if (seen.size > 0 && seen.size <= MAX_UNIQUE_VALUES) {
        uniqueValues[col] = Array.from(seen).sort();
      }
    }

    const importNotes = {
      headerRowsSkipped: imported.headerRowsSkipped,
      columnsRealigned: imported.columnsRealigned,
      groupsDetected: imported.groupsDetected,
      dividerRowsRemoved: imported.dividerRowsRemoved,
      subtotalRowsRemoved: imported.subtotalRowsRemoved,
    };

    res.json({
      fileId,
      fileName: req.file.originalname,
      columns,
      preview: rows.slice(0, 5),
      rowsBefore,
      rowsAfter: rows.length,
      duplicatesRemoved,
      nullCells,
      runtimeMs: Date.now() - startedAt,
      uniqueValues,
      importNotes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not parse the uploaded file. Make sure it's a valid .xlsx or .xls file." });
  }
});

// --- Multi-condition (AND) filtering -------------------------------------------------------
// The frontend's filter panel supports one or more column = value conditions, combined with
// AND (e.g. Gender = Male AND Location = Laguna), sent as `filters: [{ column, value }, ...]`.
type FilterCondition = { column: string; value: string };

class FilterValidationError extends Error {}

function validateFilters(rows: Record<string, unknown>[], filters: FilterCondition[]) {
  for (const f of filters) {
    if (!f || !f.column) {
      throw new FilterValidationError("Each filter condition needs a column.");
    }
    if (!(f.column in rows[0])) {
      throw new FilterValidationError(`Column "${f.column}" does not exist in the sheet.`);
    }
    if (f.value === undefined || f.value === "") {
      throw new FilterValidationError(`A filter value is required for column "${f.column}".`);
    }
  }
}

function makeFilterPredicate(filters: FilterCondition[]): (row: Record<string, unknown>) => boolean {
  return (row) => filters.every((f) => String(row[f.column]).trim().toLowerCase() === f.value.trim().toLowerCase());
}

function applyFilters(
  rows: Record<string, unknown>[],
  filters: FilterCondition[] | undefined
): Record<string, unknown>[] {
  if (!filters || filters.length === 0) return rows;
  if (rows.length === 0) return rows;
  validateFilters(rows, filters);
  return rows.filter(makeFilterPredicate(filters));
}

// Merges a fresh set of filter-excluded rows into filterHistoryStore for this file, carrying
// forward any prior "kept" (restored) decision for a row that's excluded again, matched by
// content rather than object identity (each request re-parses the sheet into new row objects).
function updateFilterHistory(fileId: string, excludedRows: Record<string, unknown>[]): FilterHistoryEntry[] {
  const prevByKey = new Map((filterHistoryStore.get(fileId) ?? []).map((e) => [rowKey(e.row), e]));
  const detectedAt = Date.now();
  const entries: FilterHistoryEntry[] = excludedRows.map((row) => {
    const existing = prevByKey.get(rowKey(row));
    return {
      id: existing?.id ?? crypto.randomUUID(),
      row,
      detectedAt: existing?.detectedAt ?? detectedAt,
      status: existing?.status ?? "removed",
      resolvedAt: existing?.resolvedAt ?? null,
    };
  });
  filterHistoryStore.set(fileId, entries);
  return entries;
}

// The filter-aware counterpart to applyFilters(): validates + filters exactly the same way, but
// also (a) records every excluded row in filterHistoryStore so it can be reviewed/restored later,
// and (b) folds any already-"kept" (restored) rows back into the result even though they don't
// match the filter. Used everywhere a filter actually determines what the user sees/exports
// (filter-count, full-data preview, export) so "restore" behaves consistently across all three.
function applyFiltersWithHistory(
  fileId: string,
  rows: Record<string, unknown>[],
  filters: FilterCondition[] | undefined
): { rows: Record<string, unknown>[]; excludedCount: number } {
  if (!filters || filters.length === 0 || rows.length === 0) {
    return { rows, excludedCount: 0 };
  }
  validateFilters(rows, filters);
  const predicate = makeFilterPredicate(filters);
  const excludedRows = rows.filter((r) => !predicate(r));
  const entries = updateFilterHistory(fileId, excludedRows);
  const keptKeys = new Set(entries.filter((e) => e.status === "kept").map((e) => rowKey(e.row)));
  const finalRows = rows.filter((r) => predicate(r) || keptKeys.has(rowKey(r)));
  return { rows: finalRows, excludedCount: excludedRows.length - keptKeys.size };
}

// Human-readable "Gender = Male AND Location = Laguna" summary, used in PDF subtitles and
// error messages.
function describeFilters(filters: FilterCondition[] | undefined): string | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((f) => `${f.column} = ${f.value}`).join(" AND ");
}

// POST /api/filter-count - body: { fileId, filters: { column, value }[] }
// Returns how many rows would remain after applying one or more AND-combined column=value
// filters, without exporting a file. Used right after upload to show "rows after" live.
app.post("/api/filter-count", (req: Request, res: Response) => {
  const { fileId, filters } = req.body as {
    fileId?: string;
    filters?: FilterCondition[];
  };

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required." });
  }

  const stored = fileStore.get(fileId);
  if (!stored) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }

  try {
    const sheet = stored.workbook.Sheets[stored.sheetName];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    });

    if (rows.length === 0) {
      return res.status(400).json({ error: "The sheet has no data rows." });
    }

    if (!filters || filters.length === 0) {
      return res.status(400).json({ error: "At least one filter condition is required." });
    }

    const result = applyFiltersWithHistory(fileId, rows, filters);
    res.json({ rowCount: result.rows.length, excludedCount: result.excludedCount });
  } catch (err) {
    if (err instanceof FilterValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong while applying the filter." });
  }
});

// Summary of the sorted column over ALL (filtered) rows — not just the 300 sampled graph points —
// so the interpretation and pie chart in the UI reflect the real data, not a downsample.
type SortSummary = {
  totalRows: number;
  blankCount: number;
  distinctCount: number;
  // The pie slices, always at most PIE_MAX_SLICES of them (blank cells excluded):
  //   "values" — 8 or fewer distinct values: one slice per value, in sorted order
  //   "ranges" — a numeric column with more distinct values: 6 equal-width value ranges
  //   "top"    — a text column with more distinct values: the 7 most common plus an "Other" slice
  categories: { label: string; count: number }[];
  categoryMode: "values" | "ranges" | "top";
  // The three most common values, always provided, for the written interpretation.
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

const PIE_MAX_SLICES = 8;
const PIE_RANGE_BINS = 6;

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function buildSortSummary(sortedRows: Record<string, unknown>[], column: string, isNumeric: boolean): SortSummary {
  const counts = new Map<string, number>(); // Map keeps first-seen order == sorted order
  let blankCount = 0;
  const nums: number[] = [];

  for (const row of sortedRows) {
    const v = row[column];
    if (v === "" || v === null || v === undefined) {
      blankCount++;
      continue;
    }
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (isNumeric) nums.push(Number(v));
  }

  const entries = [...counts.entries()].map(([label, count]) => ({ label, count }));
  const topValues = [...entries].sort((a, b) => b.count - a.count).slice(0, 3);

  const summary: SortSummary = {
    totalRows: sortedRows.length,
    blankCount,
    distinctCount: entries.length,
    categories: entries,
    categoryMode: "values",
    topValues,
  };

  if (entries.length > PIE_MAX_SLICES) {
    if (isNumeric && nums.length > 0) {
      // Too many distinct numbers for one slice each: bucket into equal-width ranges.
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      const width = (hi - lo) / PIE_RANGE_BINS;
      const edge = (x: number) => Number(x.toPrecision(4)).toLocaleString("en-US");
      const bins = Array.from({ length: PIE_RANGE_BINS }, (_, i) => ({
        label: `${edge(lo + i * width)} – ${edge(i === PIE_RANGE_BINS - 1 ? hi : lo + (i + 1) * width)}`,
        count: 0,
      }));
      for (const n of nums) {
        bins[Math.min(PIE_RANGE_BINS - 1, Math.floor((n - lo) / width))].count++;
      }
      summary.categories = bins.filter((b) => b.count > 0);
      summary.categoryMode = "ranges";
    } else {
      // Too many distinct labels: most common ones plus a single "Other" slice.
      const byCount = [...entries].sort((a, b) => b.count - a.count);
      const top = byCount.slice(0, PIE_MAX_SLICES - 1);
      const rest = byCount.slice(PIE_MAX_SLICES - 1);
      summary.categories = [
        ...top,
        { label: `Other (${rest.length.toLocaleString()} values)`, count: rest.reduce((acc, e) => acc + e.count, 0) },
      ];
      summary.categoryMode = "top";
    }
  }

  if (isNumeric && nums.length > 0) {
    const asc = [...nums].sort((a, b) => a - b);
    const mean = nums.reduce((acc, n) => acc + n, 0) / nums.length;
    const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
    const q1 = quantile(asc, 0.25);
    const q3 = quantile(asc, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    summary.numeric = {
      min: asc[0],
      max: asc[asc.length - 1],
      mean,
      median: quantile(asc, 0.5),
      q1,
      q3,
      stdDev: Math.sqrt(variance),
      outlierLow: asc.filter((n) => n < lowFence).length,
      outlierHigh: asc.filter((n) => n > highFence).length,
      lowFence,
      highFence,
    };
  }

  return summary;
}

// POST /api/sort-preview - body: { fileId, sortColumn, sortOrder, filters?: { column, value }[] }
// Returns the (optionally filtered) data sorted by sortColumn, as a compact array of
// { label, value } points for graphing — value is sortColumn's own value if numeric, otherwise
// just its row position. Used to show a graph of "what did the sort actually produce" right
// after picking a sort column, without downloading anything.
app.post("/api/sort-preview", (req: Request, res: Response) => {
  const { fileId, sortColumn, sortOrder, filters } = req.body as {
    fileId?: string;
    sortColumn?: string;
    sortOrder?: "asc" | "desc";
    filters?: FilterCondition[];
  };

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required." });
  }
  if (!sortColumn) {
    return res.status(400).json({ error: "sortColumn is required." });
  }

  const stored = fileStore.get(fileId);
  if (!stored) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }

  try {
    const sheet = stored.workbook.Sheets[stored.sheetName];
    let rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rows.length === 0) {
      return res.status(400).json({ error: "The sheet has no data rows." });
    }
    if (!(sortColumn in rows[0])) {
      return res.status(400).json({ error: `Column "${sortColumn}" does not exist in the sheet.` });
    }

    rows = applyFilters(rows, filters);

    const order = sortOrder === "desc" ? "desc" : "asc";
    rows = [...rows].sort((a, b) => {
      const valA = a[sortColumn];
      const valB = b[sortColumn];
      const numA = Number(valA);
      const numB = Number(valB);
      const bothNumeric = valA !== "" && valB !== "" && !Number.isNaN(numA) && !Number.isNaN(numB);

      let comparison: number;
      if (bothNumeric) {
        comparison = numA - numB;
      } else {
        comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: "base" });
      }
      return order === "asc" ? comparison : -comparison;
    });

    const isNumeric = rows.every((row) => {
      const v = row[sortColumn];
      return v === "" || Number.isFinite(Number(v));
    });

    // Cap how many points we send — thousands of rows would make a noisy, slow chart.
    // Downsample evenly across the sorted sequence rather than just truncating, so the shape
    // of the whole sort is still represented even for very large files.
    const MAX_POINTS = 300;
    let sampledRows = rows;
    if (rows.length > MAX_POINTS) {
      const step = rows.length / MAX_POINTS;
      sampledRows = Array.from({ length: MAX_POINTS }, (_, i) => rows[Math.floor(i * step)]);
    }

    const points = sampledRows.map((row, i) => ({
      label: String(row[sortColumn]),
      value: isNumeric ? Number(row[sortColumn]) || 0 : i,
    }));

    res.json({
      points,
      isNumeric,
      rowCount: rows.length,
      sampled: rows.length > MAX_POINTS,
      summary: buildSortSummary(rows, sortColumn, isNumeric),
    });
  } catch (err) {
    if (err instanceof FilterValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong while building the sort preview." });
  }
});

// POST /api/export - body: { fileId, filters?: { column, value }[], sortColumn?, sortOrder?, format?, includeRemovedRows? }
// Filters rows (optional, one or more AND-combined conditions), sorts them (optional), and
// returns the result as a downloadable file — .xlsx by default, or .pdf if format === "pdf".
// Note: this does NOT include PCA/LDA output columns — Apply Algorithms is a separate analysis
// step (see /api/apply-algorithms) and does not modify the exported file's contents.
app.post("/api/export", async (req: Request, res: Response) => {
  const { fileId, filters, sortColumn, sortOrder, format, includeRemovedRows, algoRowsUsed } = req.body as {
    fileId?: string;
    filters?: FilterCondition[];
    sortColumn?: string;
    sortOrder?: "asc" | "desc";
    format?: "xlsx" | "pdf";
    // PDF-only: when true, appends removed-row appendix tables — one for rows dedup removed at
    // upload, one for rows THIS export's filter excluded — for whichever of those still have
    // entries with status "removed" (i.e. not since restored).
    includeRemovedRows?: boolean;
    // PDF-only: rowsUsed from the applied algorithm's result (/api/apply-algorithms). When
    // present, the "Row Reduction Summary" chart compares the ORIGINALLY UPLOADED row count
    // (stored.rowsBeforeDedup) against this figure — "what came in" vs. "what the algorithm
    // used" — instead of this export's own filter before/after.
    algoRowsUsed?: number;
  };

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required." });
  }

  const stored = fileStore.get(fileId);
  if (!stored) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }

  try {
    const sheet = stored.workbook.Sheets[stored.sheetName];
    let rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    });

    if (rows.length === 0) {
      return res.status(400).json({ error: "The sheet has no data rows." });
    }

    const columns = Object.keys(rows[0]);

    // Row count for this export's own dataset before its filter step runs — this becomes the
    // "before" figure for the Rows Reduced chart, so the chart reflects what THIS export's
    // filter actually did (rather than the separate, earlier dedup step from upload).
    const rowsBeforeFilter = rows.length;

    // --- Filter step (optional, one or more AND-combined conditions) ---
    const hasFilters = !!filters && filters.length > 0;
    if (hasFilters) {
      rows = applyFiltersWithHistory(fileId, rows, filters).rows;
      if (rows.length === 0) {
        return res.status(400).json({
          error: `No rows match "${describeFilters(filters)}".`,
        });
      }
    }

    // --- Sort step (optional) ---
    if (sortColumn) {
      if (!(sortColumn in rows[0])) {
        return res.status(400).json({ error: `Column "${sortColumn}" does not exist in the sheet.` });
      }
      const order = sortOrder === "desc" ? "desc" : "asc";
      rows = [...rows].sort((a, b) => {
        const valA = a[sortColumn];
        const valB = b[sortColumn];

        const numA = Number(valA);
        const numB = Number(valB);
        const bothNumeric =
          valA !== "" && valB !== "" && !Number.isNaN(numA) && !Number.isNaN(numB);

        let comparison: number;
        if (bothNumeric) {
          comparison = numA - numB;
        } else {
          comparison = String(valA).localeCompare(String(valB), undefined, {
            numeric: true,
            sensitivity: "base",
          });
        }

        return order === "asc" ? comparison : -comparison;
      });
    }

    const suffixParts = [];
    if (hasFilters) suffixParts.push("filtered");
    if (sortColumn) suffixParts.push("sorted");
    const suffix = suffixParts.length ? suffixParts.join("-") : "export";
    const baseName = stored.originalName.replace(/\.(xlsx|xls|csv)$/i, "");

    if (format === "pdf") {
      const removedRowSections: RemovedRowSection[] = [];
      if (includeRemovedRows) {
        const dedupRemoved = (duplicateHistoryStore.get(fileId) ?? [])
          .filter((e) => e.status === "removed")
          .map((e) => e.row);
        if (dedupRemoved.length > 0) {
          removedRowSections.push({
            label: "Removed / Duplicate Rows",
            description: "Rows detected as exact duplicates during import and excluded from the dataset above.",
            rows: dedupRemoved,
          });
        }
        // Only relevant when THIS export actually applied a filter — filterHistoryStore was
        // just refreshed above (via applyFiltersWithHistory) if hasFilters, so it reflects the
        // current filter's exclusions rather than a stale one from an earlier export.
        if (hasFilters) {
          const filterRemoved = (filterHistoryStore.get(fileId) ?? [])
            .filter((e) => e.status === "removed")
            .map((e) => e.row);
          if (filterRemoved.length > 0) {
            removedRowSections.push({
              label: "Removed / Filtered-Out Rows",
              description: `Rows excluded by this export's filter (${describeFilters(filters)}).`,
              rows: filterRemoved,
            });
          }
        }
      }

      const pdfBuffer = await generatePdf(columns, rows, {
        fileName: baseName,
        rowCount: rows.length,
        filterDescription: describeFilters(filters),
        sortDescription: sortColumn ? `${sortColumn}, ${sortOrder === "desc" ? "descending" : "ascending"}` : undefined,
        // Preferred: "what was originally uploaded" vs. "what the algorithm actually used".
        // Falls back to this export's own filter before/after if the frontend didn't send
        // algoRowsUsed (e.g. an older client), and omits the chart entirely if neither applies.
        ...(typeof algoRowsUsed === "number"
          ? { rowsBeforeProcessing: stored.rowsBeforeDedup, rowsAfterProcessing: algoRowsUsed }
          : hasFilters
          ? { rowsBeforeProcessing: rowsBeforeFilter, rowsAfterProcessing: rows.length }
          : {}),
        // "Before and After Filtering" text summary — always the total uploaded count vs. rows
        // remaining after THIS export's filter, independent of the algorithm-usage chart above.
        ...(hasFilters
          ? { filteringSummary: { totalUploaded: stored.rowsBeforeDedup, remainingAfterFiltering: rows.length } }
          : {}),
        ...(removedRowSections.length > 0 ? { removedRowSections } : {}),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}-${suffix}.pdf"`);
      return res.send(pdfBuffer);
    }

    const newSheet = XLSX.utils.json_to_sheet(rows);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newSheet, stored.sheetName);

    const outBuffer = XLSX.write(newWorkbook, { type: "buffer", bookType: "xlsx" });
    const downloadName = `${baseName}-${suffix}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.send(outBuffer);
  } catch (err) {
    if (err instanceof FilterValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong while processing the file." });
  }
});

// POST /api/apply-algorithms - body: { fileId, labelColumn, filters?: { column, value }[] }
// Runs PCA (unsupervised) and LDA (supervised, needs labelColumn) on the numeric columns.
// If filters are provided, algorithms run on that filtered subset — matching whatever
// filter was applied earlier in the pipeline.
app.post("/api/apply-algorithms", (req: Request, res: Response) => {
  const { fileId, labelColumn, filters } = req.body as {
    fileId?: string;
    labelColumn?: string;
    filters?: FilterCondition[];
  };

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required." });
  }
  if (!labelColumn) {
    return res.status(400).json({ error: "labelColumn is required for LDA." });
  }

  const stored = fileStore.get(fileId);
  if (!stored) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }

  try {
    const sheet = stored.workbook.Sheets[stored.sheetName];
    let rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    });

    if (rows.length === 0) {
      return res.status(400).json({ error: "The sheet has no data rows." });
    }

    if (filters && filters.length > 0) {
      rows = applyFiltersWithHistory(fileId, rows, filters).rows;
      if (rows.length === 0) {
        return res.status(400).json({ error: `No rows match "${describeFilters(filters)}".` });
      }
    }

    const columns = Object.keys(rows[0]);
    const result = runAlgorithms(rows, columns, labelColumn);
    // `rows` is returned in the exact same order used to build pca.scores/lda.scatter, so the
    // frontend can zip row i with scores[i]/scatter[i] to build a "before" (original columns)
    // and "after" (original columns + PC1/PC2/LD1/LD2) comparison table without a second request.
    res.json({ ...result, rows });
  } catch (err) {
    if (err instanceof FilterValidationError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof AlgorithmError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong while running the algorithms." });
  }
});

// POST /api/full-data - body: { fileId, limit?, offset?, filters? }
// Returns the cleaned dataset (or, if `filters` is provided, only the rows matching every
// AND-combined column=value condition) along with missing-value detection: which fields are
// blank on each row, and a per-column tally. Used both by the "Preview Dataset" panel (no
// filters — everything uploaded) and by the "Review filtered rows" panel (filters passed
// through from the Filter step, so the user can see the actual rows a filter kept, not just
// the count from /api/filter-count).
//
// `limit`/`offset` page through the row list — this matters for local testing with very large
// (hundreds-of-thousands-of-rows) datasets, where returning every row in one response would be
// slow to serialize and would freeze the browser trying to render it. missingByColumn,
// totalMissingCells, and incompleteRowCount are always computed over the FULL (filtered, if
// applicable) dataset regardless of the requested page, so those summary numbers stay accurate
// as the user pages through.
const FULL_DATA_DEFAULT_LIMIT = 2000;
const FULL_DATA_MAX_LIMIT = 20000;

app.post("/api/full-data", (req: Request, res: Response) => {
  const { fileId, limit, offset, filters } = req.body as {
    fileId?: string;
    limit?: number;
    offset?: number;
    filters?: FilterCondition[];
  };

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required." });
  }

  const stored = fileStore.get(fileId);
  if (!stored) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }

  try {
    let rows = getStoredRows(stored);

    if (rows.length === 0) {
      return res.status(400).json({ error: "The sheet has no data rows." });
    }

    if (filters && filters.length > 0) {
      rows = applyFiltersWithHistory(fileId, rows, filters).rows;
      if (rows.length === 0) {
        return res.status(400).json({ error: `No rows match "${describeFilters(filters)}".` });
      }
    }

    const columns = Object.keys(rows[0]);
    const missingByColumn: Record<string, number> = {};
    for (const col of columns) missingByColumn[col] = 0;

    let totalMissingCells = 0;
    let incompleteRowCount = 0;

    const safeOffset = Math.max(0, Number.isFinite(offset) ? Number(offset) : 0);
    const safeLimit = Math.min(
      FULL_DATA_MAX_LIMIT,
      Math.max(1, Number.isFinite(limit) ? Number(limit) : FULL_DATA_DEFAULT_LIMIT)
    );

    const dataRows: { index: number; data: Record<string, unknown>; missingFields: string[]; isIncomplete: boolean }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const missingFields: string[] = [];
      for (const col of columns) {
        const val = row[col];
        if (val === "" || val === null || val === undefined) {
          missingFields.push(col);
          missingByColumn[col]++;
          totalMissingCells++;
        }
      }
      const isIncomplete = missingFields.length > 0;
      if (isIncomplete) incompleteRowCount++;

      if (i >= safeOffset && i < safeOffset + safeLimit) {
        dataRows.push({ index: i, data: row, missingFields, isIncomplete });
      }
    }

    res.json({
      columns,
      rows: dataRows,
      rowCount: rows.length,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + safeLimit < rows.length,
      missingByColumn,
      totalMissingCells,
      incompleteRowCount,
    });
  } catch (err) {
    if (err instanceof FilterValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong while loading the dataset preview." });
  }
});

// GET /api/duplicates/:fileId
// Returns every duplicate row detected (and auto-removed) during upload for this file, along
// with whatever decision has since been made about each one ("removed" = confirmed gone,
// "kept" = restored into the active dataset).
app.get("/api/duplicates/:fileId", (req: Request, res: Response) => {
  const { fileId } = req.params;
  if (!fileStore.has(fileId)) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }
  const entries = duplicateHistoryStore.get(fileId) ?? [];
  res.json({
    entries,
    totalDetected: entries.length,
    keptCount: entries.filter((e) => e.status === "kept").length,
    removedCount: entries.filter((e) => e.status === "removed").length,
  });
});

// POST /api/duplicates/:fileId/resolve - body: { entryId, action: "keep" | "delete" }
// Lets the user act on a single detected duplicate: "keep" restores that exact row back into
// the active dataset (so it will appear in exports, sorting, and PCA/LDA again); "delete"
// confirms it should stay excluded. Either way the decision is recorded on the history entry.
app.post("/api/duplicates/:fileId/resolve", (req: Request, res: Response) => {
  const { fileId } = req.params;
  const { entryId, action } = req.body as { entryId?: string; action?: "keep" | "delete" };

  const stored = fileStore.get(fileId);
  if (!stored) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }
  if (!entryId) {
    return res.status(400).json({ error: "entryId is required." });
  }
  if (action !== "keep" && action !== "delete") {
    return res.status(400).json({ error: 'action must be "keep" or "delete".' });
  }

  const entries = duplicateHistoryStore.get(fileId) ?? [];
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return res.status(404).json({ error: "Duplicate entry not found." });
  }

  try {
    if (action === "keep" && entry.status !== "kept") {
      const rows = getStoredRows(stored);
      rows.push(entry.row);
      setStoredRows(stored, rows, Object.keys(rows[0] ?? entry.row));
      entry.status = "kept";
    } else if (action === "delete" && entry.status !== "removed") {
      // Remove exactly one row matching this duplicate's content — not every row with that
      // content, since the legitimate original row (identical by definition) must stay.
      const rows = getStoredRows(stored);
      const targetKey = JSON.stringify(entry.row);
      let removedOne = false;
      const filtered = rows.filter((row) => {
        if (!removedOne && JSON.stringify(row) === targetKey) {
          removedOne = true;
          return false;
        }
        return true;
      });
      setStoredRows(stored, filtered, Object.keys(filtered[0] ?? entry.row));
      entry.status = "removed";
    }
    entry.resolvedAt = Date.now();

    res.json({ entry, rowsAfter: getStoredRows(stored).length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong while updating the duplicate record." });
  }
});

// GET /api/filter-history/:fileId
// Returns every row excluded by the most recently applied/exported filter for this file, along
// with whatever decision has since been made about each one ("removed" = confirmed excluded,
// "kept" = restored despite not matching the filter). Populated by filter-count, the "Review
// filtered rows" panel, and export — whichever last actually ran a filter for this file.
app.get("/api/filter-history/:fileId", (req: Request, res: Response) => {
  const { fileId } = req.params;
  if (!fileStore.has(fileId)) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }
  const entries = filterHistoryStore.get(fileId) ?? [];
  res.json({
    entries,
    totalDetected: entries.length,
    keptCount: entries.filter((e) => e.status === "kept").length,
    removedCount: entries.filter((e) => e.status === "removed").length,
  });
});

// POST /api/filter-history/:fileId/resolve - body: { entryId, action: "keep" | "delete" }
// Unlike duplicate resolve, this never mutates the stored dataset directly — filter exclusion is
// recomputed fresh every time a filter runs (see applyFiltersWithHistory). "keep" just flips the
// entry's status to "kept", so the next filter-count/full-data/export call for this file folds
// that row back in even though it doesn't match the filter; "delete" flips it back to "removed".
app.post("/api/filter-history/:fileId/resolve", (req: Request, res: Response) => {
  const { fileId } = req.params;
  const { entryId, action } = req.body as { entryId?: string; action?: "keep" | "delete" };

  if (!fileStore.has(fileId)) {
    return res.status(404).json({ error: "File not found or has expired. Please re-upload." });
  }
  if (!entryId) {
    return res.status(400).json({ error: "entryId is required." });
  }
  if (action !== "keep" && action !== "delete") {
    return res.status(400).json({ error: 'action must be "keep" or "delete".' });
  }

  const entries = filterHistoryStore.get(fileId) ?? [];
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return res.status(404).json({ error: "Filtered-out row entry not found." });
  }

  entry.status = action === "keep" ? "kept" : "removed";
  entry.resolvedAt = Date.now();

  res.json({ entry });
});

// GET /api/system/memory
// Reports the backend process's current memory footprint so it can be shown live in the UI
// while a large dataset is being processed. Polled from the frontend every few seconds.
app.get("/api/system/memory", (_req: Request, res: Response) => {
  const mem = process.memoryUsage();
  const toMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
  res.json({
    rssMb: toMb(mem.rss),
    heapUsedMb: toMb(mem.heapUsed),
    heapTotalMb: toMb(mem.heapTotal),
    externalMb: toMb(mem.external),
    systemFreeMb: toMb(os.freemem()),
    systemTotalMb: toMb(os.totalmem()),
    timestamp: Date.now(),
  });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Excel sorter backend running on http://localhost:${PORT}`);
  console.log(`Max upload size: ${MAX_UPLOAD_MB}MB`);
});