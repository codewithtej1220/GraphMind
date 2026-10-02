"use client";

import { memo, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeMouseHandler,
  NodeProps,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Box,
  Braces,
  CornerDownLeft,
  FileCode2,
  GitFork,
  Import,
  PhoneOutgoing,
  Repeat,
  SquareFunction,
  Variable,
  X,
  type LucideIcon,
} from "lucide-react";
import type { GraphEdge, GraphNode, NodeCategory } from "@/lib/types";

const CATEGORY: Record<NodeCategory, { color: string; name: string; icon: LucideIcon }> = {
  module: { color: "#9aa2b8", name: "Program", icon: FileCode2 },
  class: { color: "#e0857a", name: "Class", icon: Box },
  function: { color: "#8b7cf6", name: "Function", icon: SquareFunction },
  loop: { color: "#e8a33d", name: "Loop", icon: Repeat },
  condition: { color: "#f0648c", name: "Branch", icon: GitFork },
  variable: { color: "#3fc5b7", name: "Assign", icon: Variable },
  call: { color: "#5b9ee8", name: "Call", icon: PhoneOutgoing },
  return: { color: "#5fd68f", name: "Return", icon: CornerDownLeft },
  import: { color: "#9aa2b8", name: "Import", icon: Import },
};

/** Categories hidden in the concise view; their structure is folded into the nearest visible ancestor. */
const DETAIL_ONLY: NodeCategory[] = ["variable", "call"];

const COL_W = 280;
const ROW_H = 66;
const NODE_W = 236;

interface FlowCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeLine: number | null;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Text up to the first ':' or '{' outside brackets — the "header" of a statement. */
function header(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ("([".includes(ch)) depth++;
    else if (")]".includes(ch)) depth--;
    else if (depth === 0 && (ch === ":" || ch === "{")) return text.slice(0, i).trim();
  }
  return text.trim();
}

/** Turn the raw source snippet the parser sends into a short, readable label. */
function conciseLabel(node: GraphNode): string {
  const raw = node.label;
  switch (node.category) {
    case "module":
      return "Entry point";
    case "function": {
      const match = raw.match(/([A-Za-z_]\w*)\s*\(([^)]*)\)/);
      if (!match) return "anonymous fn";
      const params = match[2].split(",").map((p) => p.trim().split(/[\s:=]+/).filter(Boolean).pop() ?? "").filter(Boolean);
      return `${match[1]}(${clip(params.join(", "), 18)})`;
    }
    case "class": {
      const match = raw.match(/\b(class|struct|interface)\s+([A-Za-z_]\w*)/);
      return match ? `${match[1]} ${match[2]}` : clip(header(raw), 28);
    }
    case "call": {
      const match = raw.match(/([\w.]+)\s*\(/);
      return match ? `${clip(match[1], 24)}()` : clip(raw, 28);
    }
    case "loop":
    case "condition":
    case "return":
      return clip(header(raw).replace(/\s+/g, " "), 30) || node.category;
    default:
      return clip(raw, 30);
  }
}

interface CodeNodeData {
  label: string;
  full: string;
  category: NodeCategory;
  lines: string;
  state: "idle" | "active" | "selected" | "related" | "dimmed";
  recursive: boolean;
}

