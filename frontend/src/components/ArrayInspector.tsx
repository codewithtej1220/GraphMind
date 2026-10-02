"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Grid3x3, Rows3 } from "lucide-react";
import type { TraceFrame } from "@/lib/types";

interface ArrayInspectorProps {
  frames: TraceFrame[];
  index: number;
}

type ViewMode = "bars" | "boxes";

const COLORS = {
  compare: "#f0648c",
  read: "#5b9ee8",
  changed: "#e8a33d",
  swap: "#8b7cf6",
  pointer: "#3fc5b7",
};

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const is2D = (values: unknown[]) => values.length > 0 && values.every((v) => Array.isArray(v));
const isNumeric = (values: unknown[]) => values.length > 0 && values.every((v) => typeof v === "number");

function arraysOf(frame: TraceFrame): Record<string, unknown[]> {
  if (frame.arrays && Object.keys(frame.arrays).length) return frame.arrays;
  return frame.arrayName ? { [frame.arrayName]: frame.arrayState } : {};
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") return value.length > 8 ? `${value.slice(0, 7)}…` : value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "T" : "F";
  const text = JSON.stringify(value);
  return text.length > 8 ? `${text.slice(0, 7)}…` : text;
}

interface ArrayHistory {
  /** Stable element ids per frame, so swapped elements visibly move instead of repainting. */
  ids: Map<string, number[]>[];
  changed: Map<string, Set<number>>[];
  swapped: Map<string, [number, number]>[];
  range: Map<string, [number, number]>;
}

function buildHistory(frames: TraceFrame[]): ArrayHistory {
  let nextId = 0;
  const prevIds = new Map<string, number[]>();
  const prevValues = new Map<string, unknown[]>();
  // A swap through a temp variable takes two writes, so also compare with a couple of steps back.
  const recent = new Map<string, { values: unknown[]; ids: number[] }[]>();
  const range = new Map<string, [number, number]>();
  const ids: ArrayHistory["ids"] = [];
  const changed: ArrayHistory["changed"] = [];
  const swapped: ArrayHistory["swapped"] = [];

  for (const frame of frames) {
    const frameIds = new Map<string, number[]>();
    const frameChanged = new Map<string, Set<number>>();
    const frameSwapped = new Map<string, [number, number]>();
    for (const [name, values] of Object.entries(arraysOf(frame))) {
      if (!Array.isArray(values)) continue;
      const before = prevValues.get(name);
      const beforeIds = prevIds.get(name);
      let current: number[];
      const diff = new Set<number>();
      if (before && beforeIds && before.length === values.length) {
        current = [...beforeIds];
        values.forEach((v, i) => { if (!same(v, before[i])) diff.add(i); });
        const [a, b] = [...diff];
        if (diff.size === 2 && same(before[a], values[b]) && same(before[b], values[a])) {
          [current[a], current[b]] = [current[b], current[a]];
          frameSwapped.set(name, [a, b]);
        } else if (diff.size === 1) {
          for (const snapshot of recent.get(name) ?? []) {
            if (snapshot.values.length !== values.length) continue;
            const moved = values.map((_, i) => i).filter((i) => !same(snapshot.values[i], values[i]));
            const [x, y] = moved;
            if (moved.length === 2 && moved.includes(a) && same(snapshot.values[x], values[y]) && same(snapshot.values[y], values[x])) {
              current = [...snapshot.ids];
              [current[x], current[y]] = [current[y], current[x]];
              frameSwapped.set(name, [x, y]);
              break;
            }
          }
        }
      } else if (before && beforeIds && values.length > before.length && before.every((v, i) => same(v, values[i]))) {
        current = [...beforeIds, ...values.slice(before.length).map(() => nextId++)];
        for (let i = before.length; i < values.length; i++) diff.add(i);
      } else if (before && beforeIds && values.length < before.length && values.every((v, i) => same(v, before[i]))) {
        current = beforeIds.slice(0, values.length);
      } else {
        current = values.map(() => nextId++);
      }
      frameIds.set(name, current);
      if (diff.size) frameChanged.set(name, diff);
      if (before && beforeIds) recent.set(name, [{ values: before, ids: beforeIds }, ...(recent.get(name) ?? [])].slice(0, 3));
      prevIds.set(name, current);
      prevValues.set(name, values);
      if (isNumeric(values)) {
        const [lo, hi] = range.get(name) ?? [0, 0];
        range.set(name, [Math.min(lo, ...(values as number[])), Math.max(hi, ...(values as number[]))]);
      }
    }
    ids.push(frameIds);
    changed.push(frameChanged);
    swapped.push(frameSwapped);
  }
  return { ids, changed, swapped, range };
}

