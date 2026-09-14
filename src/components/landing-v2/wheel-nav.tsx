"use client";

import {
  CENTER_BOTTOM_PX,
  CENTER_OFFSET_PX,
  HIGHLIGHT_COLOR,
  NAV_LIST_GAP_PX,
  RADIUS_PX,
  SLIDE_NAMES,
} from "@/components/landing-v2/text-wheel";

type WheelNavProps = {
  activeSlide: number;
  moving: boolean;
  onSlideClick: (slideIndex: number) => void;
};

/**
 * Vertical page list beside the wheel. Orange highlights the active slide and
 * fades out while the wheel is spinning, then fades in on the landed slide.
 */
export function WheelNav({ activeSlide, moving, onSlideClick }: WheelNavProps) {
  const listLeft = CENTER_OFFSET_PX + RADIUS_PX + NAV_LIST_GAP_PX;

  return (
    <nav
      className="pointer-events-auto absolute z-0 select-none"
      style={{
        left: listLeft,
        top: `calc(100dvh - ${CENTER_BOTTOM_PX}px)`,
        transform: "translateY(-50%)",
      }}
      aria-label="Slides"
    >
      <ol className="flex flex-col gap-3">
        {SLIDE_NAMES.map((name, index) => {
          const isActive = index === activeSlide;
          const showHighlight = isActive && !moving;

          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => onSlideClick(index)}
                aria-current={showHighlight ? "true" : undefined}
                className="cursor-pointer bg-transparent text-left text-xs tracking-[0.08em] transition-colors duration-300 hover:text-white"
                style={{
                  color: showHighlight ? HIGHLIGHT_COLOR : "#a1a1aa",
                }}
              >
                {name}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
