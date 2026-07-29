"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Xer0 "gx" rendered smaller than the surrounding phrase. */
const GX_SCALE = 0.76;
/**
 * Bottom-align visible gx ink with the suffix word's letter bottoms.
 * Positive = down. Viewport max-ink sample vs suffix: 0.04em → delta 0.
 */
const GX_BOTTOM_NUDGE = "0.04em";
/** Extra gap so Xer0 sidebearings don't crowd "init". */
const GX_GAP_COMPENSATION = "0.04em";

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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type Phase = {
  enter: number;
  copy: number;
  morph: number;
  rise: number;
};

/**
 * Scroll story:
 * 1. Fade in "git init"
 * 2. Fade in description A (git)
 * 3. Crossfade morph → "gx init" + description B
 * 4. Rise + hold
 */
function progressToPhase(progress: number): Phase {
  return {
    enter: remap(progress, 0, 0.08),
    copy: remap(progress, 0.14, 0.28),
    // Shared crossfade for git↔gx and description A↔B
    morph: remap(progress, 0.38, 0.52),
    rise: remap(progress, 0.58, 0.72),
  };
}

export function GitToGxSection() {
  const trackRef = useRef<HTMLElement>(null);
  const gitMeasureRef = useRef<HTMLSpanElement>(null);
  const gxMeasureRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>({
    enter: 0,
    copy: 0,
    morph: 0,
    rise: 0,
  });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [gitWidth, setGitWidth] = useState<number | null>(null);
  const [gxWidth, setGxWidth] = useState<number | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      const prefersReduced = media.matches;
      setReducedMotion(prefersReduced);
      if (prefersReduced) {
        setPhase({ enter: 1, copy: 1, morph: 1, rise: 1 });
      }
    };
    syncMotion();
    media.addEventListener("change", syncMotion);

    if (media.matches) {
      return () => media.removeEventListener("change", syncMotion);
    }

    const track = trackRef.current;
    if (!track) {
      return () => media.removeEventListener("change", syncMotion);
    }

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const scrolled = clamp(-rect.top, 0, total);
      setPhase(progressToPhase(scrolled / total));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      media.removeEventListener("change", syncMotion);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Measure both prefixes so the slot can lerp and the phrase recenters.
  useEffect(() => {
    const gitEl = gitMeasureRef.current;
    const gxEl = gxMeasureRef.current;
    if (!gitEl || !gxEl) return;

    const sync = () => {
      const git = gitEl.getBoundingClientRect().width;
      const gx = gxEl.getBoundingClientRect().width;
      if (git > 0) setGitWidth(git);
      if (gx > 0) setGxWidth(gx);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(gitEl);
    ro.observe(gxEl);
    void document.fonts.ready.then(sync);

    return () => ro.disconnect();
  }, []);

  // Very modest lift — stay near vertical center
  const riseY = -phase.rise * 2;
  const headlineOpacity = reducedMotion ? 1 : phase.enter;
  const gitOpacity = reducedMotion ? 0 : 1 - phase.morph;
  const gxOpacity = reducedMotion ? 1 : phase.morph;
  // Desc A with git; crossfade to desc B with gx on the same morph curve
  const descGitOpacity = reducedMotion
    ? 0
    : phase.copy * (1 - phase.morph);
  const descGxOpacity = reducedMotion ? 1 : phase.copy * phase.morph;

  // Lerp prefix width git → gx so the centered phrase recenters for both states.
  const prefixWidth =
    gitWidth != null && gxWidth != null
      ? lerp(gitWidth, gxWidth, reducedMotion ? 1 : phase.morph)
      : gitWidth;

  return (
    <section
      ref={trackRef}
      id="git-to-gx"
      aria-label="From git init to gx init"
      className={cn(
        "relative",
        reducedMotion ? "min-h-[70vh]" : "h-[640vh]",
      )}
    >
      <div
        className={cn(
          "flex flex-col justify-center px-6",
          reducedMotion
            ? "min-h-[70vh] py-24"
            : "sticky top-[var(--site-header-height)] h-[calc(100dvh-var(--site-header-height))]",
        )}
      >
        <div
          className="mx-auto flex w-full max-w-6xl flex-col items-center text-center will-change-transform"
          style={{
            transform: reducedMotion
              ? undefined
              : `translate3d(0, ${riseY}vh, 0)`,
          }}
        >
          <div
            className="flex w-full justify-center"
            style={{ opacity: headlineOpacity }}
          >
            <p
              className="text-[clamp(3rem,13.5vw,10.5rem)] font-medium leading-none tracking-tight text-zinc-950 dark:text-zinc-50"
              aria-live="polite"
            >
              <span className="inline-flex items-end justify-center whitespace-nowrap">
                <span
                  className="relative inline-block shrink-0 self-end"
                  style={
                    prefixWidth != null
                      ? { width: prefixWidth, minWidth: prefixWidth }
                      : undefined
                  }
                >
                  {/* Measures for lerp — opacity 0 but laid out for glyph metrics */}
                  <span
                    className="pointer-events-none absolute left-0 top-0 flex opacity-0"
                    aria-hidden
                  >
                    <span ref={gitMeasureRef} className="inline-block">
                      git
                    </span>
                    <span
                      ref={gxMeasureRef}
                      className="inline-block font-[family-name:var(--font-xer0)] leading-none"
                      style={{ fontSize: `${GX_SCALE}em` }}
                    >
                      gx
                    </span>
                  </span>

                  {/* In-flow box: "git" until measured, then explicit lerped width */}
                  {prefixWidth == null ? (
                    <span aria-hidden className="invisible inline-block select-none">
                      git
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className="inline-block"
                      style={{ width: prefixWidth, height: "1em" }}
                    />
                  )}

                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 overflow-visible"
                  >
                    <span
                      className="absolute left-1/2 bottom-0"
                      style={{
                        opacity: gitOpacity,
                        filter:
                          reducedMotion || phase.morph === 0
                            ? undefined
                            : `blur(${phase.morph * 6}px)`,
                        // Bottom-aligned with the suffix; keep morph lift on fade-out
                        transform: reducedMotion
                          ? "translateX(-50%)"
                          : `translateX(-50%) translateY(${phase.morph * -8}px)`,
                      }}
                    >
                      git
                    </span>
                    <span
                      data-align="gx"
                      className="absolute right-0 bottom-0 font-[family-name:var(--font-xer0)] leading-none"
                      style={{
                        fontSize: `${GX_SCALE}em`,
                        marginRight: GX_GAP_COMPENSATION,
                        opacity: gxOpacity,
                        filter:
                          reducedMotion || phase.morph === 1
                            ? undefined
                            : `blur(${(1 - phase.morph) * 6}px)`,
                        // Bottom edge locked to the suffix's line box bottom.
                        transform: reducedMotion
                          ? `translateY(${GX_BOTTOM_NUDGE})`
                          : `translateY(calc(${GX_BOTTOM_NUDGE} + ${(1 - phase.morph) * 8}px))`,
                      }}
                    >
                      gx
                    </span>
                  </span>
                </span>
                <span
                  data-align="suffix"
                  aria-hidden
                  className="ml-[0.28em] leading-none"
                >
                  init
                </span>
                <span className="sr-only">
                  {phase.morph > 0.5 ? "gx init" : "git init"}
                </span>
              </span>
            </p>
          </div>

          <div className="relative mt-14 w-full max-w-xl sm:mt-16">
            <p
              className="text-center text-sm leading-6 text-zinc-600 will-change-[opacity,transform] dark:text-zinc-400 sm:text-base"
              style={{
                opacity: descGitOpacity,
                transform: reducedMotion
                  ? undefined
                  : `translate3d(0, ${(1 - phase.copy) * 12}px, 0)`,
              }}
              aria-hidden={descGitOpacity < 0.5}
            >
              <span className="font-medium text-[var(--footer-link-hover)]">
                git was built for humans
              </span>
              . While it&apos;s an incredible tool for traditional development,
              AI coding tools generate new data that describes &apos;how&apos;
              and &apos;why&apos; changes were made, which is discarded when you
              commit.
            </p>
            <p
              className="absolute inset-x-0 top-0 text-center text-sm leading-6 text-zinc-600 will-change-opacity dark:text-zinc-400 sm:text-base"
              style={{ opacity: descGxOpacity }}
              aria-hidden={descGxOpacity < 0.5}
            >
              <span className="font-medium text-[var(--footer-link-hover)]">
                gx init
              </span>{" "}
              fixes this. Run it once per repository and Git hooks join your
              session and model data with every plain git commit and git push.
              One-time setup — then start building your company wide knowledge
              base.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
