"use client";

import { useEffect, useRef, type ReactNode } from "react";

const BLACK = { r: 10, g: 10, b: 10 }; // #0a0a0a — matches dark --background
const WHITE = { r: 255, g: 255, b: 255 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin = 0,
  outMax = 1,
) {
  if (inMax === inMin) return outMin;
  return (
    outMin +
    ((clamp(value, inMin, inMax) - inMin) / (inMax - inMin)) * (outMax - outMin)
  );
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
 * fades to white for How it works, back to black for Features+.
 * Uses the same window scroll + rAF pattern as GitToGxSection (Lenis-friendly).
 */
export function LandingBgFade({ children }: LandingBgFadeProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const how = () => document.getElementById("how-it-works");
    const features = () => document.getElementById("features");

    let frame = 0;

    const update = () => {
      frame = 0;
      const howEl = how();
      const featuresEl = features();
      if (!howEl || !featuresEl) {
        root.style.backgroundColor = mixRgb(0);
        return;
      }

      const vh = window.innerHeight;
      // Enter white as How it works approaches the upper viewport
      const toWhite = remap(howEl.getBoundingClientRect().top, vh * 0.92, vh * 0.28);
      // Return to black as Features approaches
      const toBlack = remap(
        featuresEl.getBoundingClientRect().top,
        vh * 0.92,
        vh * 0.28,
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
