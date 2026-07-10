"use client";

import { useEffect, useRef, type ReactNode } from "react";

const BLACK = { r: 10, g: 10, b: 10 }; // #0a0a0a — matches dark --background
const WHITE = { r: 255, g: 255, b: 255 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scroll progress as an element's top moves from `fromTop` → `toTop`
 * (typically high → low as the user scrolls down).
 */
function approachProgress(top: number, fromTop: number, toTop: number) {
  if (fromTop === toTop) return 0;
  return clamp((fromTop - top) / (fromTop - toTop), 0, 1);
}

function mixRgb(t: number) {
  const r = Math.round(BLACK.r + (WHITE.r - BLACK.r) * t);
  const g = Math.round(BLACK.g + (WHITE.g - BLACK.g) * t);
  const b = Math.round(BLACK.b + (WHITE.b - BLACK.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

type LandingBgFadeProps = {
  children: ReactNode;
};

/**
 * Scroll-linked page background: dark through hero + git→gx,
 * fades black→white entering How it works, white→black into Features.
 * Same window scroll + rAF pattern as GitToGxSection (Lenis-friendly).
 */
export function LandingBgFade({ children }: LandingBgFadeProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const howEl = document.getElementById("how-it-works");
      const featuresEl = document.getElementById("features");
      if (!howEl || !featuresEl) {
        root.style.backgroundColor = mixRgb(0);
        return;
      }

      const vh = window.innerHeight;
      const fromTop = vh * 0.9;
      const toTop = vh * 0.3;

      // 0→1 as How it works enters; stays 1 while it fills the viewport
      const toWhite = approachProgress(
        howEl.getBoundingClientRect().top,
        fromTop,
        toTop,
      );
      // 0→1 as Features enters — pulls bg back to black
      const toBlack = approachProgress(
        featuresEl.getBoundingClientRect().top,
        fromTop,
        toTop,
      );
      const t = toWhite * (1 - toBlack);
      root.style.backgroundColor = mixRgb(t);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex flex-1 flex-col bg-[#0a0a0a]"
      style={{ backgroundColor: mixRgb(0) }}
    >
      {children}
    </div>
  );
}
