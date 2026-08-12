"use client";

import { useEffect, useRef, useState } from "react";
import { GitHubIcon } from "@/components/github-icon";
import { GxLogo } from "@/components/gx-logo";
import { SignInLink } from "@/components/sign-in-link";
import { berkeleyMono } from "@/components/landing-v2/fonts";
import { TerminalPanel } from "@/components/landing-v2/terminal-panel";
import { TextWheel, WHEEL_STEP_DEG } from "@/components/landing-v2/text-wheel";
import { POST_SIGN_IN_URL, githubSignInUrl } from "@/lib/site-links";

/** Total time the wheel spends spinning down to a stop on the next slide. */
const GLIDE_DURATION_MS = 1500;
/** Extra full rotations the wheel spins through — past every word on it —
 * before settling on the next slide, so the slow-down actually has
 * something to click through instead of covering one tiny 6° step. */
const EXTRA_SPIN_LAPS = 1;
const EXTRA_SPIN_DEG = EXTRA_SPIN_LAPS * 360;
/** Steepness of the glide's exponential ease — quick speed-up, then a long,
 * gradual slow-down to a dead stop, like a wheel of fortune. Higher = the
 * initial rise happens faster and the tail drags out longer. */
const GLIDE_EASE_STEEPNESS = 4;
const GLIDE_EASE_NORMALIZER = 1 - 2 ** -GLIDE_EASE_STEEPNESS;

function glideEase(t: number): number {
  if (t >= 1) return 1;
  return (1 - 2 ** (-GLIDE_EASE_STEEPNESS * t)) / GLIDE_EASE_NORMALIZER;
}

type Screen =
  | { kind: "text"; lines: readonly string[] }
  | { kind: "terminal" };

/**
 * Right-column screens, selected by the wheel's highlighted word. The first is
 * the manifesto; the second is a live terminal running gx against the demo
 * repo; the rest are stubs until the wheel words become real entries.
 */
const SCREENS: readonly Screen[] = [
  {
    kind: "text",
    lines: [
      "We’re tired of reviewing slop.",
      "AI over-engineers basic features, misses common edge cases, & hallucinates.",
      "The worst part is it looks plausible.",
      "We need ways to produce better code.",
    ],
  },
  { kind: "terminal" },
  { kind: "text", lines: ["(another screen placeholder)"] },
];

const STUB_LINKS = [
  { label: "[Documentation]", href: "#" },
  { label: "[Say hi]", href: "#" },
] as const;

