"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Rows3 } from "lucide-react";
import type { TraceFrame } from "@/lib/types";

interface ArrayInspectorProps {
  frames: TraceFrame[];
  index: number;
}


const COLORS = {
  compare: "#f0648c",
  read: "#5b9ee8",
  changed: "#e8a33d",
  swap: "#8b7cf6",
  pointer: "#3fc5b7",
};

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const is2D = (values: unknown[]) => values.length > 0 && values.every((v) => Array.isArray(v));

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

/** A value travelling into cell `to`: from another cell, or dropped in from a variable such as `temp`. */
interface Move {
  to: number;
  from: number | null;
  variable: string | null;
  value: unknown;
}

interface ArrayHistory {
  /** Stable element ids per frame, so one-step swaps visibly slide instead of repainting. */
  ids: Map<string, number[]>[];
  changed: Map<string, Set<number>>[];
  swapped: Map<string, [number, number]>[];
  moves: Map<string, Move[]>[];
}

/** Names that usually hold a value being moved around (temp swaps, insertion sort's key). */
const HOLDER_NAMES = ["temp", "tmp", "t", "swap", "key", "x", "val", "value", "aux", "hold"];

/** Where did the value written into `to` come from? Prefer cells/variables the previous line touched. */
function sourceOf(to: number, value: unknown, before: unknown[], previous: TraceFrame | undefined, name: string): Move | null {
  const read = (previous?.accessed?.[name] ?? []).filter((i): i is number => typeof i === "number" && i !== to);
  const fromCell = read.find((i) => same(before[i], value));
  if (fromCell !== undefined) return { to, from: fromCell, variable: null, value };
  const variables = Object.entries(previous?.variables ?? {}).filter(([, v]) => same(v, value));
  if (variables.length) {
    const preferred = variables.find(([n]) => HOLDER_NAMES.includes(n)) ?? variables[0];
    return { to, from: null, variable: preferred[0], value };
  }
  return null;
}

