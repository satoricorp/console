"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type Lenis from "lenis";

const BLACK = "#0a0a0a";
const WHITE = "#ffffff";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type LandingBgFadeProps = {
  children: ReactNode;
};

/**
 * Document-space vertical gradient behind the landing.
 *
 * `#landing-fade-in` / `#landing-fade-out` are 2×viewport spacers:
 * - first vh: color wipe (black→white / white→black) fills the screen
 * - second vh: solid hold, then section content (How it works / Features)
 */
export function LandingBgFade({ children }: LandingBgFadeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const bg = bgRef.current;
    if (!root || !bg) return;

    let frame = 0;

    const paint = () => {
      frame = 0;
      const fadeInEl = document.getElementById("landing-fade-in");
      const fadeOutEl = document.getElementById("landing-fade-out");
      const howEl = document.getElementById("how-it-works");
      const featuresEl = document.getElementById("features");
      const height = root.offsetHeight;
      bg.style.height = `${height}px`;

      if (!howEl || !featuresEl || height <= 0) {
        bg.style.background = BLACK;
        return;
      }

      const rootTop = root.getBoundingClientRect().top + window.scrollY;
      const docY = (el: Element) =>
        el.getBoundingClientRect().top + window.scrollY - rootTop;
      const vh = window.innerHeight;

      // Spacers are 2×vh: wipe across the first vh, solid hold across the second,
      // then section content. Fall back to 2×vh before the section if markers missing.
      const fadeInTop = fadeInEl
        ? docY(fadeInEl)
        : docY(howEl) - vh * 2;
      const howTop = docY(howEl);
      const fadeOutTop = fadeOutEl
        ? docY(fadeOutEl)
        : docY(featuresEl) - vh * 2;
      const featTop = docY(featuresEl);

      // Wipe completes one viewport before content (midpoint of each 2×vh spacer).
      const whiteComplete = fadeInEl ? fadeInTop + vh : howTop - vh;
      const blackComplete = fadeOutEl ? fadeOutTop + vh : featTop - vh;

      const toPct = (y: number) => `${clamp((y / height) * 100, 0, 100)}%`;

      // black → wipe to white (done before how) → white hold →
      // wipe to black (done before features) → black
      const blackHold = toPct(fadeInTop);
      const whiteStart = toPct(whiteComplete);
      const whiteHold = toPct(fadeOutTop);
      const blackReturn = toPct(blackComplete);

      bg.style.background = [
        "linear-gradient(to bottom,",
        `${BLACK} 0%,`,
        `${BLACK} ${blackHold},`,
        `${WHITE} ${whiteStart},`,
        `${WHITE} ${whiteHold},`,
        `${BLACK} ${blackReturn},`,
        `${BLACK} 100%)`,
      ].join(" ");
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });

    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    for (const id of [
      "landing-fade-in",
      "landing-fade-out",
      "how-it-works",
      "features",
    ]) {
      const el = document.getElementById(id);
      if (el) ro.observe(el);
    }

    let lenis: Lenis | undefined;
    let tries = 0;
    const attachLenis = () => {
      lenis = (window as Window & { __lenis?: Lenis }).__lenis;
      if (lenis) {
        lenis.on("scroll", schedule);
        return;
      }
      if (tries++ < 40) requestAnimationFrame(attachLenis);
    };
    attachLenis();

    document.body.style.backgroundColor = BLACK;

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      lenis?.off("scroll", schedule);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      document.body.style.backgroundColor = "";
    };
  }, []);

  return (
    <div ref={rootRef} className="relative flex flex-1 flex-col">
      <div
        ref={bgRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 w-full"
        style={{ background: BLACK }}
      />
      {children}
    </div>
  );
}