export function LandingV2() {
  const [rotation, setRotation] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [moving, setMoving] = useState(false);
  const rotationRef = useRef(0);
  const frame = useRef<number | null>(null);
  const gestureDelta = useRef(0);
  const lastDirection = useRef(1);
  const stepRef = useRef(0);
  const glideFrom = useRef(0);
  const glideTo = useRef(0);
  const glideStep = useRef(0);
  const glideStart = useRef(0);

  useEffect(() => {
    // Eases smoothly from wherever the wheel currently sits to the next (or
    // previous) slide and no further — like a wheel of fortune, it always
    // glides down to a stop on the very next pocket, never skipping ahead
    // and never snapping past it.
    const tick = (now: number) => {
      frame.current = null;
      const t = Math.min(1, (now - glideStart.current) / GLIDE_DURATION_MS);
      const eased = glideEase(t);
      rotationRef.current = glideFrom.current + (glideTo.current - glideFrom.current) * eased;
      setRotation(rotationRef.current);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
        return;
      }
      stepRef.current = glideStep.current;
      // The slide only changes — and fades back in — once the wheel has
      // come to rest.
      setActiveStep(glideStep.current);
      setMoving(false);
    };

    const onWheel = (event: WheelEvent) => {
      // The page never scrolls — swallow the event so the browser's elastic
      // overscroll doesn't bump the viewport.
      event.preventDefault();
      const now = performance.now();
      gestureDelta.current += event.deltaY;

      const direction =
        gestureDelta.current > 0 ? 1 : gestureDelta.current < 0 ? -1 : lastDirection.current;
      lastDirection.current = direction;
      // However hard or far the scroll, the target is always exactly one
      // slide from wherever the wheel last came to rest — never skips ahead.
      const targetStep = stepRef.current + direction;

      glideFrom.current = rotationRef.current;
      // An extra full lap in the same direction — so the slow-down actually
      // has 60 words to click through before it settles on the real target.
      glideTo.current = -targetStep * WHEEL_STEP_DEG - direction * EXTRA_SPIN_DEG;
      glideStep.current = targetStep;
      glideStart.current = now;
      // The current slide fades out for as long as the wheel keeps moving.
      setMoving(true);

      if (frame.current === null) {
        frame.current = requestAnimationFrame(tick);
      }
    };

    const onWheelEnd = () => {
      // A pause resets the gesture so the next scroll is judged fresh,
      // rather than inheriting a direction from a much earlier nudge.
      gestureDelta.current = 0;
    };
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheelWithReset = (event: WheelEvent) => {
      onWheel(event);
      if (endTimer !== null) clearTimeout(endTimer);
      endTimer = setTimeout(onWheelEnd, 300);
    };

    window.addEventListener("wheel", onWheelWithReset, { passive: false });
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      if (endTimer !== null) {
        clearTimeout(endTimer);
      }
      window.removeEventListener("wheel", onWheelWithReset);
    };
  }, []);

  const activeScreen =
    ((activeStep % SCREENS.length) + SCREENS.length) % SCREENS.length;

  return (
    <main
      className={`${berkeleyMono.className} relative h-dvh overflow-hidden bg-[#181716] text-zinc-100`}
    >
      <TextWheel rotation={rotation} className="hidden lg:block" />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-14 px-8 pt-24 sm:pt-36 lg:grid-cols-[1fr_1.8fr] lg:gap-12">
        <div className="flex min-w-0 flex-col items-start">
          {/* The footer mark sits inset inside its canvas — pull it back so
              its left edge lines up with the text below. */}
          <div className="-ml-10">
            <GxLogo variant="footer" scale={2} />
          </div>

          <p className="mt-5 flex items-center gap-2.5 text-xs text-zinc-100">
            <span className="font-extralight">&copy; 2026</span>
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-current"
              />
              Rhythm Computer Co.
            </span>
          </p>

          <div className="mt-2 flex flex-col items-start gap-1.5 text-xs">
            {STUB_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-zinc-100 transition-colors hover:text-white hover:underline"
              >
                {link.label}
              </a>
            ))}
          </div>

          <a
            href={githubSignInUrl(POST_SIGN_IN_URL)}
            className="group mt-7 inline-flex cursor-pointer items-center justify-center gap-2.5 bg-zinc-100 px-16 py-3.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-white"
          >
            <GitHubIcon className="h-3.5 w-3.5 shrink-0" />
            Get Started Free
            <span
              aria-hidden
              className="transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            >
              &#8599;
            </span>
          </a>
          <p className="mt-3 text-xs leading-6 text-zinc-400">
            <span className="text-[#ff80ff]">One week free.</span> Already have
            an account?{" "}
            <SignInLink className="text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-100" />
          </p>
        </div>

        <div className="relative text-xs leading-6 text-zinc-100 lg:mt-14">
          {SCREENS.map((screen, index) => (
            <div
              key={index}
              className={`transition-opacity duration-300 ${
                screen.kind === "terminal"
                  ? "h-[620px]"
                  : "max-w-md space-y-6"
              } ${
                index === activeScreen
                  ? moving
                    ? "opacity-0"
                    : "opacity-100"
                  : "pointer-events-none absolute inset-x-0 top-0 opacity-0"
              }`}
            >
              {screen.kind === "terminal" ? (
                <TerminalPanel className="h-full" />
              ) : (
                screen.lines.map((line) => <p key={line}>{line}</p>)
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
