# Excel Sorter

Upload an Excel file, pick a column and sort order, and download a new sorted `.xlsx` file.
Also runs PCA/LDA on the numeric columns, cleans up messy report-style exports on import, and
includes a few quality-of-life features for testing with large datasets locally:

- **Live memory usage** — a sidebar badge shows the backend's current memory footprint.
- **Duplicate Records History** — every exact-duplicate row removed on upload is reviewable, with a per-record Keep/Delete decision.
- **Flexible dataset uploads** — accepts both ordinary wide tables and "Column/Value" long-format sheets (see below).
- **Large-dataset friendly** — a higher upload size ceiling and a paginated dataset preview.

## Structure
- `backend/` — Express + TypeScript API. Parses uploads with `xlsx`, sorts rows, and streams back a sorted file.
- `frontend/` — React + Vite + TypeScript UI. Upload widget, column/order pickers, preview table, download button.
- `package.json` (repo root) — optional convenience script to run both together with one command (see below).

## Running locally

### Option A — one command for both (recommended for testing / offline demos)
From the repo root:
```bash
npm run install:all   # installs backend/ and frontend/ dependencies
npm run dev            # starts both servers together, with labeled/colored logs
```
This uses `concurrently` (declared in the root `package.json`) to run the backend on
`http://localhost:4000` and the frontend on `http://localhost:5173` in one terminal. Once both
are up, everything runs entirely on your machine — no internet connection is required to upload,
sort, filter, run PCA/LDA, or export, which matters if you're testing with very large files or
demoing somewhere without reliable Wi-Fi. (The one exception: the page's display fonts are loaded
from Google Fonts and will silently fall back to your system's default sans-serif/monospace fonts
if there's no connection — the app still works identically either way.)

### Option B — run each side separately
### 1. Backend
```bash
cd backend
npm install
npm run dev
```
Runs on `http://localhost:4000`.

Uploads are accepted up to 200MB by default (raised from the original 25MB specifically so
hundreds-of-thousands-of-row workbooks can be used for local testing). Override with an
environment variable if you need an even higher ceiling:
```bash
MAX_UPLOAD_MB=500 npm run dev
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173` and proxies `/api` requests to the backend (see `vite.config.ts`).

Open `http://localhost:5173`, upload a `.xlsx`/`.xls` file, choose a column + order, then click **Sort & Download**.

## How it works
1. `POST /api/upload` — accepts the file (multipart, field name `file`), parses it in memory with the `xlsx` library, and returns the column names, a 5-row preview, and a `fileId` that references the parsed workbook (kept in an in-memory store for 30 minutes). Exact-duplicate rows are removed automatically; each one removed is kept in a per-file **Duplicate Records History** so it can be reviewed afterward (see below).
2. `POST /api/sort` — takes `{ fileId, column, order }`, re-sorts the rows (numeric-aware, falls back to locale string compare), rebuilds a workbook, and streams it back as an `.xlsx` attachment.
3. `POST /api/full-data` — takes `{ fileId, offset?, limit? }` and returns a *page* of the cleaned dataset (2,000 rows by default, 20,000 max per request) along with missing-value stats computed over the full dataset. The "Preview Dataset" panel calls this with a "Load more" button so opening a huge file doesn't try to render every row in the browser at once.
4. `GET /api/duplicates/:fileId` / `POST /api/duplicates/:fileId/resolve` — list the duplicate rows detected on upload, and act on one (`{ entryId, action: "keep" | "delete" }`). "Keep" restores that exact row back into the active dataset (it will reappear in exports, sorting, and PCA/LDA); "delete" confirms it should stay excluded. The frontend's "Review" button (next to the "Duplicates removed" stat) opens this as a modal.
5. `GET /api/system/memory` — reports the backend process's current memory footprint (RSS, heap used/total, system free/total, all in MB). Polled every few seconds by the sidebar's live Memory badge so you can watch memory usage while processing large files.

### Flexible dataset upload format
In addition to ordinary "one row per record" spreadsheets, uploads may also use a **long/key-value
layout**: two columns headed something like `Column`/`Field`/`Attribute` and `Value`/`Data`, where
each record is a *stack* of rows rather than a single row — e.g.:

| Column | Value  |
|--------|--------|
| Name   | Ana    |
| Age    | 24     |
| Name   | Ben    |
| Age    | 31     |

A new record starts whenever a field name repeats (or a blank row is hit), so this example is
automatically pivoted into two normal wide records (`Name, Age`) before anything else in the
pipeline (deduplication, filtering, sorting, PCA/LDA) runs. This lets the same upload flow accept
datasets whose fields vary from file to file without needing to already be laid out as a table.

## Deploying it live (GitHub + hosting)

This is one repo with two apps in it (`backend/` and `frontend/`), so you deploy them as **two separate services** that point at each other.

### 1. Push to GitHub
```bash
cd excel-sorter
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

### 2. Deploy the backend (Render — free tier works)
1. Go to [render.com](https://render.com) → **New +** → **Web Service** → connect your GitHub repo.
2. Set **Root Directory** to `backend`.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Environment: Node. No env vars are required (defaults to port 4000, Render overrides `PORT` automatically — the code already reads `process.env.PORT`).
6. Deploy, then copy the live URL Render gives you, e.g. `https://excel-sorter-backend.onrender.com`.

(Railway works the same way if you prefer it — same root directory / build / start commands.)

> Free-tier Render services spin down when idle and take ~30–60s to wake up on the first request. This is the same cold-start behavior you likely ran into with other Render-hosted backends — the first upload after idle time will feel slow, that's expected.

### 3. Deploy the frontend (Vercel — free tier works)
1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project** → import the same GitHub repo.
2. Set **Root Directory** to `frontend`.
3. Framework preset: Vite (auto-detected).
4. Add an environment variable:
   - `VITE_API_BASE_URL` = your Render backend URL from step 2 (no trailing slash), e.g. `https://excel-sorter-backend.onrender.com`
5. Deploy.

(Netlify works too — same root directory and env var, build command `npm run build`, publish directory `dist`.)

### 4. Test it
Open your Vercel URL, upload a file, sort it, download it. If the download fails, check the browser console — it's almost always either a wrong `VITE_API_BASE_URL` or the backend still cold-starting.

## Notes / things to adjust for production
- The file store, duplicate history, and memory stats are all in-memory and single-process — fine for a demo/capstone/local testing, but won't survive a server restart or scale across multiple instances. Swap in Redis or a temp-file-on-disk approach if you need persistence.
- No auth/rate limiting — add if this will be exposed publicly.
- Only the first sheet in the workbook is read/returned. Extend `sheetName` handling if you need multi-sheet support.
- Sorting only supports a single column. Multi-column sort would need a small extension to the `/api/sort` payload (e.g. an array of `{ column, order }`).
- The "Column/Value" long-format detector triggers on specific header-name aliases (Column/Field/Attribute/Key/Name/Label/Property + Value/Data/Amount/Val/Entry) and requires at least two stacked records; a two-column sheet using different header names, or with only one record, will be treated as an ordinary wide table instead.
- `/api/full-data` pagination defaults to 2,000 rows per page (20,000 max per request) — large enough for spot-checking a big file without shipping the whole thing in one response, but the frontend still keeps every page it's loaded in memory once you click "Load more" repeatedly, so extremely large files (500k+ rows) are best spot-checked rather than paged through in full.
