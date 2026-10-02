"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useMonaco } from "@monaco-editor/react";
import { AlertTriangle, Terminal, Code2, Activity, LineChart, GitBranch, FolderGit2, Save, X, History } from "lucide-react";
import Logo from "@/components/Logo";
import AlgorithmBar from "@/components/AlgorithmBar";
import { ALGORITHMS } from "@/lib/algorithms";
import Mascot, { type StudioView } from "@/components/Mascot";
import {
  API_BASE,
  BOILERPLATE,
  ComplexityResult,
  Diagnosis,
  LanguageId,
  TraceResult,
  GraphEdge,
  GraphNode,
} from "@/lib/types";

// Monaco and Chart.js touch `window` at module init time, so they must be
// loaded client-side only.
const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });
const EnhancedVisualizer = dynamic(() => import("@/components/EnhancedVisualizer"), { ssr: false });
const ComplexityChart = dynamic(() => import("@/components/ComplexityChart"), { ssr: false });
const FlowCanvas = dynamic(() => import("@/components/FlowCanvas"), { ssr: false });

type ViewId = StudioView;

const VIEWS: { id: ViewId; label: string; icon: typeof Code2 }[] = [
  { id: "code", label: "Code", icon: Code2 },
  { id: "visualizer", label: "Step Inspector", icon: Activity },
  { id: "graph", label: "Structure Graph", icon: GitBranch },
  { id: "complexity", label: "Big-O Benchmark", icon: LineChart },
];

