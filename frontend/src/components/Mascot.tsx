"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Bug, Check, Compass, Info, Lightbulb, Play, Sparkles, Wand2, X } from "lucide-react";
import { analyzeCode, type HintLevel } from "@/lib/codeHints";
import type { Diagnosis, LanguageId } from "@/lib/types";

export type StudioView = "code" | "visualizer" | "graph" | "complexity";

interface MascotProps {
  mode: "home" | "studio";
  view?: StudioView;
  code?: string;
  language?: LanguageId;
  userInput?: string;
  hasResults?: boolean;
  isRunning?: boolean;
  onNavigate?: (view: StudioView) => void;
  onRun?: () => void;
  /** Hide while a drawer or dialog is open. */
  hidden?: boolean;
  /** Error found by the last run, with a suggested fix. */
  diagnosis?: Diagnosis | null;
  /** The code changed since that run, so the fix may no longer apply. */
  diagnosisStale?: boolean;
  onApplyFix?: (runAfter: boolean) => void;
  onDismissDiagnosis?: () => void;
}

const GUIDE: { view: StudioView; title: string; text: string }[] = [
  { view: "code", title: "Write or pick code", text: "Type in the editor, or browse the algorithm reference bar for a ready-made example." },
  { view: "visualizer", title: "Step through memory", text: "Press Run & Visualize, then play or scrub the timeline to watch variables, arrays and the call stack." },
  { view: "graph", title: "Read the structure", text: "See functions, loops and branches as a tree. Click a node to highlight what it calls." },
  { view: "complexity", title: "Measure Big-O", text: "GraphMind runs your code at growing input sizes and fits the curve to name its order of growth." },
];

const HINT_ICON: Record<HintLevel, typeof Info> = { info: Info, tip: Lightbulb, warn: AlertTriangle };
const HINT_COLOR: Record<HintLevel, string> = {
  info: "text-node-call border-node-call/30 bg-node-call/10",
  tip: "text-node-return border-node-return/30 bg-node-return/10",
  warn: "text-signal border-signal/40 bg-signal/10",
};

const GREETINGS: Record<"home" | StudioView, string> = {
  home: "Hi, I'm Graphy! Want a tour?",
  code: "Need a hint for your code?",
  visualizer: "Use ▶ to play each step!",
  graph: "Click a node to trace its calls.",
  complexity: "The bold curve is your Big-O.",
};

