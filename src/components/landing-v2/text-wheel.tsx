"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

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

const HIGHLIGHT_COLOR = "#ea580c";
const WORD_COLOR = "#f4f4f5";

/** The slide a given pocket on the ring belongs to. */
export function slideIndexFor(pocket: number): number {
  return ((pocket % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT;
}

/** The pocket sitting horizontal at `rotation`: the word whose own angle the
 * ring's rotation cancels out. */
function highlightedPocket(rotation: number): number {
  const pocket = Math.round(-rotation / WHEEL_STEP_DEG);
  return ((pocket % WORD_COUNT) + WORD_COUNT) % WORD_COUNT;
}

/** The ring mounts at rest, before the driver has turned it. */
const REST_ROTATION = 0;
const REST_POCKET = highlightedPocket(REST_ROTATION);

/**
 * The wheel's motion surface. Rotation is written straight to the DOM rather
 * than rendered from state: the driver sets it from inside Lenis's rAF, and a
 * state update would only reach the DOM in a later task — a frame behind the
 * value it was meant to show — after reconciling sixty words for what is one
 * transform and at most two colour changes.
 */
export type TextWheelHandle = {
  /** Turn the ring to `degrees` (positive = clockwise) and move the highlight
   * onto whichever word now sits horizontal. */
  setRotation: (degrees: number) => void;
};

/**
 * Word wheel pinned past the bottom-left corner: the words radiate from a
 * center just off the left edge, so only the right-hand arc peeks in. The
 * word sitting exactly horizontal is the current slide, highlighted orange;
 * the ring is spun through the handle, and clicking a word travels to its
 * slide.
 */
export const TextWheel = forwardRef<
  TextWheelHandle,
  {
    className?: string;
    onWordClick?: (index: number) => void;
  }
>(function TextWheel({ className = "", onWordClick }, ref) {
  const ringRef = useRef<HTMLDivElement>(null);
  /** Pocket currently carrying the highlight, so a frame that stays inside
   * the same pocket touches nothing but the transform. */
  const highlightedRef = useRef(REST_POCKET);

  useImperativeHandle(
    ref,
    () => ({
      setRotation(degrees) {
        const ring = ringRef.current;
        if (!ring) return;
        ring.style.transform = `rotate(${degrees}deg)`;

        const next = highlightedPocket(degrees);
        const prev = highlightedRef.current;
        if (next === prev) return;
        highlightedRef.current = next;
        // The ring's children are the words, in pocket order.
        const was = ring.children[prev] as HTMLElement | undefined;
        const now = ring.children[next] as HTMLElement | undefined;
        if (was) {
          was.style.color = WORD_COLOR;
          was.removeAttribute("aria-current");
        }
        if (now) {
          now.style.color = HIGHLIGHT_COLOR;
          now.setAttribute("aria-current", "true");
        }
      },
    }),
    [],
  );

  return (
    <div
      className={`pointer-events-none absolute z-0 select-none ${className}`}
      style={{ left: CENTER_OFFSET_PX, bottom: CENTER_BOTTOM_PX }}
    >
      {/* Rendered at rest and never re-rendered with another rotation, so
          React leaves the transform and colours the handle writes alone.
          `will-change` gives the ring its own compositor layer: the turn is
          then applied to a rasterised ring instead of repainting sixty words
          every frame. */}
      <div
        ref={ringRef}
        style={{
          transform: `rotate(${REST_ROTATION}deg)`,
          willChange: "transform",
        }}
      >
        {Array.from({ length: WORD_COUNT }, (_, i) => {
          const highlighted = i === REST_POCKET;
          return (
            <button
              key={i}
              type="button"
              aria-current={highlighted ? "true" : undefined}
              onClick={() => onWordClick?.(i)}
              className="pointer-events-auto absolute left-0 top-0 cursor-pointer whitespace-nowrap bg-transparent text-xs tracking-[0.08em] transition-colors duration-150 hover:text-white"
              style={{
                transform: `rotate(${i * WHEEL_STEP_DEG}deg) translateX(${RADIUS_PX}px) translateY(-50%)`,
                transformOrigin: "0 0",
                color: highlighted ? HIGHLIGHT_COLOR : WORD_COLOR,
              }}
            >
              {SLIDE_NAMES[slideIndexFor(i)]}
            </button>
          );
        })}
      </div>
    </div>
  );
});
