"use client";

/** Session price line (DESIGN §2.9): single silver line, area fill, pulsing end dot. Built from our own 10 s polling
 * because the Market candlestick endpoint doesn't work (IDEAS F10). Shows what it is: "this session". */
export function Sparkline({ points }: { points: number[] }) {
  const W = 320;
  const H = 72;
  if (points.length < 2) {
    return (
      <div
        className="flex h-[72px] items-center text-[14px] text-fg3"
        role="img"
        aria-label="Price line starts after two readings"
      >
        Price line builds as quotes refresh…
      </div>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 8 - ((v - min) / span) * (H - 16);
  const line = points
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last = points[points.length - 1]!;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[72px] w-full"
      role="img"
      aria-label="Price this session"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(232,235,239,.18)" />
          <stop offset="100%" stopColor="rgba(232,235,239,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--silver-1)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill="var(--silver-1)" />
    </svg>
  );
}