function Robot({ look, excited, alert = false }: { look: { x: number; y: number }; excited: boolean; alert?: boolean }) {
  return (
    <div
      className="relative h-[104px] w-[92px]"
      style={{
        transformStyle: "preserve-3d",
        transform: `perspective(500px) rotateY(${look.x * 22}deg) rotateX(${-look.y * 14}deg)`,
        transition: "transform 0.25s ease-out",
      }}
    >
      {/* Antenna */}
      <div className="absolute left-1/2 top-0 h-4 w-[3px] -translate-x-1/2 rounded bg-gradient-to-b from-[#6b7190] to-[#3a3f58]" />
      <div className={`mascot-antenna absolute left-1/2 top-[-6px] h-3 w-3 -translate-x-1/2 rounded-full bg-gradient-to-br ${alert ? "from-[#ffc2d4] to-node-condition" : "from-[#ffd08a] to-signal"}`} />

      {/* Head */}
      <div
        className="absolute left-1/2 top-3 h-[56px] w-[76px] -translate-x-1/2 rounded-[22px] border border-white/10"
        style={{
          background: "radial-gradient(120% 90% at 30% 20%, #4b5170 0%, #2a2e42 45%, #171a26 100%)",
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.18), inset 0 -6px 10px rgba(0,0,0,0.45), 0 10px 18px -6px rgba(0,0,0,0.7)",
          transform: "translateZ(18px)",
        }}
      >
        {/* Ears */}
        <div className="absolute -left-[7px] top-1/2 h-5 w-2 -translate-y-1/2 rounded-l-md bg-gradient-to-b from-node-function to-[#5d4fc4]" />
        <div className="absolute -right-[7px] top-1/2 h-5 w-2 -translate-y-1/2 rounded-r-md bg-gradient-to-b from-node-function to-[#5d4fc4]" />
        {/* Visor */}
        <div
          className="absolute inset-x-[9px] top-[10px] h-[30px] overflow-hidden rounded-[13px] border border-black/60"
          style={{ background: "linear-gradient(180deg, #06070b 0%, #10131c 100%)", boxShadow: "inset 0 0 10px rgba(63,197,183,0.25)" }}
        >
          <div className="absolute inset-x-1 top-0.5 h-2 rounded-full bg-white/[0.07]" />
          <div
            className="absolute inset-0 flex items-center justify-center gap-[13px]"
            style={{ transform: `translate(${look.x * 5}px, ${look.y * 3}px)`, transition: "transform 0.12s ease-out" }}
          >
            {[0, 1].map((eye) => (
              <span
                key={eye}
                className="mascot-blink block rounded-full"
                style={{
                  width: excited ? 12 : 10,
                  height: excited ? 8 : 12,
                  borderRadius: excited ? "12px 12px 3px 3px" : 999,
                  background: alert ? "radial-gradient(circle at 35% 35%, #ffd6e2, #f0648c 60%)" : "radial-gradient(circle at 35% 35%, #c9fff8, #3fc5b7 60%)",
                  boxShadow: alert ? "0 0 8px 2px rgba(240,100,140,0.85)" : "0 0 8px 2px rgba(63,197,183,0.75)",
                }}
              />
            ))}
          </div>
        </div>
        {/* Mouth */}
        <div className="absolute bottom-[6px] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-node-variable/60" />
      </div>

      {/* Body */}
      <div
        className="absolute left-1/2 top-[64px] h-[30px] w-[52px] -translate-x-1/2 rounded-b-[18px] rounded-t-[10px] border border-white/10"
        style={{
          background: "radial-gradient(120% 100% at 30% 10%, #3e4360 0%, #222639 60%, #151823 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 14px -6px rgba(0,0,0,0.7)",
          transform: "translateZ(8px)",
        }}
      >
        <div className="absolute left-1/2 top-1/2 flex h-4 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-ink-950 font-mono text-[9px] font-bold text-signal shadow-[0_0_8px_rgba(232,163,61,0.6)]">
          {"{ }"}
        </div>
      </div>
      {/* Arms */}
      <div className="absolute left-[8px] top-[68px] h-[18px] w-[10px] rotate-[18deg] rounded-full bg-gradient-to-b from-[#4b5170] to-[#232739]" />
      <div className={`absolute right-[8px] top-[68px] h-[18px] w-[10px] rounded-full bg-gradient-to-b from-[#4b5170] to-[#232739] transition-transform ${excited ? "-rotate-[120deg] -translate-y-2" : "-rotate-[18deg]"}`} />
    </div>
  );
}

// Panels Graphy must never cover. Its bottom-right spot is checked against these; on overlap it docks into the header.
const AVOID_SELECTOR = "[data-mascot-avoid], .react-flow__minimap, .react-flow__controls";
const FLOAT_BOX = { width: 100, height: 128, margin: 16 };

function overlapsPanels(): boolean {
  const right = window.innerWidth - FLOAT_BOX.margin;
  const bottom = window.innerHeight - FLOAT_BOX.margin;
  const left = right - FLOAT_BOX.width;
  const top = bottom - FLOAT_BOX.height;
  return [...document.querySelectorAll(AVOID_SELECTOR)].some((element) => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left < right && r.right > left && r.top < bottom && r.bottom > top;
  });
}

