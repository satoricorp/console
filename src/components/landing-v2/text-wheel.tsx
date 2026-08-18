"use client";

/**
 * The deck, in order. The wheel doubles as the nav: the word sitting
 * horizontal names the slide on screen.
 */
export const SLIDE_NAMES = [
  "The Problem",
  "The Solution",
  "Example",
  "Proof & Benchmarks",
  "Get Started",
] as const;

export type SlideName = (typeof SLIDE_NAMES)[number];

export const SLIDE_COUNT = SLIDE_NAMES.length;

/** Laps of the deck around the ring. The titles repeat so the arc stays as
 * dense as it looks, and the deck keeps cycling as you keep scrolling. */
const WHEEL_REPEATS = 12;
export const WORD_COUNT = SLIDE_COUNT * WHEEL_REPEATS;
export const WHEEL_STEP_DEG = 360 / WORD_COUNT;
/** Tight ring — sharp curvature so the visible arc stays short. */
const RADIUS_PX = 160;
/** Wheel center sits this far off the left edge — only the right arc peeks in. */
const CENTER_OFFSET_PX = -60;
/** Center height above the viewport bottom. */
const CENTER_BOTTOM_PX = 96;

/** The slide a given pocket on the ring belongs to. */
export function slideIndexFor(pocket: number): number {
  return ((pocket % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT;
}

/**
 * Word wheel pinned past the bottom-left corner: the words radiate from a
 * center just off the left edge, so only the right-hand arc peeks in. The
 * word sitting exactly horizontal is the current slide, highlighted orange;
 * `rotation` (degrees, positive = clockwise) spins the whole wheel, and
 * clicking a word travels to its slide.
 */
export function TextWheel({
  rotation,
  className = "",
  onWordClick,
}: {
  rotation: number;
  className?: string;
  onWordClick?: (index: number) => void;
}) {
  return (
    <div
      className={`pointer-events-none absolute z-0 select-none ${className}`}
      style={{ left: CENTER_OFFSET_PX, bottom: CENTER_BOTTOM_PX }}
    >
      <div style={{ transform: `rotate(${rotation}deg)` }}>
        {Array.from({ length: WORD_COUNT }, (_, i) => {
          const base = i * WHEEL_STEP_DEG;
          let angle = (base + rotation) % 360;
          if (angle > 180) angle -= 360;
          if (angle < -180) angle += 360;
          const distance = Math.abs(angle);
          const highlighted = distance < WHEEL_STEP_DEG / 2;
          return (
            <button
              key={i}
              type="button"
              aria-current={highlighted ? "true" : undefined}
              onClick={() => onWordClick?.(i)}
              className="pointer-events-auto absolute left-0 top-0 cursor-pointer whitespace-nowrap bg-transparent text-xs tracking-[0.08em] transition-colors duration-150 hover:text-white"
              style={{
                transform: `rotate(${base}deg) translateX(${RADIUS_PX}px) translateY(-50%)`,
                transformOrigin: "0 0",
                color: highlighted ? "#ea580c" : "#f4f4f5",
              }}
            >
              {SLIDE_NAMES[slideIndexFor(i)]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