export default function Studio() {
  const [view, setView] = useState<ViewId>("code");
  const [language, setLanguage] = useState<LanguageId>("python");
  const [code, setCode] = useState(BOILERPLATE.python);
  const [userInput, setUserInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [complexityResult, setComplexityResult] = useState<ComplexityResult | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubFiles, setGithubFiles] = useState<{ path: string; size: number }[]>([]);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; name: string; language: LanguageId; code: string }[]>([]);
  const [showInputPrompt, setShowInputPrompt] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  // The latest run's error diagnosis, and the code it was computed for (a fix only applies to that code).
  const [diagnosis, setDiagnosis] = useState<{ result: Diagnosis; code: string } | null>(null);
  const monaco = useMonaco();
  const diagnosisIsCurrent = diagnosis !== null && diagnosis.code === code;

  // Underline the faulty line in the editor (a Monaco marker; the editor itself is unchanged).
  useEffect(() => {
    if (!monaco) return;
    const apply = () => {
      for (const model of monaco.editor.getModels()) {
        const d = diagnosisIsCurrent ? diagnosis.result : null;
        const line = d ? Math.min(Math.max(d.line, 1), model.getLineCount()) : 0;
        monaco.editor.setModelMarkers(model, "graphmind", d ? [{
          severity: monaco.MarkerSeverity.Error,
          message: `${d.title}${d.suggestion ? `\nGraphy suggests: ${d.suggestion.trim()}` : `\n${d.explanation}`}`,
          startLineNumber: line,
          startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        }] : []);
      }
    };
    apply();
    const created = monaco.editor.onDidCreateModel(() => setTimeout(apply, 0));
    return () => created.dispose();
  }, [monaco, diagnosis, diagnosisIsCurrent, view]);

  function languageForPath(path: string): LanguageId {
    const extension = path.split(".").pop()?.toLowerCase();
    return ({ py: "python", js: "javascript", ts: "typescript", tsx: "typescript", cpp: "cpp", h: "cpp", c: "c", java: "java", go: "go", r: "r" }[extension ?? ""] ?? "python") as LanguageId;
  }

  async function browseRepository() {
    setIsImporting(true); setPanelError(null);
    try {
      const response = await fetch(`${API_BASE}/api/github/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: githubUrl }) });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Could not browse repository");
      setGithubFiles((await response.json()).files);
    } catch (error) { setPanelError(error instanceof Error ? error.message : "Could not browse repository."); }
    finally { setIsImporting(false); }
  }

  async function importFile(path: string) {
    setIsImporting(true); setPanelError(null);
    try {
      const response = await fetch(`${API_BASE}/api/github/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: githubUrl, path }) });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Could not import file");
      const result = await response.json(); setCode(result.content); setLanguage(languageForPath(path)); setShowImport(false); setView("code");
    } catch (error) { setPanelError(error instanceof Error ? error.message : "Could not import file."); }
    finally { setIsImporting(false); }
  }

  async function saveSession() {
    setPanelError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled analysis", language, code }) });
      if (!response.ok) throw new Error("Could not save session");
      await loadSessions();
    } catch (error) { setPanelError(error instanceof Error ? error.message : "Could not save session."); }
  }
  async function loadSessions() {
    const response = await fetch(`${API_BASE}/api/sessions`);
    if (!response.ok) throw new Error("Could not load sessions");
    setSessions(await response.json());
  }
  async function openSessions() { setShowSessions(true); try { await loadSessions(); } catch (error) { setPanelError(error instanceof Error ? error.message : "Could not load sessions."); } }

  function loadReference(reference: string) {
    const isUntouched = Object.values(BOILERPLATE).includes(code) || ALGORITHMS.some((algo) => algo.code === code) || code.trim() === "";
    if (!isUntouched && !window.confirm("Replace the code in the editor with this reference example?")) return;
    setLanguage("python");
    setCode(reference);
  }

  function handleLanguageChange(next: LanguageId) {
    const isUntouched = Object.values(BOILERPLATE).includes(code);
    setLanguage(next);
    if (isUntouched) {
      setCode(BOILERPLATE[next]);
    }
  }

  function applyFix(runAfter: boolean) {
    if (!diagnosis?.result.fixedCode) return;
    const fixed = diagnosis.result.fixedCode;
    setCode(fixed);
    setDiagnosis(null);
    setView("code");
    if (runAfter) handleRun(false, fixed);
  }

  async function handleRun(confirmInput = false, codeOverride?: string) {
    const source = codeOverride ?? code;
    const mayReadInput = /\b(input\s*\(|readLine\s*\(|Scanner\s*\(|BufferedReader|fmt\.Scan|scanf\s*\(|cin\s*>>|getline\s*\(|getchar\s*\(|readline\s*\(|read\.table\s*\(|readLines\s*\()/i.test(source);
    if (!confirmInput && mayReadInput && !userInput.trim()) {
      setShowInputPrompt(true);
      return;
    }
    setShowInputPrompt(false);
    setIsRunning(true);
    setConnectionError(null);
    try {
      const post = (path: string, body: object) =>
        fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const tracePromise = post("/api/trace", { code: source, language, input: userInput });
      const complexityPromise = post("/api/complexity", { code: source, language, input: userInput });
      const parsePromise = post("/api/parse", { code: source, language });

      // The trace (and any error diagnosis) is shown as soon as it arrives; the benchmark can take longer.
      const traceRes = await tracePromise;
      if (!traceRes.ok) throw new Error(`Trace request failed (${traceRes.status})`);
      const trace: TraceResult = await traceRes.json();
      setTraceResult(trace);
      if (trace.diagnosis) {
        // Stay on the editor so the faulty line and Graphy's fix are visible right away.
        setDiagnosis({ result: trace.diagnosis, code: source });
        setView("code");
      } else {
        setDiagnosis(null);
        setView("visualizer");
      }

      const [complexityRes, parseRes] = await Promise.all([complexityPromise, parsePromise]);
      if (!complexityRes.ok) throw new Error(`Complexity request failed (${complexityRes.status})`);
      setComplexityResult(await complexityRes.json());
      if (parseRes.ok) {
        const parsed = await parseRes.json();
        setGraph({ nodes: parsed.nodes, edges: parsed.edges });
        setParseError(parsed.hasError ? "The parser found a syntax error; the graph may be partial." : null);
      } else {
        setGraph(null);
        setParseError(`Structure analysis failed (${parseRes.status}).`);
      }
    } catch (err) {
      setConnectionError(
        err instanceof Error
          ? `${err.message}. Is the backend running on ${API_BASE}?`
          : "Unknown error contacting backend."
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-paper">
      <header className="relative z-10 flex items-center justify-between gap-4 border-b border-ink-700 bg-ink-950/90 px-5 py-2.5 backdrop-blur">
        <div className="flex items-center gap-4">
          <Logo size={32} />
          <span className="hidden rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper/45 sm:inline">Studio</span>
        </div>

        {/* View tabs */}
        <nav className="flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-900/80 p-1" aria-label="Studio views">
          {VIEWS.map(({ id, label, icon: Icon }, i) => {
            const isActive = view === id;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? "-translate-y-px bg-ink-700 text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_3px_0_rgba(0,0,0,0.45),0_8px_18px_-8px_rgba(232,163,61,0.55)]"
                    : "text-paper/45 hover:bg-ink-800/70 hover:text-paper/80"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${isActive ? "bg-signal text-ink-950" : "bg-ink-800 text-paper/50"}`}>{i + 1}</span>
                <Icon className="hidden h-4 w-4 lg:block" />
                <span className="hidden md:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="btn-ghost-3d flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-paper/80"><FolderGit2 className="h-3.5 w-3.5" /> <span className="hidden xl:inline">Import GitHub</span></button>
          <button onClick={saveSession} className="btn-ghost-3d flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-paper/80"><Save className="h-3.5 w-3.5" /> <span className="hidden xl:inline">Save</span></button>
          <button onClick={openSessions} className="btn-ghost-3d flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-paper/80"><History className="h-3.5 w-3.5" /> <span className="hidden xl:inline">History</span></button>
          {/* Parking spot for Graphy when it docks into the header. */}
          <div className="w-11 shrink-0" aria-hidden />
        </div>
      </header>
      {connectionError && (
        <div className="flex items-center gap-1.5 border-b border-node-condition/30 bg-node-condition/10 px-5 py-1.5 text-xs text-node-condition">
          <AlertTriangle className="h-3.5 w-3.5" />
          {connectionError}
        </div>
      )}

      {/* Views — only the active view is mounted, avoiding Monaco/Chart.js
          layout issues that display:none toggling can cause. */}
      <main className="min-h-0 flex-1">
        {view === "code" && (
          <div className="flex h-full flex-col">
            <AlgorithmBar onUse={loadReference} onOpenChange={setReferenceOpen} />
            <div className="min-h-0 flex-1">
            <CodeEditor
              code={code}
              language={language}
              isRunning={isRunning}
              onCodeChange={setCode}
              onLanguageChange={handleLanguageChange}
              onRun={handleRun}
              userInput={userInput}
              onInputChange={setUserInput}
            />
            </div>
          </div>
        )}

        {view === "visualizer" && (
          <div className="h-full">
            <EnhancedVisualizer
              frames={traceResult?.frames ?? []}
              supported={traceResult?.supported ?? true}
              message={traceResult?.message ?? null}
              code={code}
            />
          </div>
        )}

        {view === "complexity" && (
          <div className="h-full">
            <ComplexityChart result={complexityResult} />
          </div>
        )}

        {view === "graph" && (
          <div className="relative h-full">
            {parseError && <div className="absolute left-4 top-4 z-10 rounded border border-node-condition bg-ink-900 px-3 py-2 text-xs text-node-condition">{parseError}</div>}
            <FlowCanvas nodes={graph?.nodes ?? []} edges={graph?.edges ?? []} activeLine={traceResult?.frames.at(-1)?.activeLine ?? null} />
          </div>
        )}
      </main>

      {traceResult && (
        <footer data-mascot-avoid className="grid max-h-36 grid-cols-2 gap-3 overflow-auto border-t border-ink-700 bg-ink-950 py-2 pl-5 pr-32 text-xs">
          <section aria-label="Program output" className="min-w-0">
            <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-paper/50"><Terminal className="h-3.5 w-3.5" /> Output</div>
            <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono text-paper/80">{traceResult.stdout || "(no output)"}</pre>
          </section>
          <section aria-label="Execution status" className="min-w-0 border-l border-ink-700 pl-3">
            <div className="mb-1 font-semibold uppercase tracking-wide text-paper/50">{traceResult.error ? "Error" : "Status"}</div>
            <pre className={`max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono ${traceResult.error ? "text-node-condition" : "text-paper/70"}`}>{traceResult.error ?? traceResult.message ?? "Execution completed."}</pre>
          </section>
        </footer>
      )}

      {showInputPrompt && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="input-prompt-title">
        <section className="w-full max-w-lg rounded-xl border border-signal/50 bg-ink-950 p-5 shadow-2xl">
          <h2 id="input-prompt-title" className="text-lg font-semibold">This program needs input</h2>
          <p className="mt-2 text-sm text-paper/60">Enter each value on its own line. GraphMind will send these values to the program as it runs.</p>
          <textarea autoFocus value={userInput} onChange={(event) => setUserInput(event.target.value)} placeholder={"For example:\n5\n10"} className="mt-4 h-32 w-full resize-y rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-sm text-paper placeholder:text-paper/30 focus:outline-none focus:ring-2 focus:ring-signal/50" />
          <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShowInputPrompt(false)} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-paper/70 hover:bg-ink-800">Cancel</button><button onClick={() => handleRun(true)} disabled={!userInput.trim()} className="btn-3d rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-ink-950 disabled:cursor-not-allowed disabled:opacity-50">Run program</button></div>
        </section>
      </div>}

      {(showImport || showSessions) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <section className="max-h-[80vh] w-full max-w-xl overflow-auto rounded-xl border border-ink-700 bg-ink-950 p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{showImport ? "Import public GitHub code" : "Saved sessions"}</h2><button onClick={() => { setShowImport(false); setShowSessions(false); }}><X className="h-5 w-5" /></button></div>
          {showImport ? <><div className="flex gap-2"><input aria-label="GitHub repository URL" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/owner/repository" className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm" /><button onClick={browseRepository} disabled={isImporting || !githubUrl} className="btn-3d rounded-lg bg-signal px-3 text-sm font-semibold text-ink-950 disabled:opacity-50">Browse</button></div>
            <p className="mt-2 text-xs text-paper/50">Public repositories only. Choose a supported source file below.</p>
            <div className="mt-4 space-y-1">{githubFiles.map((file) => <button key={file.path} onClick={() => importFile(file.path)} className="block w-full rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-ink-800">{file.path} <span className="text-paper/40">({file.size} bytes)</span></button>)}</div></> : <div className="space-y-2">{sessions.length ? sessions.map((session) => <button key={session.id} onClick={() => { setCode(session.code); setLanguage(session.language); setShowSessions(false); setView("code"); }} className="block w-full rounded border border-ink-700 p-3 text-left hover:bg-ink-900"><div className="text-sm">{session.name}</div><div className="text-xs text-paper/50">{session.language}</div></button>) : <p className="text-sm text-paper/50">No saved sessions yet.</p>}</div>}
          {panelError && <p className="mt-3 text-sm text-node-condition">{panelError}</p>}
        </section>
      </div>}
      <Mascot
        mode="studio"
        view={view}
        code={code}
        language={language}
        userInput={userInput}
        hasResults={traceResult !== null}
        isRunning={isRunning}
        onNavigate={setView}
        onRun={() => handleRun()}
        hidden={showImport || showSessions || showInputPrompt || referenceOpen}
        diagnosis={diagnosis?.result ?? null}
        diagnosisStale={diagnosis !== null && !diagnosisIsCurrent}
        onApplyFix={applyFix}
        onDismissDiagnosis={() => setDiagnosis(null)}
      />
    </div>
  );
}
