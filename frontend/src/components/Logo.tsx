import Link from "next/link";

interface LogoProps {
  size?: number;
  showText?: boolean;
  href?: string;
  className?: string;
}

/** A 3D tile holding a tiny graph: sways idly and flips on hover. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <span className="logo-3d inline-block" style={{ width: size, height: size }}>
      <span
        className="logo-3d-inner relative block h-full w-full rounded-[28%]"
        style={{
          background: "linear-gradient(145deg, #2a2f42 0%, #151823 60%, #0d1016 100%)",
          boxShadow:
            "0 6px 14px -4px rgba(232,163,61,0.55), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -2px 0 rgba(0,0,0,0.5)",
          border: "1px solid rgba(232,163,61,0.45)",
        }}
      >
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" style={{ transform: "translateZ(8px)" }} aria-hidden>
          <defs>
            <linearGradient id="gm-node" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffd08a" />
              <stop offset="100%" stopColor="#e8a33d" />
            </linearGradient>
          </defs>
          <g className="logo-orbit">
            <circle cx="20" cy="20" r="13" fill="none" stroke="#8b7cf6" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="2 3" />
            <circle cx="33" cy="20" r="1.6" fill="#8b7cf6" />
          </g>
          <line x1="13" y1="14" x2="27" y2="13" stroke="#e8a33d" strokeWidth="1.6" className="logo-pulse" />
          <line x1="13" y1="14" x2="18" y2="27" stroke="#3fc5b7" strokeWidth="1.6" />
          <line x1="27" y1="13" x2="18" y2="27" stroke="#8b7cf6" strokeWidth="1.6" />
          <circle cx="13" cy="14" r="3.6" fill="url(#gm-node)" />
          <circle cx="27" cy="13" r="3" fill="#8b7cf6" />
          <circle cx="18" cy="27" r="3.3" fill="#3fc5b7" />
        </svg>
      </span>
    </span>
  );
}

export default function Logo({ size = 34, showText = true, href = "/", className = "" }: LogoProps) {
  return (
    <Link href={href} className={`group flex items-center gap-2.5 ${className}`} aria-label="GraphMind home">
      <LogoMark size={size} />
      {showText && (
        <span className="text-shimmer text-lg font-bold tracking-tight" style={{ fontSize: size * 0.56 }}>
          GraphMind
        </span>
      )}
    </Link>
  );
}
