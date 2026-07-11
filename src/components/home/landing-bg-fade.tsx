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
 * Document-space vertical gradient: black→white bridges into How it works.
 * White holds through How it works, then hard-cuts to black at Features
 * (no bottom wipe).
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

      const howTop = docY(howEl);
      const featTop = docY(featuresEl);

      // Soft band only at the top seam into How it works.
      const softIn = Math.min(vh * 0.55, howEl.offsetHeight * 0.35);

      const toPct = (y: number) => `${clamp((y / height) * 100, 0, 100)}%`;

      const blackHold = toPct(howTop - softIn);
      const whiteStart = toPct(howTop + softIn * 0.4);
      // Hard cut to black at Features — no white→black wipe.
      const whiteEnd = toPct(featTop);

      bg.style.background = [
        "linear-gradient(to bottom,",
        `${BLACK} 0%,`,
        `${BLACK} ${blackHold},`,
        `${WHITE} ${whiteStart},`,
        `${WHITE} ${whiteEnd},`,
        `${BLACK} ${whiteEnd},`,
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
    const howEl = document.getElementById("how-it-works");
    const featuresEl = document.getElementById("features");
    if (howEl) ro.observe(howEl);
    if (featuresEl) ro.observe(featuresEl);

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
