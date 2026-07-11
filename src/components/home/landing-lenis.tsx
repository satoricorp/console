"use client";

import { useEffect, type ReactNode } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

type LandingLenisProps = {
  children: ReactNode;
};

/**
 * Smooth scroll for the signed-out marketing landing only.
 * Imperative init so children (hero) are not remounted after hydration.
 */
export function LandingLenis({ children }: LandingLenisProps) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: false,
    });
    // Expose so LandingBgFade (and local QA) can subscribe to Lenis scroll.
    (window as Window & { __lenis?: Lenis }).__lenis = lenis;

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    const onChange = () => {
      if (media.matches) lenis.stop();
      else lenis.start();
    };
    media.addEventListener("change", onChange);

    return () => {
      media.removeEventListener("change", onChange);
      cancelAnimationFrame(frame);
      delete (window as Window & { __lenis?: Lenis }).__lenis;
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
