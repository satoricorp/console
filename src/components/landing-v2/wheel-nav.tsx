"use client";

import {
  CENTER_BOTTOM_PX,
  CENTER_OFFSET_PX,
  HIGHLIGHT_COLOR,
  NAV_LIST_GAP_PX,
  RADIUS_PX,
  SLIDE_NAMES,
} from "@/components/landing-v2/text-wheel";

/** Berkeley Mono at text-xs — line box must equal cap height with no leading. */
const NAV_FONT_SIZE_PX = 12;
const NAV_LINE_HEIGHT_PX = 12;

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
        fontSize: NAV_FONT_SIZE_PX,
        lineHeight: `${NAV_LINE_HEIGHT_PX}px`,
      }}
      aria-label="Slides"
    >
      <ol
        className="m-0 p-0"
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {SLIDE_NAMES.map((name, index) => {
          const isActive = index === activeSlide;
          const showHighlight = isActive && !moving;

          return (
            <li
              key={name}
              style={{
                margin: 0,
                padding: 0,
                height: NAV_LINE_HEIGHT_PX,
                lineHeight: `${NAV_LINE_HEIGHT_PX}px`,
              }}
            >
              <button
                type="button"
                onClick={() => onSlideClick(index)}
                aria-current={showHighlight ? "true" : undefined}
                className="m-0 block cursor-pointer border-0 bg-transparent p-0 text-left tracking-[0.08em] transition-[color,opacity] duration-300 hover:text-white"
                style={{
                  margin: 0,
                  padding: 0,
                  height: NAV_LINE_HEIGHT_PX,
                  lineHeight: `${NAV_LINE_HEIGHT_PX}px`,
                  fontSize: NAV_FONT_SIZE_PX,
                  color: showHighlight ? HIGHLIGHT_COLOR : "#a1a1aa",
                  opacity: moving && isActive ? 0.25 : 1,
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
