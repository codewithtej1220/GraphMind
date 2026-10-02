import Link from "next/link";
import { Activity, ArrowRight, BookOpen, FolderGit2, GitBranch, Languages, LineChart, Play, Sparkles } from "lucide-react";
import Logo from "@/components/Logo";
import TiltCard from "@/components/TiltCard";
import CodeBackdrop from "@/components/CodeBackdrop";
import Mascot from "@/components/Mascot";

const FEATURES = [
  { icon: Activity, color: "#3fc5b7", title: "Step-by-step execution", text: "Play your program line by line. Watch variables change, arrays swap and the call stack grow and unwind." },
  { icon: GitBranch, color: "#8b7cf6", title: "Structure graph", text: "Your code as a clean tree of functions, loops and branches — with call links you can trace in one click." },
  { icon: LineChart, color: "#e8a33d", title: "Big-O benchmark", text: "GraphMind runs your code at growing input sizes and fits the curve to tell you how it really scales." },
  { icon: BookOpen, color: "#f0648c", title: "Algorithm reference", text: "Sorting, searching, graphs, DP and more — ready-made examples to study or open straight in the editor." },
  { icon: Languages, color: "#5b9ee8", title: "8 languages, fully traced", text: "Step through, graph and benchmark Python, JavaScript, TypeScript, C, C++, Java, Go and R." },
  { icon: FolderGit2, color: "#5fd68f", title: "GitHub import & sessions", text: "Pull a file from any public repository, then save and revisit your analyses." },
];

const STEPS = [
  { title: "Write or pick code", text: "Type in the editor or choose an algorithm from the reference bar." },
  { title: "Run & Visualize", text: "One click traces execution, parses structure and benchmarks growth." },
  { title: "Understand it", text: "Step through memory, read the graph and see your Big-O — side by side." },
];

const CODE_LINES: [string, string][] = [
  ["def", " bubble_sort(arr):"],
  ["    n", " = len(arr)"],
  ["    for", " i in range(n):"],
  ["        for", " j in range(n - i - 1):"],
  ["            if", " arr[j] > arr[j + 1]:"],
  ["              arr[j], arr[j+1]", " = arr[j+1], arr[j]"],
  ["    return", " arr"],
];