function FixPanel({ diagnosis, stale, onApply, onDismiss }: { diagnosis: Diagnosis; stale: boolean; onApply?: (runAfter: boolean) => void; onDismiss?: () => void }) {
  const fixLine = diagnosis.fixLine ?? diagnosis.line;
  const shared = Math.min(
    ...[diagnosis.original, diagnosis.suggestion ?? diagnosis.original].filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
  );
  const shown = (line: string) => line.slice(Number.isFinite(shared) ? shared : 0);
  const canFix = diagnosis.fixedCode !== null && diagnosis.suggestion !== null && !stale;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-node-condition/40 bg-node-condition/10 p-2.5">
        <span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-md bg-node-condition px-1.5 font-mono text-[11px] font-bold text-ink-950">L{diagnosis.line}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-paper">{diagnosis.title}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-paper/70">{diagnosis.explanation}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-950 font-mono text-[12px]">
        <div className="flex items-center justify-between border-b border-ink-800 px-2.5 py-1 text-[10px] uppercase tracking-wider text-paper/40">
          <span>{diagnosis.action === "insert" ? `Add before line ${fixLine}` : diagnosis.action === "replace" ? `Change line ${fixLine}` : `Line ${fixLine}`}</span>
          <span className={diagnosis.confidence === "high" ? "text-node-return" : diagnosis.confidence === "medium" ? "text-signal" : "text-paper/40"}>
            {diagnosis.confidence === "high" ? "confident fix" : diagnosis.confidence === "medium" ? "likely fix" : "hint"}
          </span>
        </div>
        {diagnosis.action !== "insert" && (
          <div className="flex gap-2 bg-node-condition/10 px-2.5 py-1.5">
            <span className="w-6 shrink-0 select-none text-right text-node-condition/70">{fixLine}</span>
            <span className="select-none text-node-condition">{diagnosis.action === "replace" ? "−" : "!"}</span>
            <span className={`whitespace-pre-wrap break-all text-paper/85 ${diagnosis.action === "replace" ? "line-through decoration-node-condition/60" : ""}`}>{shown(diagnosis.original) || " "}</span>
          </div>
        )}
        {diagnosis.suggestion !== null && (
          <div className="flex gap-2 bg-node-return/10 px-2.5 py-1.5">
            <span className="w-6 shrink-0 select-none text-right text-node-return/70">{fixLine}</span>
            <span className="select-none text-node-return">+</span>
            <span className="whitespace-pre-wrap break-all text-paper">{shown(diagnosis.suggestion) || " "}</span>
          </div>
        )}
      </div>

      {stale && <p className="text-[11px] text-signal">You edited the code after this run — run again to re-check it.</p>}

      <div className="flex flex-wrap gap-2">
        {canFix && (
          <>
            <button onClick={() => onApply?.(true)} className="btn-3d flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-node-return px-3 py-2 text-xs font-semibold text-ink-950">
              <Wand2 className="h-3.5 w-3.5" /> Fix &amp; run again
            </button>
            <button onClick={() => onApply?.(false)} className="btn-ghost-3d flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-xs text-paper/85">
              <Check className="h-3.5 w-3.5" /> Apply fix
            </button>
          </>
        )}
        <button onClick={onDismiss} className="btn-ghost-3d rounded-lg border border-ink-600 px-3 py-2 text-xs text-paper/60">Dismiss</button>
      </div>

      {diagnosis.message && (
        <details className="text-[11px] text-paper/45">
          <summary className="cursor-pointer select-none hover:text-paper/70">Original error message</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 text-[10px] text-paper/60">{diagnosis.message}</pre>
        </details>
      )}
    </div>
  );
}

