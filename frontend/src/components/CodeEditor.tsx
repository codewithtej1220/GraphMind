"use client";

import Editor from "@monaco-editor/react";
import { Play, Loader2, Terminal } from "lucide-react";
import { LANGUAGES, type LanguageId } from "@/lib/types";

interface CodeEditorProps {
  code: string;
  language: LanguageId;
  isRunning: boolean;
  onCodeChange: (value: string) => void;
  onLanguageChange: (value: LanguageId) => void;
  onRun: () => void;
  userInput: string;
  onInputChange: (value: string) => void;
}

export default function CodeEditor({
  code,
  language,
  isRunning,
  onCodeChange,
  onLanguageChange,
  onRun,
  userInput,
  onInputChange,
}: CodeEditorProps) {
  return (
    <div className="flex h-full gap-4 bg-ink-900 p-4">
      {/* Left: Code Editor */}
      <div className="flex flex-1 flex-col rounded-xl border border-ink-700 bg-ink-950 overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-signal" />
            <span className="text-sm font-medium text-paper/80">Source Code</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as LanguageId)}
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-sm text-paper/90 focus:outline-none focus:ring-1 focus:ring-signal"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
            <button
              onClick={onRun}
              disabled={isRunning}
              className="btn-3d flex items-center gap-1.5 rounded-md bg-signal px-3 py-1.5 text-sm font-semibold text-ink-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run &amp; Visualize
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={language}
            value={code}
            onChange={(value) => onCodeChange(value ?? "")}
            theme="vs-dark"
            options={{
              fontSize: 14,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 16 },
              automaticLayout: true,
            }}
          />
        </div>
      </div>

      {/* Right: Input/Output Terminal */}
      <div className="flex w-80 flex-col gap-4" data-mascot-avoid>
        {/* Input Terminal */}
        <div className="flex flex-1 flex-col rounded-xl border border-ink-700 bg-ink-950 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-2.5">
            <Terminal className="h-4 w-4 text-signal" />
            <span className="text-sm font-medium text-paper/80">Program Input</span>
          </div>
          <div className="flex-1 p-3">
            <textarea
              value={userInput}
              onChange={(e) => onInputChange(e.target.value)}
              aria-label="Program input, one value per line"
              placeholder={"Enter each input value on its own line. Example:\n5\n10\n15"}
              className="h-full w-full resize-none rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-xs text-paper placeholder:text-paper/30 focus:outline-none focus:ring-2 focus:ring-signal/50"
            />
          </div>
        </div>

        {/* Info Panel */}
        <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-paper/60">
            How to use input
          </h3>
          <ul className="space-y-1 text-xs text-paper/70">
            <li className="flex gap-2">
              <span className="text-signal">•</span>
              <span>Enter values here before running. If the program needs input, GraphMind will prompt you.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-signal">•</span>
              <span>Put one response on each line. Values are read in order.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-signal">•</span>
              <span>Keep the input box empty when the program does not read input.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