export default function ArrayInspector({ frames, index }: ArrayInspectorProps) {
  const [mode, setMode] = useState<ViewMode>("bars");
  const [pinned, setPinned] = useState<string | null>(null);
  const history = useMemo(() => buildHistory(frames), [frames]);

  const frame = frames[index];
  const arrays = arraysOf(frame);
  const names = Object.keys(arrays);
  const primary = pinned && arrays[pinned] ? pinned : frame.arrayName && arrays[frame.arrayName] ? frame.arrayName : names[0];

  if (!primary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Rows3 className="h-6 w-6 text-paper/20" />
        <p className="text-xs text-paper/40">No array or list in scope at this step.</p>
      </div>
    );
  }

  const values = arrays[primary];
  const accessed = frame.accessed?.[primary] ?? [];
  const isCompare = frame.operation === "COMPARE";
  const others = names.filter((n) => n !== primary);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-paper">{primary}</span>
          <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-paper/50">
            {is2D(values) ? `${values.length}×${(values[0] as unknown[]).length}` : `length ${values.length}`}
          </span>
          {pinned && (
            <button onClick={() => setPinned(null)} className="text-[10px] text-paper/40 underline-offset-2 hover:text-paper/70 hover:underline">
              follow active array
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Legend />
          {!is2D(values) && isNumeric(values) && (
            <div className="flex rounded-lg border border-ink-700 bg-ink-950 p-0.5" role="group" aria-label="Array view">
              {([["bars", BarChart3], ["boxes", Grid3x3]] as const).map(([id, Icon]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  aria-pressed={mode === id}
                  title={id === "bars" ? "Bars" : "Boxes"}
                  className={`rounded-md p-1 transition ${mode === id ? "bg-ink-700 text-paper" : "text-paper/40 hover:text-paper/70"}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main view */}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-ink-800 bg-[radial-gradient(ellipse_at_top,rgba(139,124,246,0.06),transparent_70%)] p-3">
        {is2D(values) ? (
          <Grid2D values={values as unknown[][]} accessed={accessed as [number, number][]} isCompare={isCompare} previous={index > 0 ? arraysOf(frames[index - 1])[primary] : undefined} />
        ) : (
          <Strip
            name={primary}
            values={values}
            ids={history.ids[index].get(primary) ?? values.map((_, i) => -i - 1)}
            changed={history.changed[index].get(primary) ?? new Set()}
            swapped={history.swapped[index].get(primary)}
            accessed={accessed as number[]}
            isCompare={isCompare}
            pointers={frame.arrayName === primary ? frame.pointers : {}}
            range={history.range.get(primary)}
            mode={isNumeric(values) ? mode : "boxes"}
          />
        )}
      </div>

      {/* Other arrays in scope */}
      {others.length > 0 && (
        <div className="flex max-h-24 flex-col gap-1 overflow-auto">
          {others.map((name) => {
            const other = arrays[name];
            const otherAccessed = new Set((frame.accessed?.[name] ?? []).map((v) => JSON.stringify(v)));
            const otherChanged = history.changed[index].get(name) ?? new Set();
            return (
              <button
                key={name}
                onClick={() => setPinned(name)}
                title={`Show ${name} in the main view`}
                className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-950/60 px-2 py-1 text-left transition hover:border-ink-600"
              >
                <span className="w-16 shrink-0 truncate font-mono text-[11px] text-paper/60">{name}</span>
                <span className="flex min-w-0 gap-0.5 overflow-hidden">
                  {(is2D(other) ? other.map((row) => `[${(row as unknown[]).map(formatValue).join(",")}]`) : other.map(formatValue)).slice(0, 40).map((v, i) => (
                    <span
                      key={i}
                      className="rounded-sm px-1 font-mono text-[10px] text-paper/70"
                      style={{
                        background: otherAccessed.has(JSON.stringify(i)) ? `${COLORS.read}40` : otherChanged.has(i) ? `${COLORS.changed}40` : "#191c26",
                      }}
                    >
                      {v}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [["Compare", COLORS.compare], ["Read/write", COLORS.read], ["Changed", COLORS.changed], ["Swap", COLORS.swap]];
  return (
    <div className="hidden items-center gap-2.5 xl:flex" aria-label="Legend">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1 text-[10px] text-paper/50">
          <span className="h-2 w-2 rounded-sm" style={{ background: color }} /> {label}
        </span>
      ))}
    </div>
  );
}

interface StripProps {
  name: string;
  values: unknown[];
  ids: number[];
  changed: Set<number>;
  swapped?: [number, number];
  accessed: number[];
  isCompare: boolean;
  pointers: Record<string, number>;
  range?: [number, number];
  mode: ViewMode;
}

function Strip({ name, values, ids, changed, swapped, accessed, isCompare, pointers, range, mode }: StripProps) {
  const count = values.length;
  const compact = count > 32;
  const accessedSet = new Set(accessed);
  const [lo, hi] = range ?? [0, 1];
  const span = Math.max(hi - lo, 1e-9);
  const baseline = hi <= 0 ? 0 : lo >= 0 ? 1 : hi / span; // fraction from the top where zero sits
  const pointerGroups = new Map<number, string[]>();
  Object.entries(pointers).forEach(([pointer, idx]) => pointerGroups.set(idx, [...(pointerGroups.get(idx) ?? []), pointer]));
  const colWidth = `${100 / Math.max(count, 1)}%`;

  const tone = (i: number) => {
    if (swapped && (i === swapped[0] || i === swapped[1])) return COLORS.swap;
    if (accessedSet.has(i)) return isCompare ? COLORS.compare : COLORS.read;
    if (changed.has(i)) return COLORS.changed;
    return null;
  };

  return (
    <div className="flex h-full min-h-[150px] min-w-full flex-col" style={{ minWidth: compact ? count * 10 : count * 40 }}>
      {/* Pointer labels */}
      <div className="relative h-7 shrink-0">
        {[...pointerGroups.entries()].map(([idx, labels]) => (
          <motion.div
            key={labels.join(",")}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            initial={false}
            animate={{ left: `${((idx + 0.5) / count) * 100}%` }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            <span className="whitespace-nowrap rounded px-1.5 py-px font-mono text-[10px] font-bold text-ink-950 shadow" style={{ background: COLORS.pointer }}>
              {labels.join(" ")}
            </span>
            <span className="text-[10px] leading-none" style={{ color: COLORS.pointer }}>▼</span>
          </motion.div>
        ))}
      </div>

      {/* Swap arc */}
      <div className="relative h-8 shrink-0">
        {swapped && (
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden>
            <motion.path
              key={`${name}-${swapped.join("-")}`}
              d={`M ${((swapped[0] + 0.5) / count) * 100} 31 C ${((swapped[0] + 0.5) / count) * 100} 2, ${((swapped[1] + 0.5) / count) * 100} 2, ${((swapped[1] + 0.5) / count) * 100} 31`}
              fill="none"
              stroke={COLORS.swap}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.45 }}
            />
          </svg>
        )}
      </div>

      {/* Elements */}
      <div className={`relative flex min-h-0 flex-1 ${mode === "bars" ? "items-stretch" : "items-center"}`}>
        {mode === "bars" && lo < 0 && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-600" style={{ top: `${baseline * 100}%` }} />
        )}
        {values.map((value, i) => {
          const color = tone(i);
          const pointed = pointerGroups.has(i);
          return (
            <motion.div
              key={ids[i] ?? i}
              layout
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="flex h-full flex-col items-center justify-end"
              style={{ width: colWidth, paddingInline: compact ? 1 : 3 }}
            >
              {mode === "bars" ? (
                <BarCell value={value as number} lo={lo} span={span} baseline={baseline} color={color} pointed={pointed} compact={compact} />
              ) : (
                <BoxCell value={value} color={color} pointed={pointed} />
              )}
              {!compact && <span className={`mt-1 font-mono text-[10px] ${pointed ? "font-bold text-node-variable" : "text-paper/35"}`}>{i}</span>}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function BarCell({ value, lo, span, baseline, color, pointed, compact }: { value: number; lo: number; span: number; baseline: number; color: string | null; pointed: boolean; compact: boolean }) {
  const height = (Math.abs(value) / span) * 100;
  const negative = value < 0 && lo < 0;
  const fill = color ?? "#3a3f58";
  return (
    <div className="relative mt-4 w-full flex-1">
      <motion.div
        className="absolute inset-x-0 rounded-t-md"
        initial={false}
        animate={{
          height: `${Math.max(height, 1.5)}%`,
          backgroundColor: fill,
          boxShadow: color ? `0 0 16px -2px ${color}` : "inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
        transition={{ type: "spring", stiffness: 240, damping: 24 }}
        style={{
          [negative ? "top" : "bottom"]: `${(negative ? baseline : 1 - baseline) * 100}%`,
          borderRadius: negative ? "0 0 6px 6px" : "6px 6px 0 0",
          outline: pointed ? `1.5px solid ${COLORS.pointer}` : undefined,
          outlineOffset: 1,
          backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.12))",
        }}
      >
        {!compact && (
          // Sits just outside the bar's end so even tiny bars stay readable.
          <span
            className="absolute inset-x-0 text-center font-mono text-[10px] font-semibold"
            style={{ [negative ? "top" : "bottom"]: "100%", color: color ?? "rgba(238,240,245,0.75)", paddingBlock: 2 }}
          >
            {formatValue(value)}
          </span>
        )}
      </motion.div>
    </div>
  );
}

function BoxCell({ value, color, pointed }: { value: unknown; color: string | null; pointed: boolean }) {
  return (
    <motion.div
      className="flex aspect-square w-full max-w-14 items-center justify-center rounded-lg border-2 font-mono text-sm font-bold text-paper"
      initial={false}
      animate={{
        borderColor: color ?? (pointed ? COLORS.pointer : "#333849"),
        backgroundColor: color ? `${color}2e` : "#191c26",
        scale: color ? 1.08 : 1,
        boxShadow: color ? `0 0 18px -4px ${color}, 0 4px 0 rgba(0,0,0,0.4)` : "0 4px 0 rgba(0,0,0,0.4)",
      }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      {formatValue(value)}
    </motion.div>
  );
}

function Grid2D({ values, accessed, isCompare, previous }: { values: unknown[][]; accessed: [number, number][]; isCompare: boolean; previous?: unknown[] }) {
  const accessedKeys = new Set(accessed.map(([r, c]) => `${r},${c}`));
  const numbers = values.flat().filter((v): v is number => typeof v === "number");
  const max = Math.max(1, ...numbers.map(Math.abs));
  const prev = previous && is2D(previous) ? (previous as unknown[][]) : undefined;
  const cols = Math.max(...values.map((row) => row.length));
  return (
    <div className="inline-grid gap-1" style={{ gridTemplateColumns: `20px repeat(${cols}, minmax(26px, 40px))`, gridAutoRows: values.length > 8 ? "26px" : "32px" }}>
      <span />
      {Array.from({ length: cols }, (_, c) => (
        <span key={c} className="text-center font-mono text-[10px] text-paper/35">{c}</span>
      ))}
      {values.map((row, r) => (
        <div key={r} className="contents">
          <span className="self-center text-right font-mono text-[10px] text-paper/35">{r}</span>
          {Array.from({ length: cols }, (_, c) => {
            const value = row[c];
            const hit = accessedKeys.has(`${r},${c}`);
            const changed = prev !== undefined && !same(prev[r]?.[c], value);
            const color = hit ? (isCompare ? COLORS.compare : COLORS.read) : changed ? COLORS.changed : null;
            const heat = typeof value === "number" ? Math.abs(value) / max : 0;
            return (
              <motion.div
                key={c}
                className="flex items-center justify-center rounded-md border font-mono text-[11px] font-semibold text-paper"
                initial={false}
                animate={{
                  borderColor: color ?? "#2a2f40",
                  backgroundColor: color ? `${color}33` : `rgba(232,163,61,${(heat * 0.28).toFixed(3)})`,
                  scale: color ? 1.08 : 1,
                }}
                transition={{ duration: 0.25 }}
              >
                {value === undefined ? "" : formatValue(value)}
              </motion.div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
