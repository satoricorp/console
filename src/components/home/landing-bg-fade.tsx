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
 * Document-space vertical gradient: black hard-cuts to white at
 * `#how-it-works-rule` (the section’s top border). White holds through
 * How it works, then hard-cuts back to black at the FAQ.
 *
 * Both edges are hard cuts. A soft black→white ramp would have to run in the
 * space above the rule, and the hero — full-viewport, with its CTA and
 * works-with strip sitting right on that edge — has none to give.
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
      const ruleEl = document.getElementById("how-it-works-rule");
      const faqEl = document.getElementById("faq");
      const height = root.offsetHeight;
      bg.style.height = `${height}px`;

      if (!howEl || !faqEl || height <= 0) {
        bg.style.background = BLACK;
        return;
      }

      const rootTop = root.getBoundingClientRect().top + window.scrollY;
      const docY = (el: Element) =>
        el.getBoundingClientRect().top + window.scrollY - rootTop;
      // Separator = section top border; marker sits at that edge.
      const ruleTop = ruleEl ? docY(ruleEl) : docY(howEl);
      const faqTop = docY(faqEl);

      const toPct = (y: number) => `${clamp((y / height) * 100, 0, 100)}%`;

      const whiteStart = toPct(ruleTop);
      const whiteEnd = toPct(faqTop);

      bg.style.background = [
        "linear-gradient(to bottom,",
        `${BLACK} 0%,`,
        `${BLACK} ${whiteStart},`,
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
    for (const id of ["how-it-works", "how-it-works-rule", "faq"]) {
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
