"use client";

import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  type Plugin,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { Gauge, Sigma, Ruler, Activity } from "lucide-react";
import type { ComplexityResult } from "@/lib/types";
import TiltCard from "@/components/TiltCard";

ChartJS.register(LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Filler);

interface ComplexityChartProps {
  result: ComplexityResult | null;
}

const MODELS: { label: string; logFn: (n: number) => number; verdict: string; tone: string; example: string }[] = [
  { label: "O(1)", logFn: () => 0, verdict: "Excellent", tone: "#5fd68f", example: "array index, hash lookup" },
  { label: "O(log N)", logFn: (n) => Math.log10(Math.log2(Math.max(n, 2))), verdict: "Excellent", tone: "#5fd68f", example: "binary search" },
  { label: "O(N)", logFn: (n) => Math.log10(n), verdict: "Good", tone: "#3fc5b7", example: "single pass / linear search" },
  { label: "O(N log N)", logFn: (n) => Math.log10(n * Math.log2(Math.max(n, 2))), verdict: "Fair", tone: "#e8a33d", example: "merge sort, heap sort" },
  { label: "O(N^2)", logFn: (n) => 2 * Math.log10(n), verdict: "Slow", tone: "#f08a4b", example: "nested loops, bubble sort" },
  { label: "O(N^3)", logFn: (n) => 3 * Math.log10(n), verdict: "Very slow", tone: "#f04444", example: "triple loops, naive matrix multiply" },
  { label: "O(2^N)", logFn: (n) => n * Math.LOG10E * Math.LN2, verdict: "Explosive", tone: "#b81d3d", example: "naive recursion, all subsets" },
];

const EXPLANATIONS: Record<string, string> = {
  "O(1)": "Constant time — the work doesn't grow with input size. Doubling N changes nothing.",
  "O(log N)": "Logarithmic — the work grows very slowly. Doubling N adds only one extra step.",
  "O(N)": "Linear — the work grows in step with N. Doubling N doubles the work.",
  "O(N log N)": "Linearithmic — slightly faster than linear growth. Doubling N a bit more than doubles the work.",
  "O(N^2)": "Quadratic — doubling N makes the work about 4× bigger. Typical of a loop inside a loop.",
  "O(N^3)": "Cubic — doubling N makes the work about 8× bigger. Typical of three nested loops.",
  "O(2^N)": "Exponential — each extra element roughly multiplies the work. Typical of recursion that branches twice per call, like naive Fibonacci.",
};

const MEASURED = "#eef0f5";
const DETECTED = "#e8a33d";
const GUIDE = "#4a5068";
const INK_MUTED = "#8a90a6";

const pretty = (label: string) => label.replace("2^N", "2ᴺ").replace("^2", "²").replace("^3", "³");
const log10 = (v: number) => Math.log10(Math.max(v, 1e-9));

function logSpace(min: number, max: number, count: number): number[] {
  const a = Math.log10(min);
  const step = (Math.log10(max) - a) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.pow(10, a + i * step));
}

function formatCount(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

/** Writes each reference curve's name where it leaves the plot, so guides are identified without color. */
const directLabels: Plugin<"line"> = {
  id: "directLabels",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    const placed: number[] = [];
    ctx.save();
    ctx.font = "600 11px JetBrains Mono, ui-monospace, monospace";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      const custom = dataset as unknown as { guideLabel?: string; emphasis?: boolean };
      if (!custom.guideLabel || meta.hidden) return;
      let anchor: { x: number; y: number } | null = null;
      for (const point of meta.data) {
        if (point.y >= chartArea.top && point.y <= chartArea.bottom) anchor = { x: point.x, y: point.y };
      }
      if (!anchor) return;
      const y = Math.max(chartArea.top + 8, Math.min(chartArea.bottom - 8, anchor.y));
      if (placed.some((p) => Math.abs(p - y) < 13)) return;
      placed.push(y);
      const text = pretty(custom.guideLabel);
      const width = ctx.measureText(text).width;
      const x = Math.min(anchor.x + 6, chartArea.right - width - 4);
      ctx.fillStyle = "rgba(13,16,22,0.85)";
      ctx.fillRect(x - 3, y - 8, width + 6, 16);
      ctx.fillStyle = custom.emphasis ? "#eef0f5" : INK_MUTED;
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  },
};

