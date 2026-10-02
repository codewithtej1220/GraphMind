/** Faint, slowly drifting code, variables, operators and graphs behind the home page. */

const SNIPPETS: { text: string; x: number; y: number; size: number; opacity: number; duration: number; color: string }[] = [
  { text: "def bubble_sort(arr):", x: 4, y: 8, size: 15, opacity: 0.3, duration: 26, color: "#8b7cf6" },
  { text: "for i in range(n):", x: 62, y: 6, size: 14, opacity: 0.27, duration: 30, color: "#e8a33d" },
  { text: "arr[j], arr[j+1] = arr[j+1], arr[j]", x: 54, y: 30, size: 13, opacity: 0.23, duration: 34, color: "#eef0f5" },
  { text: "while low <= high:", x: 8, y: 36, size: 14, opacity: 0.25, duration: 28, color: "#e8a33d" },
  { text: "mid = (low + high) // 2", x: 14, y: 44, size: 13, opacity: 0.23, duration: 32, color: "#3fc5b7" },
  { text: "O(N log N)", x: 80, y: 46, size: 22, opacity: 0.23, duration: 24, color: "#8b7cf6" },
  { text: "T(N) = 2T(N/2) + N", x: 66, y: 64, size: 15, opacity: 0.23, duration: 36, color: "#eef0f5" },
  { text: "if arr[mid] == target:", x: 3, y: 70, size: 14, opacity: 0.23, duration: 29, color: "#f0648c" },
  { text: "return memo[n]", x: 30, y: 84, size: 13, opacity: 0.23, duration: 31, color: "#5fd68f" },
  { text: "queue.append(neighbor)", x: 58, y: 88, size: 13, opacity: 0.23, duration: 27, color: "#5b9ee8" },
  { text: "x += 1", x: 42, y: 20, size: 16, opacity: 0.19, duration: 22, color: "#3fc5b7" },
  { text: "Σ", x: 90, y: 18, size: 30, opacity: 0.19, duration: 25, color: "#e8a33d" },
  { text: "≤", x: 36, y: 60, size: 26, opacity: 0.17, duration: 23, color: "#8b7cf6" },
  { text: "→", x: 84, y: 78, size: 26, opacity: 0.17, duration: 21, color: "#eef0f5" },
  { text: "λ", x: 22, y: 24, size: 26, opacity: 0.17, duration: 27, color: "#5b9ee8" },
  { text: "O(1)", x: 46, y: 74, size: 18, opacity: 0.19, duration: 33, color: "#5fd68f" },
  { text: "n = len(arr)", x: 74, y: 14, size: 13, opacity: 0.21, duration: 35, color: "#eef0f5" },
];

function MiniGraph({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 200 140" className={className} style={style} aria-hidden>
      <g stroke="#8b7cf6" strokeWidth="1.2" fill="none">
        <line x1="30" y1="30" x2="100" y2="22" className="dash-flow" />
        <line x1="30" y1="30" x2="60" y2="100" />
        <line x1="100" y1="22" x2="160" y2="70" className="dash-flow" />
        <line x1="60" y1="100" x2="160" y2="70" />
        <line x1="100" y1="22" x2="60" y2="100" />
        <line x1="160" y1="70" x2="130" y2="125" />
      </g>
      <circle cx="30" cy="30" r="7" fill="#e8a33d" />
      <circle cx="100" cy="22" r="6" fill="#8b7cf6" />
      <circle cx="60" cy="100" r="6" fill="#3fc5b7" />
      <circle cx="160" cy="70" r="7" fill="#5b9ee8" />
      <circle cx="130" cy="125" r="5" fill="#f0648c" />
    </svg>
  );
}

function MiniCurves({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 200 140" className={className} style={style} aria-hidden>
      <g fill="none" strokeWidth="1.6">
        <path d="M10 130 L190 130" stroke="#4a5068" />
        <path d="M10 130 L10 10" stroke="#4a5068" />
        <path d="M10 120 L190 112" stroke="#5fd68f" />
        <path d="M10 125 Q 100 110 190 60" stroke="#3fc5b7" />
        <path d="M10 128 Q 120 120 190 15" stroke="#f0648c" className="dash-flow" />
      </g>
    </svg>
  );
}

export default function CodeBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Glow pools */}
      <div className="absolute -left-40 top-10 h-[480px] w-[480px] rounded-full bg-node-function/20 blur-[120px]" />
      <div className="absolute -right-32 top-1/3 h-[420px] w-[420px] rounded-full bg-signal/15 blur-[120px]" />
      <div className="absolute bottom-0 left-1/3 h-[360px] w-[360px] rounded-full bg-node-variable/10 blur-[120px]" />

      {/* Receding grid floor */}
      <div className="grid-floor absolute inset-x-[-20%] bottom-[-10%] h-[55%]" />

      <div className="backdrop-mist absolute inset-0">
        {SNIPPETS.map((s, i) => (
          <span
            key={i}
            className="backdrop-drift absolute whitespace-nowrap font-mono"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              fontSize: s.size,
              opacity: s.opacity,
              color: s.color,
              filter: i % 3 === 0 ? "blur(1.2px)" : "blur(0.4px)",
              animationDuration: `${s.duration}s`,
              animationDelay: `${-i * 2.3}s`,
            }}
          >
            {s.text}
          </span>
        ))}
        <MiniGraph className="backdrop-drift absolute" style={{ left: "70%", top: "22%", width: 220, opacity: 0.25, filter: "blur(0.6px)", animationDuration: "30s" }} />
        <MiniGraph className="backdrop-drift absolute" style={{ left: "6%", top: "52%", width: 160, opacity: 0.18, filter: "blur(1.4px)", animationDuration: "38s", animationDelay: "-9s" }} />
        <MiniCurves className="backdrop-drift absolute" style={{ left: "28%", top: "4%", width: 200, opacity: 0.18, filter: "blur(1px)", animationDuration: "34s", animationDelay: "-4s" }} />
        <MiniCurves className="backdrop-drift absolute" style={{ left: "76%", top: "70%", width: 170, opacity: 0.18, filter: "blur(1.2px)", animationDuration: "28s", animationDelay: "-14s" }} />
      </div>

      {/* Vignette so the foreground stays readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#0d1016_85%)]" />
    </div>
  );
}
