"use client";

/** Placeholder copy — the real words (libghostty, etc.) come later. */
const WORD = "alkjslkjasf";
export const WORD_COUNT = 60;
export const WHEEL_STEP_DEG = 360 / WORD_COUNT;
/** Tight ring — sharp curvature so the visible arc stays short. */
const RADIUS_PX = 160;
/** Wheel center sits this far off the left edge — only the right arc peeks in. */
const CENTER_OFFSET_PX = -60;
/** Center height above the viewport bottom. */
const CENTER_BOTTOM_PX = 96;

/** Index of the word currently sitting exactly horizontal (pointing right). */
export function highlightedWordIndex(rotation: number): number {
  const index = Math.round(-rotation / WHEEL_STEP_DEG) % WORD_COUNT;
  return index < 0 ? index + WORD_COUNT : index;
}

/**
 * Word wheel pinned past the bottom-left corner: the words radiate from a
 * center just off the left edge, so only the right-hand arc peeks in. The
 * word sitting exactly horizontal is highlighted orange; `rotation` (degrees,
 * positive = clockwise) spins the whole wheel.
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
              onClick={() => onWordClick?.(i)}
              className="pointer-events-auto absolute left-0 top-0 cursor-pointer whitespace-nowrap bg-transparent text-xs tracking-[0.08em] transition-colors duration-150 hover:text-white"
              style={{
                transform: `rotate(${base}deg) translateX(${RADIUS_PX}px) translateY(-50%)`,
                transformOrigin: "0 0",
                color: highlighted ? "#ea580c" : "#f4f4f5",
              }}
            >
              {WORD}
            </button>
          );
        })}
      </div>
    </div>
  );
}
