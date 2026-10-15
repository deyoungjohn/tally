"use client";

/** Session price line (DESIGN §2.9): a white line that turns green on each uptick and red on each downtick, area fill, end dot. Built from our own 10 s polling
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
  const before = points[points.length - 2]!;
  const endColour = last > before ? "var(--up)" : last < before ? "var(--red)" : "#fff";
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
          <stop offset="0%" stopColor="rgba(255,255,255,.16)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      {/* One piece per tick: white while the price is flat (and at the start), green when it rose, red when it fell. */}
      {points.slice(1).map((v, i) => {
        const prev = points[i]!;
        const colour = v > prev ? "var(--up)" : v < prev ? "var(--red)" : "#fff";
        return (
          <path
            key={i}
            d={`M${x(i).toFixed(1)},${y(prev).toFixed(1)} L${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`}
            fill="none"
            stroke={colour}
            strokeWidth="1.75"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            data-testid="spark-seg"
            data-dir={v > prev ? "up" : v < prev ? "down" : "flat"}
          />
        );
      })}
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill={endColour} />
    </svg>
  );
}