const CodeNode = memo(function CodeNode({ data }: NodeProps<CodeNodeData>) {
  const meta = CATEGORY[data.category] ?? CATEGORY.module;
  const Icon = meta.icon;
  const lifted = data.state === "selected" || data.state === "active";
  return (
    <div
      title={data.full}
      className="group relative rounded-xl transition-all duration-200"
      style={{
        width: NODE_W,
        opacity: data.state === "dimmed" ? 0.28 : 1,
        transform: lifted ? "translateY(-2px)" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0" style={{ background: meta.color }} />
      <div
        className="overflow-hidden rounded-xl border bg-[#151821]"
        style={{
          borderColor: data.state === "idle" || data.state === "dimmed" ? "#2a2f40" : meta.color,
          boxShadow:
            data.state === "selected"
              ? `0 0 0 2px ${meta.color}, 0 12px 28px -8px ${meta.color}99`
              : data.state === "active"
                ? `0 0 0 1.5px ${meta.color}, 0 0 22px -4px ${meta.color}`
                : data.state === "related"
                  ? `0 8px 18px -10px ${meta.color}`
                  : "0 4px 0 0 rgba(0,0,0,0.35), 0 8px 16px -10px rgba(0,0,0,0.8)",
        }}
      >
        <div className="flex">
          <div className="w-1 shrink-0" style={{ background: meta.color }} />
          <div className="min-w-0 flex-1 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: meta.color }}>
                <Icon className="h-3 w-3" /> {meta.name}
                {data.recursive && <span className="ml-1 rounded bg-node-condition/20 px-1 text-[8px] text-node-condition">recursive</span>}
              </span>
              <span className="font-mono text-[9px] text-paper/35">{data.lines}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[12px] font-medium text-paper">{data.label}</div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0" style={{ background: meta.color }} />
    </div>
  );
});

const NODE_TYPES = { code: CodeNode };

export default function FlowCanvas({ nodes, edges, activeLine }: FlowCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailed, setDetailed] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<Set<NodeCategory>>(new Set());

  // Visible nodes, their tree parents, and call links after folding hidden categories away.
  const model = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const parentOf = new Map<string, string>();
    for (const e of edges) if (e.type === "child" || e.type === "import") parentOf.set(e.target, e.source);

    const isVisible = (n: GraphNode) =>
      n.category === "module" || (!hiddenCategories.has(n.category) && (detailed || !DETAIL_ONLY.includes(n.category)));
    const visible = nodes.filter(isVisible);
    const visibleIds = new Set(visible.map((n) => n.id));
    const visibleAncestor = (id: string): string | null => {
      let current = parentOf.get(id);
      const seen = new Set<string>();
      while (current && !visibleIds.has(current) && !seen.has(current)) {
        seen.add(current);
        current = parentOf.get(current);
      }
      return current && visibleIds.has(current) ? current : null;
    };

    const treeParent = new Map<string, string>();
    for (const n of visible) {
      const p = visibleAncestor(n.id);
      if (p) treeParent.set(n.id, p);
    }

    // Call edges: call node -> declaration. Fold the source to a visible node.
    const calls = new Map<string, { source: string; target: string }>();
    const recursive = new Set<string>();
    for (const e of edges) {
      if (e.type !== "call") continue;
      const source = visibleIds.has(e.source) ? e.source : visibleAncestor(e.source);
      if (!source || !visibleIds.has(e.target)) continue;
      // Is the call made from inside the function it calls?
      let owner: string | undefined = e.source;
      while (owner && owner !== e.target) owner = parentOf.get(owner);
      if (owner === e.target) {
        recursive.add(e.target);
        if (source === e.target) continue;
      }
      calls.set(`${source}->${e.target}`, { source, target: e.target });
    }

    return { byId, visible, treeParent, calls: [...calls.values()], recursive };
  }, [nodes, edges, detailed, hiddenCategories]);

  // Tidy left-to-right tree: depth along x, source order along y, parents centred on their children.
  const positions = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const [child, parent] of model.treeParent) {
      const list = children.get(parent) ?? [];
      list.push(child);
      children.set(parent, list);
    }
    const startOf = (id: string) => model.byId.get(id)?.startLine ?? 0;
    for (const list of children.values()) list.sort((a, b) => startOf(a) - startOf(b));

    const pos = new Map<string, { x: number; y: number }>();
    let row = 0;
    const place = (id: string, depth: number): number => {
      if (pos.has(id)) return pos.get(id)!.y;
      pos.set(id, { x: depth * COL_W, y: 0 });
      const kids = (children.get(id) ?? []).filter((k) => !pos.has(k));
      let y: number;
      if (kids.length === 0) {
        y = row * ROW_H;
        row++;
      } else {
        const ys = kids.map((k) => place(k, depth + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      pos.set(id, { x: depth * COL_W, y });
      return y;
    };
    for (const n of model.visible) if (!model.treeParent.has(n.id)) place(n.id, 0);
    return { pos, children };
  }, [model]);

  // Upstream / downstream along call edges from the selection.
  const related = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    if (!selectedId) return { nodeIds, edgeIds };
    const walk = (forward: boolean) => {
      const queue = [selectedId];
      const seen = new Set(queue);
      while (queue.length) {
        const current = queue.shift()!;
        for (const c of model.calls) {
          const from = forward ? c.source : c.target;
          const to = forward ? c.target : c.source;
          if (from !== current) continue;
          edgeIds.add(`call:${c.source}->${c.target}`);
          if (!seen.has(to)) { seen.add(to); nodeIds.add(to); queue.push(to); }
        }
      }
    };
    walk(true);
    walk(false);
    // Also light up the selection's own subtree path to the root.
    let p = model.treeParent.get(selectedId);
    while (p) { nodeIds.add(p); p = model.treeParent.get(p); }
    return { nodeIds, edgeIds };
  }, [selectedId, model]);

  const flowNodes: Node<CodeNodeData>[] = useMemo(
    () =>
      model.visible.map((n) => {
        const isActive = activeLine !== null && n.category !== "module" && n.startLine <= activeLine && activeLine <= n.endLine;
        const state: CodeNodeData["state"] =
          selectedId === n.id ? "selected" : related.nodeIds.has(n.id) ? "related" : selectedId ? "dimmed" : isActive ? "active" : "idle";
        return {
          id: n.id,
          type: "code",
          position: positions.pos.get(n.id) ?? { x: 0, y: 0 },
          data: {
            label: conciseLabel(n),
            full: n.label,
            category: n.category,
            lines: n.startLine === n.endLine ? `L${n.startLine}` : `L${n.startLine}–${n.endLine}`,
            state,
            recursive: model.recursive.has(n.id),
          },
        };
      }),
    [model, positions, activeLine, selectedId, related]
  );

  const flowEdges: Edge[] = useMemo(() => {
    // A call that duplicates a tree edge (e.g. the program calling a top-level function) is drawn once, as a call.
    const callPairs = new Set(model.calls.map((c) => `${c.source}->${c.target}`));
    const tree: Edge[] = [...model.treeParent].filter(([child, parent]) => !callPairs.has(`${parent}->${child}`)).map(([child, parent]) => {
      const color = CATEGORY[model.byId.get(child)?.category ?? "module"].color;
      const lit = selectedId !== null && (child === selectedId || related.nodeIds.has(child)) && (parent === selectedId || related.nodeIds.has(parent));
      return {
        id: `tree:${parent}->${child}`,
        source: parent,
        target: child,
        type: "smoothstep",
        style: { stroke: lit ? color : "#2f3446", strokeWidth: lit ? 2 : 1.25, opacity: selectedId && !lit ? 0.35 : 1 },
      };
    });
    const calls: Edge[] = model.calls.map((c) => {
      const id = `call:${c.source}->${c.target}`;
      const lit = related.edgeIds.has(id);
      return {
        id,
        source: c.source,
        target: c.target,
        type: "default",
        label: "calls",
        animated: true,
        labelStyle: { fill: lit ? "#e8a33d" : "#5b9ee8", fontSize: 10, fontWeight: 600 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: { stroke: lit ? "#e8a33d" : "#5b9ee8", strokeWidth: lit ? 2.5 : 1.5, strokeDasharray: "6 4", opacity: selectedId && !lit ? 0.25 : 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color: lit ? "#e8a33d" : "#5b9ee8", width: 16, height: 16 },
        zIndex: 5,
      };
    });
    return [...tree, ...calls];
  }, [model, selectedId, related]);

  const counts = useMemo(() => {
    const c = new Map<NodeCategory, number>();
    for (const n of nodes) c.set(n.category, (c.get(n.category) ?? 0) + 1);
    return c;
  }, [nodes]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => setSelectedId((cur) => (cur === node.id ? null : node.id));

  if (nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <svg viewBox="0 0 160 90" className="w-44 opacity-60" aria-hidden>
          <g stroke="#333849" strokeWidth="1.5" fill="none">
            <path d="M40 45 C 60 45, 60 20, 80 20" /><path d="M40 45 C 60 45, 60 70, 80 70" /><path d="M110 70 C 120 70, 120 70, 125 70" className="dash-flow" />
          </g>
          <rect x="8" y="35" width="32" height="20" rx="5" fill="#191c26" stroke="#9aa2b8" />
          <rect x="80" y="10" width="40" height="20" rx="5" fill="#191c26" stroke="#8b7cf6" />
          <rect x="80" y="60" width="30" height="20" rx="5" fill="#191c26" stroke="#e8a33d" />
          <rect x="125" y="60" width="30" height="20" rx="5" fill="#191c26" stroke="#5fd68f" />
        </svg>
        <p className="text-sm text-paper/50">Run your code to see its structure here.</p>
      </div>
    );
  }

  const selected = selectedId ? model.byId.get(selectedId) : null;
  const callsOut = selectedId ? model.calls.filter((c) => c.source === selectedId).map((c) => model.byId.get(c.target)) : [];
  const callsIn = selectedId ? model.calls.filter((c) => c.target === selectedId).map((c) => model.byId.get(c.source)) : [];
  const legendCategories = (Object.keys(CATEGORY) as NodeCategory[]).filter((c) => c !== "module" && counts.get(c));

  const toggleCategory = (cat: NodeCategory) =>
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  return (
    <div className="relative h-full">
      <ReactFlow
        key={detailed ? "detailed" : "concise"}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onPaneClick={() => setSelectedId(null)}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        className="bg-ink-950"
      >
        <Background variant={BackgroundVariant.Dots} color="#2a2f40" gap={22} size={1.4} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          maskColor="rgba(13,16,22,0.75)"
          nodeColor={(n) => CATEGORY[(n.data as CodeNodeData).category]?.color ?? "#4a5068"}
          nodeBorderRadius={6}
          style={{ marginRight: 120 }}
        />
      </ReactFlow>

      {/* Toolbar: view mode + legend that doubles as a filter */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-900/90 p-1 shadow-lg backdrop-blur">
          {([false, true] as const).map((mode) => (
            <button
              key={String(mode)}
              onClick={() => setDetailed(mode)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${detailed === mode ? "bg-ink-700 text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-paper/50 hover:text-paper/80"}`}
            >
              {mode ? "Detailed" : "Concise"}
            </button>
          ))}
          <span className="px-2 text-[11px] text-paper/40">{detailed ? "every statement" : "functions, loops & branches"}</span>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-ink-700 bg-ink-900/90 p-1.5 shadow-lg backdrop-blur" aria-label="Legend — click to show or hide a kind">
          {legendCategories.map((cat) => {
            const meta = CATEGORY[cat];
            const Icon = meta.icon;
            const off = hiddenCategories.has(cat) || (!detailed && DETAIL_ONLY.includes(cat));
            return (
              <button
                key={cat}
                onClick={() => (!detailed && DETAIL_ONLY.includes(cat) ? setDetailed(true) : toggleCategory(cat))}
                title={off ? `Show ${meta.name.toLowerCase()} nodes` : `Hide ${meta.name.toLowerCase()} nodes`}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition hover:bg-ink-800 ${off ? "text-paper/30 line-through" : "text-paper/75"}`}
              >
                <Icon className="h-3 w-3" style={{ color: off ? undefined : meta.color }} />
                {meta.name}
                <span className="font-mono text-[10px] text-paper/35">{counts.get(cat)}</span>
              </button>
            );
          })}
          <span className="ml-1 flex items-center gap-1 border-l border-ink-700 pl-2 text-[11px] text-paper/60">
            <span className="w-4 border-t-2 border-dashed border-node-call" /> calls
          </span>
        </div>
      </div>

      {/* Inspector */}
      {selected && (
        <aside data-mascot-avoid className="absolute bottom-3 left-14 z-10 w-[300px] rounded-xl border border-ink-600 bg-ink-900/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: CATEGORY[selected.category].color }}>
                {CATEGORY[selected.category].name} · lines {selected.startLine}–{selected.endLine}
              </div>
              <div className="mt-0.5 truncate font-mono text-sm font-semibold">{conciseLabel(selected)}</div>
            </div>
            <button onClick={() => setSelectedId(null)} aria-label="Clear selection" className="rounded p-0.5 text-paper/50 hover:bg-ink-800 hover:text-paper"><X className="h-4 w-4" /></button>
          </div>
          <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap rounded-md bg-ink-950 p-2 font-mono text-[11px] text-paper/65">{selected.label}</pre>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-paper/40">Calls</dt><dd className="font-mono text-paper/80">{callsOut.length ? callsOut.map((n) => n && conciseLabel(n)).join(", ") : "—"}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-paper/40">Called by</dt><dd className="font-mono text-paper/80">{callsIn.length ? callsIn.map((n) => n && conciseLabel(n)).join(", ") : "—"}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-paper/40">Contains</dt><dd className="text-paper/80">{positions.children.get(selected.id)?.length ?? 0} block(s)</dd></div>
          </dl>
          {model.recursive.has(selected.id) && <p className="mt-2 text-[11px] text-node-condition"><Braces className="mr-1 inline h-3 w-3" />This function calls itself.</p>}
        </aside>
      )}
    </div>
  );
}
