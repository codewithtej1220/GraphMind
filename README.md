# GraphMind

GraphMind is a browser-based code inspector for structural code graphs,
step-by-step execution tracing, and empirical complexity estimates in eight
languages. It combines a Monaco editor, a React Flow canvas, a variable and
call-stack inspector, and a Chart.js benchmark view.

## What it supports

- **Editor and structural graph:** Python, JavaScript, TypeScript, C, C++, Java,
  Go, and R, parsed with Tree-sitter.
- **Step-by-step tracing:** Python, JavaScript, TypeScript, C, C++, Java, Go, and R.
  Every step records the active line, call stack, variables, and all arrays in
  scope (including 2-D tables), plus which cells the line compares or writes.
  Python runs under `sys.settrace`; the other languages are instrumented with
  Tree-sitter (a trace hook is inserted before each statement, on the same line,
  so compiler messages keep their line numbers) and run with a small per-language
  runtime in `backend/tracer/runtime/`.
- **Big-O benchmark (all languages):** GraphMind grows the program's largest
  numeric array literal (or a size variable named `n`, or a small numeric
  argument such as `fib(10)`), counts executed statements at each size, and fits
  O(1) through O(N³) and O(2ᴺ).
- **Repository import:** Browse supported source files in public GitHub
  repositories and load a selected file into the editor.
- **Saved sessions:** Store and reopen code and language selections in SQLite.
- **Graph navigation:** Select a function or call to highlight its resolved
  callers and dependencies where the source contains resolvable function calls.

The first parse for a language may download its Tree-sitter grammar. The backend
therefore needs outbound access to the grammar package's release host on first
use of each language.

## Run locally

Requirements for the full language set: Docker Desktop with Docker Compose.
The container installs the runtimes and compilers. For running the backend
directly, Python 3.10+, Node.js, TypeScript (`tsc`), a JDK, GCC/G++, Go, and R
must be installed separately; languages without a local runtime will show a
message naming the missing tool. Node.js and JavaScript/TypeScript, JDK/Java,
and npm are also needed for the frontend.

To run the backend and its language runtimes in Docker, from the repository
root run:

```powershell
docker compose up --build
```

Then start the frontend in another terminal:

```powershell
cd frontend
npm ci
"NEXT_PUBLIC_API_BASE=http://localhost:8000" | Set-Content .env.local
npm run dev
```

Open <http://localhost:3000>. Stop the services with `Ctrl+C` and
`docker compose down`.

To run the backend directly (languages whose compiler or runtime is missing
show a message naming it), start it in one terminal:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:FRONTEND_ORIGIN = "http://localhost:3000"
uvicorn main:app --reload --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm ci
"NEXT_PUBLIC_API_BASE=http://localhost:8000" | Set-Content .env.local
npm run dev
```

Open <http://localhost:3000>. The backend API is available at
<http://localhost:8000/docs>.

## Main API endpoints

- `GET /api/health` - backend health check.
- `POST /api/parse` - Tree-sitter structure nodes and relationships.
- `POST /api/trace` - execution output and captured errors; Python also returns
  detailed step frames.
- `POST /api/complexity` - Python step counts for N = 10, 50, 100, 500, and
  1,000 with a best-fit Big-O estimate.
- `POST /api/github/import` and `/api/github/file` - public repository listing
  and source-file import.
- `/api/sessions` - SQLite session create, list, load, and delete operations.

Complexity results are empirical estimates based on the selected sample sizes;
they are useful for comparison and may be inconclusive for small or
input-dependent programs.

## Deployment

The repository includes `vercel.json` for the Next.js frontend and `render.yaml`
for the FastAPI backend. Configure `NEXT_PUBLIC_API_BASE` in Vercel with the
backend URL and `FRONTEND_ORIGIN` in Render with the frontend origin. The Render
manifest mounts a persistent disk at `/var/data` and stores SQLite at
`/var/data/graphmind.db`. Set `GITHUB_TOKEN` on Render if you need higher GitHub
API rate limits. Render persistent disks require a paid compute plan; the
manifest selects Render's smallest paid plan so the SQLite volume is available.

The local Docker Compose setup uses a named volume for SQLite and applies
container resource limits. Programs run with a timeout in temporary folders;
Python tracing also has bounded output and step counts. This is defense in
depth, not a complete security boundary for running arbitrary hostile code;
keep the API private or add a stronger operating-system sandbox before
exposing it publicly.

## Project layout

```text
backend/
  main.py                 FastAPI routes and request models
  parsers/ast_parser.py   Tree-sitter graph generation
  tracer/                 Isolated Python tracing and benchmarking
  storage.py              SQLite sessions
  github_import.py        GitHub repository browsing
frontend/src/
  app/                    Next.js application shell
  components/             Editor, graph, trace, and complexity views
  lib/types.ts            API and UI types
```