function buildHistory(frames: TraceFrame[]): ArrayHistory {
  let nextId = 0;
  const prevIds = new Map<string, number[]>();
  const prevValues = new Map<string, unknown[]>();
  // A swap through a temp variable takes two writes, so also compare with a couple of steps back.
  const recent = new Map<string, unknown[][]>();
  const ids: ArrayHistory["ids"] = [];
  const changed: ArrayHistory["changed"] = [];
  const swapped: ArrayHistory["swapped"] = [];
  const moves: ArrayHistory["moves"] = [];

  frames.forEach((frame, index) => {
    const frameIds = new Map<string, number[]>();
    const frameChanged = new Map<string, Set<number>>();
    const frameSwapped = new Map<string, [number, number]>();
    const frameMoves = new Map<string, Move[]>();
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
          // One-step swap (tuple assignment, destructuring, std::swap): the two blocks trade places.
          [current[a], current[b]] = [current[b], current[a]];
          frameSwapped.set(name, [a, b]);
        } else if (diff.size >= 1 && diff.size <= 3 && !is2D(values)) {
          // Single writes (temp swaps, shifts): show each value travelling to its new cell.
          const list = [...diff].map((to) => sourceOf(to, values[to], before, frames[index - 1], name)).filter((m): m is Move => m !== null);
          if (list.length) frameMoves.set(name, list);
          // The write that completes a temp swap also gets the swap arc.
          for (const snapshot of recent.get(name) ?? []) {
            if (snapshot.length !== values.length) continue;
            const moved = values.map((_, i) => i).filter((i) => !same(snapshot[i], values[i]));
            const [x, y] = moved;
            if (moved.length === 2 && moved.includes(a) && same(snapshot[x], values[y]) && same(snapshot[y], values[x])) {
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
      if (before) recent.set(name, [before, ...(recent.get(name) ?? [])].slice(0, 3));
      prevIds.set(name, current);
      prevValues.set(name, values);
    }
    ids.push(frameIds);
    changed.push(frameChanged);
    swapped.push(frameSwapped);
    moves.push(frameMoves);
  });
  return { ids, changed, swapped, moves };
}

export default function ArrayInspector({ frames, index }: ArrayInspectorProps) {
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
            moves={history.moves[index].get(primary) ?? []}
            step={index}
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
  moves: Move[];
  /** Current step, so the travel animation replays whenever you land on this step. */
  step: number;
}

/** Fixed-size blocks in a row, with pointer tags above and indexes below. */
function Strip({ name, values, ids, changed, swapped, accessed, isCompare, pointers, moves, step }: StripProps) {
  const count = values.length;
  const slot = count > 16 ? 44 : 60; // px per element column
  const box = slot - 12;
  const width = count * slot;
  const accessedSet = new Set(accessed);
  const pointerGroups = new Map<number, string[]>();
  Object.entries(pointers).forEach(([pointer, idx]) => pointerGroups.set(idx, [...(pointerGroups.get(idx) ?? []), pointer]));
  const center = (i: number) => i * slot + slot / 2;

  const tone = (i: number) => {
    if (swapped && (i === swapped[0] || i === swapped[1])) return COLORS.swap;
    if (accessedSet.has(i)) return isCompare ? COLORS.compare : COLORS.read;
    if (changed.has(i)) return COLORS.changed;
    return null;
  };

  return (
    <div className="flex h-full min-h-[120px] items-center">
      <div className="relative mx-auto shrink-0" style={{ width }}>
        {/* Pointer tags */}
        <div className="relative h-8">
          {[...pointerGroups.entries()].map(([idx, labels]) => (
            <motion.div
              key={labels.join(",")}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              initial={false}
              animate={{ left: center(idx) }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
            >
              <span className="whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-[10px] font-bold text-ink-950 shadow-lg" style={{ background: COLORS.pointer }}>
                {labels.join(" ")}
              </span>
              <span className="text-sm leading-none" style={{ color: COLORS.pointer }}>▼</span>
            </motion.div>
          ))}
        </div>

        {/* Swap arc */}
        <svg className="pointer-events-none absolute left-0 top-6 overflow-visible" width={width} height={18} aria-hidden>
          {swapped && (
            <motion.path
              key={`${name}-${swapped.join("-")}`}
              d={`M ${center(swapped[0])} 18 C ${center(swapped[0])} -6, ${center(swapped[1])} -6, ${center(swapped[1])} 18`}
              fill="none"
              stroke={COLORS.swap}
              strokeWidth={2}
              strokeDasharray="4 3"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.45 }}
            />
          )}
        </svg>

        {/* Blocks */}
        <div className="relative flex pt-2">
          {values.map((value, i) => {
            const color = tone(i);
            const pointed = pointerGroups.has(i);
            return (
              <motion.div
                key={ids[i] ?? i}
                layout
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className="flex flex-col items-center gap-1.5"
                style={{ width: slot }}
              >
                <BoxCell value={value} color={color} pointed={pointed} size={box} />
                <span className={`font-mono text-[10px] font-bold ${pointed ? "text-node-variable" : "text-signal/80"}`}>{i}</span>
              </motion.div>
            );
          })}
          {/* Values travelling into their new cells (copies, temp swaps, shifts). */}
          {moves.map((move) => {
            const left = center(move.to) - box / 2;
            const fromLeft = move.from !== null ? center(move.from) - box / 2 : left;
            return (
              <motion.div
                key={`${step}-${move.to}`}
                className="pointer-events-none absolute top-2 z-10 flex flex-col items-center"
                style={{ left: 0, width: box }}
                initial={{ x: fromLeft, y: move.from !== null ? 0 : -46, opacity: 0.95 }}
                animate={{ x: left, y: move.from !== null ? [0, -30, 0] : 0, opacity: [0.95, 0.95, 0] }}
                transition={{ duration: 0.75, ease: "easeInOut", times: [0, 0.75, 1] }}
              >
                <div
                  className="flex items-center justify-center rounded-lg border-2 border-dashed font-mono font-bold text-ink-950"
                  style={{ width: box, height: box, background: COLORS.changed, borderColor: "#fff6", fontSize: box > 40 ? 14 : 12, boxShadow: `0 8px 22px -6px ${COLORS.changed}` }}
                >
                  {formatValue(move.value)}
                </div>
                {move.variable && (
                  <span className="mt-0.5 rounded bg-ink-950/90 px-1 font-mono text-[9px] text-signal">from {move.variable}</span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BoxCell({ value, color, pointed, size }: { value: unknown; color: string | null; pointed: boolean; size: number }) {
  return (
    <motion.div
      className="flex items-center justify-center rounded-lg border-2 font-mono font-bold text-paper"
      style={{ width: size, height: size, fontSize: size > 40 ? 14 : 12 }}
      initial={false}
      animate={{
        borderColor: color ?? (pointed ? COLORS.pointer : "#333849"),
        backgroundColor: color ? `${color}2e` : "#191c26",
        scale: color ? 1.1 : 1,
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
