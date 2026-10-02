"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronFirst,
  ChevronLast,
  Layers,
  Repeat,
} from "lucide-react";
import type { TraceFrame } from "@/lib/types";
import ArrayInspector from "@/components/ArrayInspector";

interface EnhancedVisualizerProps {
  frames: TraceFrame[];
  supported: boolean;
  message: string | null;
  code: string;
}

const OPERATION_STYLE: Record<
  TraceFrame["operation"],
  { label: string; badge: string; box: string; text: string }
> = {
  READ: { label: "READ", badge: "bg-node-return/20 text-node-return border-node-return/40", box: "border-node-return bg-node-return/15", text: "text-node-return" },
  WRITE: { label: "WRITE", badge: "bg-signal/20 text-signal border-signal/40", box: "border-signal bg-signal/15", text: "text-signal" },
  COMPARE: { label: "COMPARE", badge: "bg-node-condition/20 text-node-condition border-node-condition/40", box: "border-node-condition bg-node-condition/15", text: "text-node-condition" },
  CALL: { label: "CALL", badge: "bg-node-function/20 text-node-function border-node-function/40", box: "border-node-function bg-node-function/15", text: "text-node-function" },
  RETURN: { label: "RETURN", badge: "bg-node-call/20 text-node-call border-node-call/40", box: "border-node-call bg-node-call/15", text: "text-node-call" },
  LOOP: { label: "LOOP", badge: "bg-node-loop/20 text-node-loop border-node-loop/40", box: "border-node-loop bg-node-loop/15", text: "text-node-loop" },
  EXEC: { label: "EXEC", badge: "bg-ink-600/40 text-paper/60 border-ink-600", box: "border-ink-600 bg-ink-800", text: "text-paper/60" },
  ERROR: { label: "ERROR", badge: "bg-node-condition/20 text-node-condition border-node-condition/60", box: "border-node-condition bg-node-condition/20", text: "text-node-condition" },
};

