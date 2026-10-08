import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// DuplicateHistoryPanel
//
// Shows every exact-duplicate row that /api/upload found and stripped out,
// and lets the user decide, per record, whether it should stay excluded
// ("Delete") or be restored into the active dataset ("Keep"). Every decision
// is recorded on the backend (GET/POST /api/duplicates/:fileId...), so this
// panel is always showing a durable history rather than a one-time prompt.
// ---------------------------------------------------------------------------

type DuplicateEntry = {
  id: string;
  row: Record<string, unknown>;
  detectedAt: number;
  status: "removed" | "kept";
  resolvedAt: number | null;
};

type DuplicatesResponse = {
  entries: DuplicateEntry[];
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

export default function DuplicateHistoryPanel({
  fileId,
  columns,
  onClose,
  onRowsChanged,
}: {
  fileId: string;
  columns: string[];
  onClose: () => void;
  onRowsChanged?: (rowsAfter: number) => void;
}) {
  const [data, setData] = useState<DuplicatesResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`${API_BASE}/duplicates/${fileId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load duplicate history.");
      setData(json);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not load duplicate history.");
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
      const res = await fetch(`${API_BASE}/duplicates/${fileId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update this record.");

      setData((prev) => {
        if (!prev) return prev;
        const nextEntries = prev.entries.map((e) => (e.id === entryId ? (json.entry as DuplicateEntry) : e));
        return {
          entries: nextEntries,
          totalDetected: prev.totalDetected,
          keptCount: nextEntries.filter((e) => e.status === "kept").length,
          removedCount: nextEntries.filter((e) => e.status === "removed").length,
        };
      });
      onRowsChanged?.(json.rowsAfter);
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
      aria-label="Duplicate records history"
      onClick={onClose}
    >
      <div className="sim-module-card dup-history-card" onClick={(e) => e.stopPropagation()}>
        <div className="sim-module-header">
          <div>
            <h2 className="sim-module-title">Duplicate Records History</h2>
            <p className="meta">
              Rows that exactly matched another row were removed automatically on upload. Review
              each one below and choose whether it should stay excluded or be restored.
            </p>
          </div>
          <button type="button" className="sim-module-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        {status === "loading" && <p className="status">Loading duplicate history…</p>}
        {status === "error" && <p className="status error">{error}</p>}

        {data && status === "idle" && (
          <>
            <div className="dup-history-summary">
              <span>
                <strong>{data.totalDetected}</strong> detected
              </span>
              <span className="ok">
                <strong>{data.keptCount}</strong> restored
              </span>
              <span className="warn">
                <strong>{data.removedCount}</strong> excluded
              </span>
            </div>

            {data.entries.length === 0 ? (
              <p className="status">No duplicate rows were found in this upload.</p>
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