export default function Mascot({
  mode, view = "code", code = "", language = "python", userInput = "", hasResults = false, isRunning = false,
  onNavigate, onRun, hidden = false, diagnosis = null, diagnosisStale = false, onApplyFix, onDismissDiagnosis,
}: MascotProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"fix" | "guide" | "help">(mode === "studio" ? "help" : "guide");
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [showBubble, setShowBubble] = useState(false);
  const [hover, setHover] = useState(false);
  const [docked, setDocked] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Close the panel when the studio switches views (adjusting state during render, not in an effect).
  const [prevView, setPrevView] = useState(view);
  if (view !== prevView) {
    setPrevView(view);
    setOpen(false);
  }
  // A fresh error diagnosis pops the panel open on the Fix tab straight away.
  const [prevDiagnosis, setPrevDiagnosis] = useState<Diagnosis | null>(diagnosis);
  if (diagnosis !== prevDiagnosis) {
    setPrevDiagnosis(diagnosis);
    if (diagnosis) {
      setOpen(true);
      setTab("fix");
    } else if (tab === "fix") {
      setTab("help");
      setOpen(false);
    }
  }

  // Dock into the header whenever the floating spot would cover a panel.
  useEffect(() => {
    if (mode !== "studio") return;
    const check = () => setDocked(overlapsPanels());
    check();
    const timer = setInterval(check, 500);
    window.addEventListener("resize", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", check);
    };
  }, [mode]);

  // Eyes and head follow the cursor.
  useEffect(() => {
    let frame = 0;
    function handleMove(event: MouseEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        setLook({ x: Math.max(-1, Math.min(1, dx / 500)), y: Math.max(-1, Math.min(1, dy / 400)) });
      });
    }
    window.addEventListener("mousemove", handleMove);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Pop a greeting shortly after load and whenever the view changes.
  useEffect(() => {
    const show = setTimeout(() => setShowBubble(true), 1200);
    const hide = setTimeout(() => setShowBubble(false), 7000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [view, mode]);

  const hints = useMemo(() => (mode === "studio" ? analyzeCode(code, language, userInput) : []), [mode, code, language, userInput]);
  const warnCount = hints.filter((h) => h.level === "warn").length;
  const currentStep = GUIDE.findIndex((step) => step.view === view);
  const alert = diagnosis !== null && !diagnosisStale;
  const bubbleText = alert
    ? `Line ${diagnosis.line} looks wrong — here's a fix!`
    : mode === "studio" && warnCount > 0 && view === "code"
      ? `I spotted ${warnCount} thing${warnCount > 1 ? "s" : ""} in your code.`
      : GREETINGS[mode === "home" ? "home" : view];
  const tabs = ([
    ...(diagnosis ? [["fix", "Fix", Bug] as const] : []),
    ["help", "Code help", Lightbulb] as const,
    ["guide", "Site guide", Compass] as const,
  ]);

  return (
    <>
      <AnimatePresence>
        {open && !hidden && (
          <motion.section
            key="panel"
            initial={{ opacity: 0, y: docked ? -12 : 16, scale: 0.94, rotateX: docked ? -12 : 12 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
            exit={{ opacity: 0, y: docked ? -10 : 12, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            style={{ transformPerspective: 900, transformOrigin: docked ? "top right" : "bottom right" }}
            className={`fixed z-40 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-ink-900/95 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8),0_0_0_1px_rgba(232,163,61,0.08)] backdrop-blur-xl ${
              docked ? "right-3 top-14" : "bottom-36 right-4"
            } ${alert ? "border-node-condition/50" : "border-ink-600/80"}`}
            aria-label="Graphy assistant"
          >
            <header className={`flex items-center justify-between border-b border-ink-700 px-4 py-3 ${alert ? "bg-gradient-to-r from-node-condition/20 via-transparent to-transparent" : "bg-gradient-to-r from-node-function/15 via-transparent to-signal/10"}`}>
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-signal" /> Graphy</div>
                <div className="text-[11px] text-paper/50">{alert ? "I found what broke your run" : "Your GraphMind coding companion"}</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-md p-1 text-paper/50 hover:bg-ink-800 hover:text-paper"><X className="h-4 w-4" /></button>
            </header>

            {mode === "studio" && (
              <div className="flex gap-1 border-b border-ink-700 px-3 pt-2">
                {tabs.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition ${tab === id ? (id === "fix" ? "border-node-condition text-paper" : "border-signal text-paper") : "border-transparent text-paper/45 hover:text-paper/75"}`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${id === "fix" ? "text-node-condition" : ""}`} /> {label}
                    {id === "help" && warnCount > 0 && <span className="rounded-full bg-signal px-1.5 text-[10px] font-bold text-ink-950">{warnCount}</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-[56vh] overflow-y-auto p-3">
              {tab === "fix" && diagnosis ? (
                <FixPanel diagnosis={diagnosis} stale={diagnosisStale} onApply={(run) => { onApplyFix?.(run); setOpen(false); }} onDismiss={() => { onDismissDiagnosis?.(); setOpen(false); }} />
              ) : tab === "help" && mode === "studio" ? (
                <div className="space-y-2">
                  {hints.map((hint) => {
                    const Icon = HINT_ICON[hint.level];
                    return (
                      <div key={hint.title} className={`rounded-lg border p-2.5 ${HINT_COLOR[hint.level]}`}>
                        <div className="flex items-center gap-1.5 text-xs font-semibold"><Icon className="h-3.5 w-3.5" /> {hint.title}</div>
                        <p className="mt-1 text-xs leading-relaxed text-paper/75">{hint.detail}</p>
                      </div>
                    );
                  })}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { onRun?.(); setOpen(false); }}
                      disabled={isRunning}
                      className="btn-3d flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-signal px-3 py-2 text-xs font-semibold text-ink-950 disabled:opacity-60"
                    >
                      <Play className="h-3.5 w-3.5" /> Run &amp; Visualize
                    </button>
                    {view !== "code" && (
                      <button onClick={() => onNavigate?.("code")} className="btn-ghost-3d rounded-lg border border-ink-600 px-3 py-2 text-xs text-paper/80">Back to editor</button>
                    )}
                  </div>
                </div>
              ) : (
                <ol className="space-y-2">
                  {GUIDE.map((step, i) => {
                    const isCurrent = mode === "studio" && i === currentStep;
                    const isLocked = mode === "studio" && step.view !== "code" && !hasResults;
                    return (
                      <li key={step.view}>
                        <button
                          onClick={() => { if (mode === "studio") { onNavigate?.(step.view); setOpen(false); } }}
                          disabled={mode === "home"}
                          className={`group flex w-full gap-3 rounded-lg border p-2.5 text-left transition ${isCurrent ? "border-signal/60 bg-signal/10" : "border-ink-700 bg-ink-950/50 enabled:hover:border-ink-500 enabled:hover:bg-ink-800/60"}`}
                        >
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${isCurrent ? "bg-signal text-ink-950" : "bg-ink-700 text-paper/70"}`}>{i + 1}</span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 text-xs font-semibold text-paper">
                              {step.title}
                              {mode === "studio" && <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-paper/55">{step.text}</span>
                            {isLocked && <span className="mt-1 block text-[10px] text-signal/80">Available after you run your code</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {mode === "home" && (
                    <Link href="/studio" className="btn-3d mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-signal px-3 py-2 text-xs font-semibold text-ink-950">
                      Open the Studio <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </ol>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(showBubble || alert) && !open && !hidden && (
          <motion.div
            key="bubble"
            initial={{ opacity: 0, x: 10, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 10, scale: 0.9 }}
            onClick={() => setOpen(true)}
            className={`fixed z-40 max-w-[220px] cursor-pointer rounded-xl border px-3 py-2 text-xs shadow-xl backdrop-blur ${
              docked ? "right-3 top-14 rounded-tr-sm" : "bottom-[5.5rem] right-[7.5rem] rounded-br-sm"
            } ${alert ? "border-node-condition/60 bg-node-condition/20 text-paper" : "border-ink-600 bg-ink-800/95 text-paper/90"}`}
          >
            {bubbleText}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        layout
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
        className={`fixed z-40 ${docked ? "right-3 top-2" : "bottom-4 right-4"}`}
        aria-hidden={hidden}
      >
        {/* Fades away while a drawer or dialog is open (CSS, so it doesn't fight the layout animation). */}
        <div
          className="transition-[opacity,transform] duration-300"
          style={{ opacity: hidden ? 0 : 1, transform: hidden ? "scale(0.6)" : "none", pointerEvents: hidden ? "none" : "auto" }}
        >
          <button
            ref={anchorRef}
            onClick={() => { setOpen((o) => !o); setShowBubble(false); }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            aria-label={open ? "Close Graphy assistant" : "Open Graphy assistant"}
            aria-expanded={open}
            title={docked ? "Graphy moved up here so it doesn't cover your panels" : undefined}
            className="relative block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-signal/60"
            style={{ width: docked ? 40 : 92, height: docked ? 46 : 118, transition: "width 0.3s, height 0.3s" }}
          >
            <div className="absolute left-0 top-0 flex flex-col items-center" style={{ transform: `scale(${docked ? 0.43 : 1})`, transformOrigin: "top left", transition: "transform 0.3s" }}>
              <div className={docked ? "" : "mascot-float"}>
                <Robot look={look} excited={hover || open} alert={alert} />
              </div>
              {!docked && <div className="mascot-shadow -mt-1 h-2.5 w-14 rounded-full bg-black/70 blur-[3px]" />}
            </div>
            {mode === "studio" && (alert || warnCount > 0) && !open && (
              <span className={`absolute flex items-center justify-center rounded-full font-bold text-ink-950 ${docked ? "-right-1 -top-1 h-4 w-4 text-[9px]" : "right-1 top-2 h-5 w-5 text-[10px]"} ${alert ? "bg-node-condition shadow-[0_0_10px_rgba(240,100,140,0.9)]" : "bg-signal shadow-[0_0_10px_rgba(232,163,61,0.8)]"}`}>
                {alert ? "!" : warnCount}
              </span>
            )}
          </button>
        </div>
      </motion.div>
    </>
  );
}
