"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownToLine, BookOpen, Check, Copy, Clock, HardDrive, X } from "lucide-react";
import { ALGORITHMS, ALGORITHM_CATEGORIES, type AlgorithmCategory, type AlgorithmReference } from "@/lib/algorithms";

interface AlgorithmBarProps {
  /** Loads a reference snippet into the editor (as Python). */
  onUse: (code: string) => void;
  /** Tells the page when the reference drawer opens or closes (Graphy hides meanwhile). */
  onOpenChange?: (open: boolean) => void;
}

const CATEGORY_ACCENT: Record<AlgorithmCategory, string> = {
  Sorting: "#e8a33d",
  Searching: "#3fc5b7",
  Graphs: "#5b9ee8",
  "Dynamic Programming": "#8b7cf6",
  Recursion: "#f0648c",
  "Data Structures": "#5fd68f",
};

export default function AlgorithmBar({ onUse, onOpenChange }: AlgorithmBarProps) {
  const [category, setCategory] = useState<AlgorithmCategory>("Sorting");
  const [selected, setSelected] = useState<AlgorithmReference | null>(null);

  const isOpen = selected !== null;
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);
  // Leaving the code view unmounts the bar; make sure the page doesn't think it's still open.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [copied, setCopied] = useState(false);
  const accent = CATEGORY_ACCENT[category];

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (e.g. insecure context); nothing to do.
    }
  }

  return (
    <div className="relative border-b border-ink-700 bg-ink-900/80 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-paper/45">
          <BookOpen className="h-3.5 w-3.5" /> Algorithm reference
        </span>
        <div className="flex flex-wrap gap-1 rounded-lg border border-ink-700 bg-ink-950/70 p-0.5" role="tablist" aria-label="Algorithm type">
          {ALGORITHM_CATEGORIES.map((cat) => {
            const active = cat === category;
            return (
              <button
                key={cat}
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(cat)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${active ? "bg-ink-700 text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_0_rgba(0,0,0,0.4)]" : "text-paper/50 hover:text-paper/80"}`}
                style={active ? { color: CATEGORY_ACCENT[cat] } : undefined}
              >
                {cat}
              </button>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {ALGORITHMS.filter((algo) => algo.category === category).map((algo) => (
            <button
              key={algo.id}
              onClick={() => setSelected(algo)}
              className="btn-ghost-3d flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800/70 px-3 py-1 text-xs text-paper/80"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
              {algo.name}
              <span className="font-mono text-[10px] text-paper/40">{algo.time}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={`${selected.name} reference`}
              initial={{ x: 40, opacity: 0, rotateY: -8 }}
              animate={{ x: 0, opacity: 1, rotateY: 0 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              style={{ transformPerspective: 1200 }}
              className="fixed bottom-4 right-4 top-4 z-50 flex w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-950 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
            >
              <header className="border-b border-ink-700 p-5" style={{ background: `linear-gradient(135deg, ${CATEGORY_ACCENT[selected.category]}22, transparent 60%)` }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: CATEGORY_ACCENT[selected.category] }}>{selected.category}</div>
                    <h2 className="mt-1 text-xl font-semibold">{selected.name}</h2>
                  </div>
                  <button onClick={() => setSelected(null)} aria-label="Close reference" className="rounded-md p-1 text-paper/50 hover:bg-ink-800 hover:text-paper"><X className="h-5 w-5" /></button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-paper/70">{selected.summary}</p>
                <div className="mt-3 flex gap-2">
                  <span className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-xs"><Clock className="h-3.5 w-3.5 text-signal" /> Time {selected.time}</span>
                  <span className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-xs"><HardDrive className="h-3.5 w-3.5 text-node-variable" /> Space {selected.space}</span>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-auto bg-[#0a0c11] py-3">
                <pre className="font-mono text-[13px] leading-6">
                  {selected.code.trimEnd().split("\n").map((line, i) => (
                    <div key={i} className="flex hover:bg-white/[0.03]">
                      <span className="w-10 shrink-0 select-none pr-3 text-right text-paper/25">{i + 1}</span>
                      <span className="whitespace-pre text-paper/85">{line || " "}</span>
                    </div>
                  ))}
                </pre>
              </div>

              <footer className="flex items-center justify-between gap-2 border-t border-ink-700 p-4">
                <span className="text-[11px] text-paper/40">Reference in Python — the Studio traces all 8 languages.</span>
                <div className="flex gap-2">
                  <button onClick={() => copy(selected.code)} className="btn-ghost-3d flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-xs text-paper/80">
                    {copied ? <Check className="h-3.5 w-3.5 text-node-return" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => { onUse(selected.code); setSelected(null); }}
                    className="btn-3d flex items-center gap-1.5 rounded-lg bg-signal px-3 py-2 text-xs font-semibold text-ink-950"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" /> Open in editor
                  </button>
                </div>
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
