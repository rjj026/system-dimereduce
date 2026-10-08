import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// MemoryUsageBadge
//
// Small, self-contained sidebar widget that polls the backend's
// GET /api/system/memory endpoint and shows a live memory footprint while
// the app is processing data — handy for watching large-dataset uploads or
// PCA/LDA runs without needing devtools/Task Manager open.
//
// It fails silently (renders nothing) if the backend can't be reached at
// all, rather than showing an alarming error badge for something that isn't
// the user's fault.
// ---------------------------------------------------------------------------

type MemoryStats = {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  systemFreeMb: number;
  systemTotalMb: number;
  timestamp: number;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : "/api";

const POLL_MS = 4000;

function IconMemoryChip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}

export default function MemoryUsageBadge() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/system/memory`);
        if (!res.ok) throw new Error("bad status");
        const data: MemoryStats = await res.json();
        if (!cancelled) {
          setStats(data);
          setUnreachable(false);
        }
      } catch {
        if (!cancelled) setUnreachable(true);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (unreachable && !stats) return null;

  const usedPct = stats ? Math.min(100, Math.round((stats.heapUsedMb / Math.max(stats.heapTotalMb, 1)) * 100)) : 0;
  const level = usedPct > 85 ? "critical" : usedPct > 60 ? "warn" : "ok";

  return (
    <div className="memory-badge" title="Backend process memory usage, refreshed every few seconds">
      <div className="memory-badge-row">
        <span className="memory-badge-label">
          <IconMemoryChip /> Memory
        </span>
        <span className="memory-badge-value">{stats ? `${stats.heapUsedMb.toFixed(0)} MB` : "…"}</span>
      </div>
      <div className="memory-badge-track">
        <div className={`memory-badge-fill ${level}`} style={{ width: `${stats ? usedPct : 0}%` }} />
      </div>
      <div className="memory-badge-sub">
        {stats
          ? `RSS ${stats.rssMb.toFixed(0)} MB · Heap cap ${stats.heapTotalMb.toFixed(0)} MB`
          : "Waiting for backend…"}
      </div>
    </div>
  );
}
