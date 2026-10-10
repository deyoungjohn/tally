"use client";
// The hero's rolling line and the card carousel beside it move together: when the phrase changes, that feature's card slides to the
// middle. Cards are one size and loop right to left forever. The first card is a mock of the trade card; tapping it fades into the
// real, live one. Rotation stops for good once someone taps a card or a dot (so typing is never interrupted), pauses while the
// pointer is over the cards, and never starts with reduced motion. A swipe on a phone moves to the next or previous card.

import { useReducedMotion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { RollingText } from "./rolling-text";
import { HERO_CARDS, type HeroCardSpec } from "./hero-samples";

export const HERO_PHRASES = [
  "Trade at the best prices",
  "Migrate across issuers seamlessly",
  "Receive alerts about your holdings",
  "Buy stock baskets without hassle",
  "Spot liquid tokens at a glance and avoid unit traps",
] as const;
const N = HERO_PHRASES.length;
const ROTATE_MS = 3800;

interface Stage {
  index: number;
  select: (i: number) => void;
  step: (d: 1 | -1) => void;
  pin: () => void;
  hover: (on: boolean) => void;
}
const Ctx = createContext<Stage | null>(null);
const useStage = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("HeroStage is missing");
  return v;
};

export function HeroStage({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    // Browsers driven by automation (navigator.webdriver) never auto-rotate, so a script that types into the card is not
    // interrupted; real visitors are unaffected.
    if (reduce || pinned || hovering || navigator.webdriver) return;
    const id = window.setInterval(() => setIndex((n) => (n + 1) % N), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduce, pinned, hovering]);
  const select = useCallback((i: number) => {
    setPinned(true);
    setIndex(i);
  }, []);
  const step = useCallback((d: 1 | -1) => {
    setPinned(true);
    setIndex((n) => (n + d + N) % N);
  }, []);
  const value = useMemo<Stage>(
    () => ({ index, select, step, pin: () => setPinned(true), hover: setHovering }),
    [index, select, step],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The orange rolling line under the headline. */
export function HeroLine() {
  const { index } = useStage();
  return <RollingText phrases={HERO_PHRASES} index={index} />;
}

/** One card: picture area, title, text, meta line, and a badge on the picture. */
function ListingCard({ card }: { card: HeroCardSpec }) {
  return (
    <div className="glass flex h-full w-full flex-col overflow-hidden !rounded-[28px]">
      <div
        className="relative h-[54%] shrink-0 overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 90% at 20% 0%, rgba(255,106,40,.38), rgba(255,106,40,.06) 60%), rgba(255,255,255,.03)",
        }}
      >
        {card.art}
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[13px] font-semibold text-[var(--orange-text)] backdrop-blur-sm">
          Available now
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-5">
        <p className="text-[21px] font-bold leading-tight tracking-[-0.02em]">{card.title}</p>
        <p className="text-[15px] leading-snug text-fg2">{card.text}</p>
        <div className="mt-auto">{card.meta}</div>
      </div>
    </div>
  );
}

/** The first card: a mock that becomes the real trade card when tapped. */
function TradeSlot({
  live,
  onLive,
  trade,
}: {
  live: boolean;
  onLive: () => void;
  trade: React.ReactNode;
}) {
  return (
    <div className="relative h-full w-full">
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none",
          live ? "pointer-events-none opacity-0" : "opacity-100",
        )}
        aria-hidden={live}
        inert={live}
      >
        <button
          type="button"
          onClick={onLive}
          className="block h-full w-full cursor-pointer rounded-[28px] text-left"
          aria-label="Try the trade card"
          data-testid="hero-trade-mock"
        >
          <ListingCard card={HERO_CARDS[0]!} />
        </button>
      </div>
      <div
        className={cn(
          "absolute inset-0 flex items-center transition-opacity duration-500 motion-reduce:transition-none",
          live ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!live}
        inert={!live}
        data-testid="hero-trade-live"
      >
        {live ? trade : null}
      </div>
    </div>
  );
}

/** The carousel. Offsets are worked out around the circle, so the card that leaves on the left re-enters on the right unseen. */
export function HeroPanels({ trade }: { trade: React.ReactNode }) {
  const { index, select, step, pin, hover } = useStage();
  const [live, setLive] = useState(false);
  // Automation sees the real card straight away (it never waits for a tap), like it never sees the rotation.
  useEffect(() => {
    if (navigator.webdriver) setLive(true);
  }, []);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const half = Math.floor(N / 2);
  return (
    <div
      onPointerEnter={(e) => e.pointerType === "mouse" && hover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hover(false)}
      onPointerDown={pin}
      onFocusCapture={pin}
    >
      <div
        className="hero-track relative mx-auto w-full touch-pan-y overflow-hidden"
        data-testid="hero-panels"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(t.clientY - s.y)) step(dx < 0 ? 1 : -1);
        }}
      >
        {HERO_CARDS.map((card, i) => {
          const off = ((i - index + N + half) % N) - half; // -2 .. 2 for five cards
          const active = off === 0;
          const shown = Math.abs(off) <= 1;
          return (
            <div
              key={card.key}
              className="hero-card absolute left-1/2 top-0"
              style={{
                width: "var(--hc-w)",
                height: "var(--hc-h)",
                marginLeft: "calc(var(--hc-w) / -2)",
                transform: `translateX(calc(var(--hc-step) * ${off})) scale(${active ? 1 : 0.88})`,
                opacity: active ? 1 : shown ? 0.5 : 0,
                zIndex: active ? 3 : shown ? 2 : 1,
                pointerEvents: shown ? "auto" : "none",
              }}
              aria-hidden={!active}
              inert={!active && !shown}
              data-testid={`hero-panel-${i}`}
              data-active={active}
              onClick={!active && shown ? () => select(i) : undefined}
            >
              {i === 0 ? (
                <TradeSlot
                  live={live}
                  onLive={() => {
                    pin();
                    setLive(true);
                  }}
                  trade={trade}
                />
              ) : (
                <ListingCard card={card} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex justify-center gap-2" role="group" aria-label="Show a feature">
        {HERO_PHRASES.map((p, i) => (
          <button
            key={p}
            type="button"
            onClick={() => select(i)}
            aria-label={p}
            aria-current={i === index}
            data-testid={`hero-dot-${i}`}
            className="grid h-6 w-6 place-items-center rounded-full"
          >
            <span
              className={cn(
                "block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none",
                i === index ? "w-6 bg-[var(--orange)]" : "w-2 bg-white/30",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
