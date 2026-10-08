import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// FilterHistoryPanel
//
// Shows every row the most recently applied/exported filter excluded, and lets
// the user decide, per record, whether it should stay excluded ("Delete") or
// be restored despite not matching the filter ("Keep"). Mirrors
// DuplicateHistoryPanel's UI/flow, but points at /api/filter-history instead
// of /api/duplicates — and unlike duplicates, "Keep" here doesn't mutate the
// stored dataset directly; it just flips the entry's status, and the backend
// folds "kept" rows back in the next time this file's filter is applied
// (filter-count, the filtered-rows review panel, or export).
// ---------------------------------------------------------------------------

type FilterHistoryEntry = {
  id: string;
  row: Record<string, unknown>;
  detectedAt: number;
  status: "removed" | "kept";
  resolvedAt: number | null;
};

type FilterHistoryResponse = {
  entries: FilterHistoryEntry[];
  totalDetected: number;
  keptCount: number;
  removedCount: number;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : "/api";

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export default function FilterHistoryPanel({
  fileId,
  columns,
  onClose,
  onResolved,
}: {
  fileId: string;
  columns: string[];
  onClose: () => void;
  // Called after any Keep/Delete decision — the caller should re-check the filter (e.g.
  // /api/filter-count) since the resulting "rows after" count may have changed.
  onResolved?: () => void;
}) {
  const [data, setData] = useState<FilterHistoryResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`${API_BASE}/filter-history/${fileId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load the filtered-out rows.");
      setData(json);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not load the filtered-out rows.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function resolve(entryId: string, action: "keep" | "delete") {
    setPendingId(entryId);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/filter-history/${fileId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update this record.");

      setData((prev) => {
        if (!prev) return prev;
        const nextEntries = prev.entries.map((e) => (e.id === entryId ? (json.entry as FilterHistoryEntry) : e));
        return {
          entries: nextEntries,
          totalDetected: prev.totalDetected,
          keptCount: nextEntries.filter((e) => e.status === "kept").length,
          removedCount: nextEntries.filter((e) => e.status === "removed").length,
        };
      });
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this record.");
    } finally {
      setPendingId(null);
    }
  }

  const cols = columns.length > 0 ? columns : data?.entries[0] ? Object.keys(data.entries[0].row) : [];

  return (
    <div
      className="sim-module-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Filtered-out rows history"
      onClick={onClose}
    >
      <div className="sim-module-card dup-history-card" onClick={(e) => e.stopPropagation()}>
        <div className="sim-module-header">
          <div>
            <h2 className="sim-module-title">Filtered-Out Rows</h2>
            <p className="meta">
              Rows that don't match the current filter are excluded automatically. Review each one
              below and choose whether it should stay excluded or be restored anyway.
            </p>
          </div>
          <button type="button" className="sim-module-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {status === "loading" && <p className="status">Loading filtered-out rows…</p>}
        {status === "error" && <p className="status error">{error}</p>}

        {data && status === "idle" && (
          <>
            <div className="dup-history-summary">
              <span>
                <strong>{data.totalDetected}</strong> excluded by the filter
              </span>
              <span className="ok">
                <strong>{data.keptCount}</strong> restored
              </span>
              <span className="warn">
                <strong>{data.removedCount}</strong> still excluded
              </span>
            </div>

            {data.entries.length === 0 ? (
              <p className="status">No rows have been excluded by a filter yet.</p>
            ) : (
              <div className="dup-history-table-wrap">
                <table className="dup-history-table">
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => (
                      <tr key={entry.id} className={entry.status === "kept" ? "kept" : ""}>
                        {cols.map((c) => (
                          <td key={c}>{String(entry.row[c] ?? "")}</td>
                        ))}
                        <td>
                          <span className={`dup-status-pill ${entry.status}`}>
                            {entry.status === "kept" ? "Restored" : "Excluded"}
                          </span>
                        </td>
                        <td className="dup-history-actions">
                          <button
                            type="button"
                            className="secondary small"
                            disabled={pendingId === entry.id || entry.status === "kept"}
                            onClick={() => resolve(entry.id, "keep")}
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            className="secondary small ghost"
                            disabled={pendingId === entry.id || entry.status === "removed"}
                            onClick={() => resolve(entry.id, "delete")}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {error && <p className="status error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