export default function EnhancedVisualizer({ frames, supported, message, code }: EnhancedVisualizerProps) {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  // Adjust state during render (not an effect) when a fresh trace arrives —
  // avoids an extra cascading render pass.
  const [prevFrames, setPrevFrames] = useState(frames);
  if (frames !== prevFrames) {
    setPrevFrames(frames);
    setIndex(0);
    setIsPlaying(false);
  }

  const BASE_INTERVAL_MS = 2000; // Base speed: 2 seconds per step
  const intervalMs = BASE_INTERVAL_MS / speedMultiplier;

  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setIndex((prev) => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, intervalMs, frames.length]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [index]);

  if (!supported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Layers className="h-6 w-6 text-paper/30" />
        <p className="max-w-md text-sm text-paper/50">{message}</p>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-paper/40">
        {message ?? "Run your code to see live variable, array, and call-stack state here."}
      </div>
    );
  }

  const frame = frames[Math.min(index, frames.length - 1)];
  const style = OPERATION_STYLE[frame.operation];
  const previousVariables = index > 0 ? frames[index - 1].variables : {};
  const pointerNames = new Set(Object.keys(frame.pointers));
  const scalarEntries = Object.entries(frame.variables).filter(
    ([name]) => !pointerNames.has(name)
  );

  return (
    <div className="flex h-full flex-col bg-[#0a0e1a] p-4">
      {/* Operation Callout Banner - More Prominent */}
      <AnimatePresence mode="wait">
        <motion.div
          key={frame.step}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={`mb-3 flex items-center gap-4 rounded-xl border-2 px-5 py-3 shadow-lg ${style.badge}`}
        >
          <span className={`rounded-md px-2.5 py-1 text-xs font-bold tracking-wider ${style.text} bg-black/30`}>
            {style.label}
          </span>
          <span className="font-mono text-base font-medium text-paper">
            Step {frame.step}: {frame.description}
          </span>
          {frame.loop && (
            <span className="ml-auto flex items-center gap-2 rounded-full bg-node-loop/30 px-3 py-1 text-xs font-medium text-node-loop border border-node-loop/50">
              <Repeat className="h-3.5 w-3.5" />
              Loop iteration {frame.loop.iteration}
              {frame.loop.total ? ` of ${frame.loop.total}` : ""}
            </span>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Main Content Grid - 2 columns: Left (Stack+Vars) | Right (Array+Code) */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Left Column - Call Stack and Variables */}
        <div className="flex w-5/12 flex-col gap-3 overflow-hidden">
          {/* Call Stack */}
          <section className="flex-1 overflow-auto rounded-xl border border-ink-700 bg-ink-900/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-paper/60">
              <div className="h-1 w-1 rounded-full bg-signal"></div>
              Call Stack
            </h3>
            <div className="flex flex-col-reverse gap-2">
              {frame.callStack.map((fn, i) => {
                const isTop = i === frame.callStack.length - 1;
                const paramText =
                  isTop && frame.callInfo?.function === fn && frame.callInfo.args
                    ? Object.entries(frame.callInfo.args)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(", ")
                    : null;
                return (
                  <motion.div
                    key={`${fn}-${i}`}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex flex-col gap-1"
                  >
                    <div
                      className={`rounded-lg border-2 px-3 py-1.5 font-mono text-xs font-bold shadow-md ${
                        isTop
                          ? "border-node-function bg-node-function/20 text-paper"
                          : "border-ink-600 bg-ink-800 text-paper/50"
                      }`}
                      style={{ marginLeft: i * 12 }}
                    >
                      &lt;{fn}()&gt;
                    </div>
                    {paramText && (
                      <span className="ml-3 font-mono text-[10px] text-node-function/90" style={{ marginLeft: i * 12 + 12 }}>
                        ← receives ({paramText})
                      </span>
                    )}
                    {isTop && frame.operation === "RETURN" && frame.callInfo?.value !== undefined && (
                      <span className="ml-3 font-mono text-[10px] text-node-call/90" style={{ marginLeft: i * 12 + 12 }}>
                        → returns {String(frame.callInfo.value)}
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* Active Variables */}
          <section className="rounded-xl border border-ink-700 bg-ink-900/50 p-4">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-paper/60">
              <div className="h-1 w-1 rounded-full bg-signal"></div>
              Active Variables
            </h3>
            {scalarEntries.length === 0 ? (
              <p className="text-xs italic text-paper/30">(none yet)</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {scalarEntries.map(([name, value]) => {
                  const changed = name in previousVariables && JSON.stringify(previousVariables[name]) !== JSON.stringify(value);
                  const isNew = !(name in previousVariables);
                  return (
                    <motion.div
                      key={name}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{
                        scale: changed ? [1, 1.12, 1] : 1,
                        opacity: 1,
                        borderColor: changed ? "#e8a33d" : isNew ? "#3fc5b7" : "#333849",
                      }}
                      transition={{ duration: 0.35 }}
                      className="rounded-lg border-2 bg-ink-800 px-3 py-1.5 font-mono text-xs shadow-md"
                      title={changed ? `changed from ${formatScalar(previousVariables[name])}` : undefined}
                    >
                      <span className="font-bold text-node-call">{name}</span>
                      <span className="text-paper/50"> = </span>
                      <span className="font-semibold text-signal">{formatScalar(value)}</span>
                      {changed && <span className="ml-1.5 text-[10px] text-paper/40 line-through">{formatScalar(previousVariables[name])}</span>}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column - Array (top) and Code (bottom) */}
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          {/* Array Visualization - Top */}
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900/50 p-4" style={{ height: '58%' }}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-paper/60">
              <div className="h-1 w-1 rounded-full bg-signal"></div>
              Arrays &amp; Lists
            </h3>
            <div className="min-h-0 flex-1">
              <ArrayInspector frames={frames} index={Math.min(index, frames.length - 1)} />
            </div>
          </section>

          {/* Code Panel - Bottom */}
          <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900/50 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-paper/60">
              <div className="h-1 w-1 rounded-full bg-signal"></div>
              Code Execution
            </h3>
            <div className="flex-1 overflow-auto rounded-lg bg-ink-950 p-2 font-mono text-[10px] leading-relaxed">
              {code.split('\n').map((line, idx) => {
                const lineNum = idx + 1;
                const isActive = lineNum === frame.activeLine;
                return (
                  <div
                    key={idx}
                    ref={isActive ? activeLineRef : null}
                    className={`flex gap-2 px-2 py-0.5 rounded transition-colors ${
                      isActive
                        ? frame.operation === "ERROR" ? 'bg-node-condition/30 border-l-2 border-node-condition text-paper font-medium' : 'bg-signal/30 border-l-2 border-signal text-paper font-medium'
                        : 'text-paper/60 hover:bg-ink-900/50'
                    }`}
                  >
                    <span className={`w-6 shrink-0 text-right select-none ${isActive ? (frame.operation === "ERROR" ? 'text-node-condition font-bold' : 'text-signal font-bold') : 'text-paper/30'}`}>
                      {lineNum}
                    </span>
                    <span className="whitespace-pre">{line || ' '}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Execution Controls - Bottom Fixed */}
      <div className="mt-3 flex items-center gap-4 rounded-xl border-2 border-ink-600 bg-ink-900/95 p-3 shadow-lg" data-mascot-avoid>
        {/* Main Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIndex(0)}
            disabled={index === 0}
            className="rounded-lg border-2 border-ink-600 bg-ink-800 p-1.5 text-paper/70 hover:bg-ink-700 hover:text-paper disabled:opacity-30 disabled:hover:bg-ink-800"
            aria-label="First step"
          >
            <ChevronFirst className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded-lg border-2 border-ink-600 bg-ink-800 p-1.5 text-paper/70 hover:bg-ink-700 hover:text-paper disabled:opacity-30 disabled:hover:bg-ink-800"
            aria-label="Step back"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="rounded-lg bg-signal p-2 text-ink-950 shadow-lg hover:bg-signal/90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setIndex((i) => Math.min(frames.length - 1, i + 1))}
            disabled={index >= frames.length - 1}
            className="rounded-lg border-2 border-ink-600 bg-ink-800 p-1.5 text-paper/70 hover:bg-ink-700 hover:text-paper disabled:opacity-30 disabled:hover:bg-ink-800"
            aria-label="Step forward"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIndex(frames.length - 1)}
            disabled={index >= frames.length - 1}
            className="rounded-lg border-2 border-ink-600 bg-ink-800 p-1.5 text-paper/70 hover:bg-ink-700 hover:text-paper disabled:opacity-30 disabled:hover:bg-ink-800"
            aria-label="Last step"
          >
            <ChevronLast className="h-4 w-4" />
          </button>
        </div>

        {/* Progress Bar and Step Counter */}
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          className="flex-1 accent-signal"
        />
        <span className="w-14 shrink-0 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-center font-mono text-xs text-paper/70">
          {index + 1}/{frames.length}
        </span>

        {/* Speed Control */}
        <div className="flex items-center gap-2 border-l border-ink-700 pl-4">
          <label className="flex items-center gap-1.5 text-xs text-paper/50">
            {isPlaying && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal shadow-lg" />
            )}
            <span className="font-medium">Speed</span>
          </label>
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.25}
            value={speedMultiplier}
            onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
            className="w-24 accent-signal"
          />
          <span className="w-8 text-right font-mono text-xs text-paper/70">
            {speedMultiplier.toFixed(2)}x
          </span>
        </div>

        {/* Step Info */}
        <span className="border-l border-ink-700 pl-4 font-mono text-[10px] text-paper/30">
          line {frame.activeLine}
        </span>
      </div>
    </div>
  );
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  }
  return String(value);
}