function HeroPreview() {
  const bars = [5, 2, 8, 1, 9, 3];
  return (
    <TiltCard max={10} className="w-full max-w-[560px] border border-ink-600/80 bg-ink-900/80 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(232,163,61,0.06)] backdrop-blur-xl">
      <div className="flex items-center gap-1.5 border-b border-ink-700 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f0648c]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-signal/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-node-return/80" />
        <span className="ml-3 font-mono text-[11px] text-paper/40">bubble_sort.py</span>
      </div>
      <div className="tilt-lift grid grid-cols-[1.5fr_1fr] gap-0">
        <pre className="border-r border-ink-700 overflow-hidden p-4 font-mono text-[11px] leading-6">
          {CODE_LINES.map(([kw, rest], i) => (
            <div key={i} className={`-mx-2 rounded px-2 ${i === 4 ? "bg-signal/10 ring-1 ring-signal/30" : ""}`}>
              <span className="text-node-function">{kw}</span>
              <span className="text-paper/75">{rest}</span>
            </div>
          ))}
        </pre>
        <div className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-paper/40">Memory · step 14</div>
            <div className="mt-2 flex items-end gap-1.5">
              {bars.map((v, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    className="w-6 rounded-t-md"
                    style={{
                      height: v * 7 + 8,
                      background: i === 2 || i === 3 ? "linear-gradient(180deg,#f0648c,#a53a5a)" : "linear-gradient(180deg,#3a3f58,#232739)",
                      boxShadow: i === 2 || i === 3 ? "0 0 14px -2px rgba(240,100,140,0.7)" : undefined,
                    }}
                  />
                  <span className="font-mono text-[10px] text-paper/60">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 font-mono text-[10px] text-node-condition">COMPARE arr[2] &gt; arr[3]</div>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-950/70 p-2">
            <div className="flex items-center justify-between text-[10px] text-paper/40"><span>Big-O</span><span className="font-mono font-bold text-signal">O(N²)</span></div>
            <svg viewBox="0 0 160 60" className="mt-1 w-full" aria-hidden>
              <path d="M4 56 L156 52" stroke="#4a5068" strokeDasharray="3 3" fill="none" />
              <path d="M4 56 Q 90 50 156 30" stroke="#4a5068" strokeDasharray="3 3" fill="none" />
              <path d="M4 57 Q 110 52 156 6" stroke="#e8a33d" strokeWidth="2" fill="none" />
              {[[20, 56], [60, 52], [100, 42], [140, 18]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.8" fill="#eef0f5" />)}
            </svg>
          </div>
        </div>
      </div>
    </TiltCard>
  );
}

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-ink-950 text-paper">
      <div className="absolute inset-0 h-[100vh] min-h-[720px]">
        <CodeBackdrop />
      </div>

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Logo size={36} />
        <nav className="flex items-center gap-2 text-sm">
          <a href="#features" className="hidden rounded-lg px-3 py-1.5 text-paper/60 transition hover:text-paper sm:block">Features</a>
          <a href="#how" className="hidden rounded-lg px-3 py-1.5 text-paper/60 transition hover:text-paper sm:block">How it works</a>
          <Link href="/studio" className="btn-ghost-3d flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900/80 px-3.5 py-1.5 text-paper/90">
            Open Studio <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-24 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 text-xs font-medium text-signal">
              <Sparkles className="h-3.5 w-3.5" /> Interactive code visualizer
            </span>
            <h1 className="mt-5 text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              <span className="text-shimmer">GraphMind</span>
              <span className="mt-3 block text-3xl font-semibold text-paper/90 sm:text-4xl lg:text-[2.6rem]">See how your code thinks.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-paper/60">
              Paste a program and watch it run step by step, explore its structure as a graph, and measure its real-world
              Big-O complexity — all in one place. Built for students, interview prep and anyone who wants to
              <span className="text-paper/85"> understand</span> code, not just run it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/studio" className="btn-3d flex items-center gap-2 rounded-xl bg-signal px-6 py-3 text-base font-semibold text-ink-950">
                <Play className="h-4 w-4" /> Launch the Studio
              </Link>
              <a href="#how" className="btn-ghost-3d flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-900/70 px-6 py-3 text-base text-paper/85 backdrop-blur">
                How it works
              </a>
            </div>
            <dl className="mt-10 flex flex-wrap gap-8 text-sm">
              {[["8", "languages"], ["4", "linked views"], ["16", "reference algorithms"]].map(([n, l]) => (
                <div key={l}>
                  <dt className="font-mono text-2xl font-bold text-paper">{n}</dt>
                  <dd className="text-paper/45">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroPreview />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-7xl scroll-mt-10 px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything you need to understand an algorithm</h2>
            <p className="mt-3 text-paper/55">Four connected views turn a block of code into something you can see, step through and measure.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, color, title, text }) => (
              <TiltCard key={title} className="border border-ink-700 bg-ink-900/70 p-6">
                <div className="tilt-lift">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{ background: `linear-gradient(145deg, ${color}33, ${color}0d)`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 8px 18px -8px ${color}`, border: `1px solid ${color}55` }}
                  >
                    <Icon className="h-5 w-5" style={{ color }} />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-paper/55">{text}</p>
                </div>
              </TiltCard>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-7xl scroll-mt-10 px-6 py-20">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
          <ol className="relative mt-10 grid gap-5 md:grid-cols-3">
            <div className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-signal/40 to-transparent md:block" aria-hidden />
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative">
                <TiltCard className="border border-ink-700 bg-ink-900/70 p-6">
                  <div className="tilt-lift">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd08a] to-signal font-mono text-sm font-bold text-ink-950 shadow-[0_6px_18px_-4px_rgba(232,163,61,0.8)]">{i + 1}</span>
                    <h3 className="mt-4 font-semibold">{step.title}</h3>
                    <p className="mt-1.5 text-sm text-paper/55">{step.text}</p>
                  </div>
                </TiltCard>
              </li>
            ))}
          </ol>

          <div className="mt-16 overflow-hidden rounded-3xl border border-ink-700 bg-gradient-to-br from-node-function/15 via-ink-900 to-signal/10 p-10 text-center">
            <h3 className="text-2xl font-bold sm:text-3xl">Ready to watch your code run?</h3>
            <p className="mx-auto mt-2 max-w-lg text-paper/55">No sign-up. Open the Studio, pick an example and press Run.</p>
            <Link href="/studio" className="btn-3d mx-auto mt-6 inline-flex items-center gap-2 rounded-xl bg-signal px-6 py-3 font-semibold text-ink-950">
              Open the Studio <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-ink-800 px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-xs text-paper/40">
          <Logo size={24} />
          <span>GraphMind — interactive code inspection &amp; execution visualizer</span>
        </div>
      </footer>

      <Mascot mode="home" />
    </div>
  );
}