/** Vertical crosshair under the hovered point. */
const crosshair: Plugin<"line"> = {
  id: "crosshair",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() ?? [];
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.strokeStyle = "rgba(238,240,245,0.25)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

export default function ComplexityChart({ result }: ComplexityChartProps) {
  const [scale, setScale] = useState<"logarithmic" | "linear">("logarithmic");
  const [focus, setFocus] = useState<string | null>(null);
  const [showGuides, setShowGuides] = useState(true);

  const analysis = useMemo(() => {
    if (!result?.supported || result.n_values.length === 0) return null;
    const ns = result.n_values;
    const ts = result.step_counts.map((t) => Math.max(t, 1));
    // Fit each model's constant in log space (geometric mean of T / f(N)) and measure how far it misses.
    const fits = MODELS.map((model) => {
      const logC = ns.reduce((sum, n, i) => sum + log10(ts[i]) - model.logFn(n), 0) / ns.length;
      const rms = Math.sqrt(ns.reduce((sum, n, i) => sum + (log10(ts[i]) - (model.logFn(n) + logC)) ** 2, 0) / ns.length);
      return { ...model, logC, factor: Math.pow(10, rms) };
    });
    // Empirical exponent: slope of log T against log N.
    const xs = ns.map(log10);
    const ys = ts.map(log10);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const exponent = den > 0 ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den : 0;
    return { ns, ts, fits, exponent };
  }, [result]);

  if (!result || !result.supported) {
    return (
      <EmptyState text={result?.message ?? "Run your code to measure how its work grows with input size."} />
    );
  }
  if (!analysis) {
    return <EmptyState text={result.error ?? "No benchmark data yet."} />;
  }

  const detected = result.estimated_big_o;
  const detectedModel = MODELS.find((m) => m.label === detected);
  const { ns, ts, fits, exponent } = analysis;
  const minN = Math.min(...ns);
  const maxN = Math.max(...ns);
  const minT = Math.min(...ts);
  const maxT = Math.max(...ts);
  const xs = logSpace(minN, maxN, 40);

  const guideDatasets = fits
    .filter((fit) => showGuides || fit.label === detected)
    .map((fit) => {
      const isDetected = fit.label === detected;
      const isFocused = focus === fit.label;
      return {
        label: pretty(fit.label),
        guideLabel: fit.label,
        emphasis: isDetected || isFocused,
        // Clamp far above the plot so exponential curves stay finite.
        data: xs.map((x) => ({ x, y: Math.pow(10, Math.min(fit.logC + fit.logFn(x), log10(maxT) + 6)) })),
        borderColor: isDetected ? DETECTED : isFocused ? "#c9cede" : GUIDE,
        borderWidth: isDetected ? 2.5 : isFocused ? 2 : 1.25,
        borderDash: isDetected ? [] : [5, 5],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.25,
        order: isDetected ? 1 : 2,
      };
    });

  const data = {
    datasets: [
      {
        label: "Measured T(N)",
        data: ns.map((n, i) => ({ x: n, y: ts[i] })),
        borderColor: MEASURED,
        borderWidth: 2,
        backgroundColor: (context: { chart: ChartJS }) => {
          const { ctx, chartArea } = context.chart;
          if (!chartArea) return "rgba(238,240,245,0.08)";
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, "rgba(232,163,61,0.22)");
          gradient.addColorStop(1, "rgba(232,163,61,0)");
          return gradient;
        },
        fill: "start" as const,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: MEASURED,
        pointBorderColor: "#0d1016",
        pointBorderWidth: 2,
        tension: 0.25,
        order: 0,
      },
      ...guideDatasets,
    ],
  };

  const isLog = scale === "logarithmic";
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false as const,
    animation: { duration: 700, easing: "easeOutQuart" as const },
    interaction: { mode: "nearest" as const, axis: "x" as const, intersect: false },
    layout: { padding: { right: 70, top: 8 } },
    scales: {
      x: {
        type: scale,
        min: minN,
        max: maxN,
        title: { display: true, text: "Input size N", color: INK_MUTED, font: { size: 11 } },
        ticks: { color: INK_MUTED, font: { size: 10 }, maxTicksLimit: 8, callback: (v: number | string) => formatCount(Number(v)) },
        grid: { color: "rgba(36,40,54,0.7)" },
        border: { color: "#333849" },
      },
      y: {
        type: scale,
        min: isLog ? minT / 3 : 0,
        max: isLog ? maxT * 3 : maxT * 1.25,
        title: { display: true, text: "Operations T(N)", color: INK_MUTED, font: { size: 11 } },
        ticks: { color: INK_MUTED, font: { size: 10 }, maxTicksLimit: 7, callback: (v: number | string) => formatCount(Number(v)) },
        grid: { color: "rgba(36,40,54,0.7)" },
        border: { color: "#333849" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (item: { datasetIndex: number }) => item.datasetIndex === 0,
        backgroundColor: "#191c26",
        borderColor: "#333849",
        borderWidth: 1,
        titleColor: "#eef0f5",
        bodyColor: "#c9cede",
        padding: 10,
        displayColors: false,
        callbacks: {
          title: (items: { parsed: { x: number } }[]) => `N = ${Math.round(items[0]?.parsed.x ?? 0).toLocaleString()}`,
          label: (ctx: { parsed: { y: number }; dataIndex: number }) => {
            const lines = [`${Math.round(ctx.parsed.y).toLocaleString()} operations`];
            if (ctx.dataIndex > 0) {
              const growth = ts[ctx.dataIndex] / ts[ctx.dataIndex - 1];
              const sizeGrowth = ns[ctx.dataIndex] / ns[ctx.dataIndex - 1];
              lines.push(`×${sizeGrowth.toFixed(1)} input → ×${growth.toFixed(1)} work`);
            }
            return lines;
          },
        },
      },
    },
  };

  const ranked = [...fits].sort((a, b) => a.factor - b.factor);
  const doubling = Math.pow(2, exponent);

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
        {/* Growth ladder — where the detected class sits */}
        <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-paper/45">Detected order of growth</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="font-mono text-4xl font-bold text-paper">{detected ? pretty(detected) : "Unknown"}</span>
                {detectedModel && (
                  <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold" style={{ borderColor: `${detectedModel.tone}66`, color: "#eef0f5" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: detectedModel.tone }} /> {detectedModel.verdict}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-paper/65">{detected ? EXPLANATIONS[detected] : "Not enough samples for a confident classification."}</p>
            </div>
            {result.message && <span className="rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-1.5 text-[11px] text-paper/55">{result.message} Operations = statements executed.</span>}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-1.5 md:grid-cols-7" role="list" aria-label="Growth classes from fastest to slowest">
            {MODELS.map((model) => {
              const isDetected = model.label === detected;
              return (
                <div
                  role="listitem"
                  key={model.label}
                  onMouseEnter={() => setFocus(model.label)}
                  onMouseLeave={() => setFocus(null)}
                  className={`relative cursor-default rounded-lg border px-3 py-2 transition ${isDetected ? "-translate-y-1 border-signal bg-signal/10 shadow-[0_10px_24px_-10px_rgba(232,163,61,0.7)]" : "border-ink-700 bg-ink-950/60 hover:border-ink-500"}`}
                >
                  <div className="h-1 rounded-full" style={{ background: model.tone, opacity: isDetected ? 1 : 0.45 }} />
                  <div className={`mt-2 font-mono text-sm font-semibold ${isDetected ? "text-paper" : "text-paper/70"}`}>{pretty(model.label)}</div>
                  <div className="text-[10px] text-paper/45">{model.verdict} · {model.example}</div>
                  {isDetected && <div className="absolute -top-2 right-2 rounded bg-signal px-1.5 text-[9px] font-bold uppercase text-ink-950">You</div>}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-paper/35"><span>← scales better</span><span>scales worse →</span></div>
        </section>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={Sigma} label="Empirical exponent" value={<>N<sup className="ml-0.5 text-base">{exponent.toFixed(2)}</sup></>} note="slope of log T vs log N" />
          <Stat icon={Activity} label="When N doubles" value={`×${doubling.toFixed(doubling < 10 ? 2 : 0)} work`} note="based on the fitted slope" />
          <Stat icon={Ruler} label="Input range" value={`${formatCount(minN)} – ${formatCount(maxN)}`} note={`${ns.length} benchmark samples`} />
          <Stat icon={Gauge} label="Peak operations" value={formatCount(maxT)} note={`at N = ${formatCount(maxN)}`} />
        </div>

        <div className="grid min-h-[460px] grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          {/* Chart */}
          <section className="flex min-h-[420px] flex-col rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div>
                <h3 className="text-sm font-semibold">Measured work vs. growth curves</h3>
                <div className="mt-1 flex flex-wrap items-center gap-4 text-[11px] text-paper/60">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-ink-950 bg-paper ring-1 ring-paper" /> Measured T(N)</span>
                  <span className="flex items-center gap-1.5"><span className="h-[3px] w-5 rounded bg-signal" /> Detected fit</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-paper/40" /> Other growth classes</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-paper/60">
                  <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} className="accent-[#e8a33d]" />
                  Show all curves
                </label>
                <div className="flex rounded-lg border border-ink-700 bg-ink-950 p-0.5 text-[11px]">
                  {(["logarithmic", "linear"] as const).map((s) => (
                    <button key={s} onClick={() => setScale(s)} className={`rounded-md px-2.5 py-1 font-medium transition ${scale === s ? "bg-ink-700 text-paper" : "text-paper/50 hover:text-paper/80"}`}>
                      {s === "logarithmic" ? "Log scale" : "Linear"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Line data={data as any} options={options as any} plugins={[directLabels, crosshair]} />
            </div>
            {result.error && <p className="pt-2 text-xs text-node-condition">{result.error}</p>}
            <p className="pt-2 text-[11px] text-paper/40">
              {isLog ? "Log scale: each growth class appears as a straight line with a different slope — the steeper the line, the worse it scales." : "Linear scale: shows the real gap between curves as N grows."}
            </p>
          </section>

          {/* Side panel */}
          <div className="flex flex-col gap-4" data-mascot-avoid>
            <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-paper/45">How well each curve fits</h3>
              <p className="mt-1 text-[11px] text-paper/45">Typical miss between the curve and your measurements. Closer to ×1.00 is a better fit. Hover to highlight.</p>
              <ul className="mt-3 space-y-1.5">
                {ranked.map((fit) => {
                  const isDetected = fit.label === detected;
                  const closeness = Math.max(0.04, 1 - Math.min(1, Math.log10(fit.factor)));
                  return (
                    <li
                      key={fit.label}
                      onMouseEnter={() => setFocus(fit.label)}
                      onMouseLeave={() => setFocus(null)}
                      className={`rounded-md px-2 py-1.5 transition ${focus === fit.label ? "bg-ink-800" : ""}`}
                    >
                      <div className="flex items-center justify-between font-mono text-xs">
                        <span className={isDetected ? "font-semibold text-paper" : "text-paper/70"}>{pretty(fit.label)}{isDetected && <span className="ml-1.5 text-[10px] text-signal">detected</span>}</span>
                        <span className="text-paper/55">×{fit.factor.toFixed(2)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-ink-800">
                        <div className="h-full rounded-full transition-all" style={{ width: `${closeness * 100}%`, background: isDetected ? DETECTED : "#6b7190" }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-paper/45">Raw samples</h3>
              <table className="mt-2 w-full font-mono text-xs">
                <thead>
                  <tr className="text-paper/40">
                    <th className="pb-1 text-left font-medium">N</th>
                    <th className="pb-1 text-right font-medium">T(N)</th>
                    <th className="pb-1 text-right font-medium">growth</th>
                  </tr>
                </thead>
                <tbody>
                  {ns.map((n, i) => (
                    <tr key={n} className="border-t border-ink-700/60">
                      <td className="py-1 text-paper/80">{n.toLocaleString()}</td>
                      <td className="py-1 text-right text-paper/80">{result.step_counts[i].toLocaleString()}</td>
                      <td className="py-1 text-right text-paper/45">{i === 0 ? "—" : `×${(ts[i] / ts[i - 1]).toFixed(1)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, note }: { icon: typeof Sigma; label: string; value: React.ReactNode; note: string }) {
  return (
    <TiltCard max={6} className="border border-ink-700 bg-ink-900/60 p-4">
      <div className="tilt-lift">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-paper/45"><Icon className="h-3.5 w-3.5 text-signal" /> {label}</div>
        <div className="mt-1.5 font-mono text-2xl font-bold text-paper">{value}</div>
        <div className="mt-0.5 text-[11px] text-paper/45">{note}</div>
      </div>
    </TiltCard>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <svg viewBox="0 0 120 80" className="w-40 opacity-60" aria-hidden>
        <path d="M10 70 H112 M10 70 V8" stroke="#333849" strokeWidth="1.5" fill="none" />
        <path d="M10 66 L112 62" stroke="#4a5068" strokeDasharray="4 4" fill="none" />
        <path d="M10 68 Q 70 60 112 28" stroke="#4a5068" strokeDasharray="4 4" fill="none" />
        <path d="M10 69 Q 80 64 112 8" stroke="#e8a33d" strokeWidth="2" fill="none" className="dash-flow" />
      </svg>
      <p className="max-w-sm text-sm text-paper/50">{text}</p>
    </div>
  );
}
