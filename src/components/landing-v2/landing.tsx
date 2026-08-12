"use client";

import { useEffect, useRef, useState } from "react";
import { GitHubIcon } from "@/components/github-icon";
import { GxLogo } from "@/components/gx-logo";
import { SignInLink } from "@/components/sign-in-link";
import { berkeleyMono } from "@/components/landing-v2/fonts";
import { TerminalPanel } from "@/components/landing-v2/terminal-panel";
import {
  TextWheel,
  WHEEL_STEP_DEG,
  WORD_COUNT,
} from "@/components/landing-v2/text-wheel";
import {
  applyImpulse,
  flickVelocityFor,
  nearestDetent,
  restingState,
  stepWheel,
  type WheelState,
} from "@/components/landing-v2/wheel-physics";
import { POST_SIGN_IN_URL, githubSignInUrl } from "@/lib/site-links";

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
  const stateRef = useRef<WheelState>(restingState());
  const frame = useRef<number | null>(null);
  const lastFrameTime = useRef(0);
  const wordClickRef = useRef((_index: number) => {});

  useEffect(() => {
    // Integrates the wheel simulation frame by frame: friction spins it
    // down, the settle spring drops it into a pocket, and the loop parks
    // itself once the wheel is at rest.
    const tick = (now: number) => {
      frame.current = null;
      const dt = (now - lastFrameTime.current) / 1000;
      lastFrameTime.current = now;
      const next = stepWheel(stateRef.current, dt);
      stateRef.current = next;
      setRotation(next.rotation);
      if (next.mode === "rest") {
        // The slide only changes — and fades back in — once the wheel has
        // come to rest on a pocket.
        setActiveStep(Math.round(-next.rotation / WHEEL_STEP_DEG));
        setMoving(false);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    const wake = () => {
      setMoving(true);
      if (frame.current === null) {
        lastFrameTime.current = performance.now();
        frame.current = requestAnimationFrame(tick);
      }
    };

    const onWheel = (event: WheelEvent) => {
      // The page never scrolls — swallow the event so the browser's elastic
      // overscroll doesn't bump the viewport.
      event.preventDefault();
      // Most browsers report pixels; Firefox reports lines (and page mode
      // exists in theory) — normalize so a notch feels the same everywhere.
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      stateRef.current = applyImpulse(stateRef.current, event.deltaY * scale);
      wake();
    };

    // Clicking a word flicks the wheel exactly hard enough that friction
    // lands it there, taking whichever direction is the shorter spin.
    wordClickRef.current = (index: number) => {
      const current = stateRef.current;
      const detent = nearestDetent(current.rotation);
      const currentIndex =
        (((Math.round(-detent / WHEEL_STEP_DEG) % WORD_COUNT) + WORD_COUNT) %
          WORD_COUNT);
      let diff = index - currentIndex;
      if (diff > WORD_COUNT / 2) diff -= WORD_COUNT;
      if (diff < -WORD_COUNT / 2) diff += WORD_COUNT;
      const travel = detent - diff * WHEEL_STEP_DEG - current.rotation;
      if (travel === 0) return;
      stateRef.current = {
        mode: "spin",
        rotation: current.rotation,
        velocity: flickVelocityFor(travel),
        target: current.rotation + travel,
      };
      wake();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  const handleWordClick = (index: number) => wordClickRef.current(index);

  const activeScreen =
    ((activeStep % SCREENS.length) + SCREENS.length) % SCREENS.length;

  return (
    <main
      className={`${berkeleyMono.className} relative h-dvh overflow-hidden bg-[#181716] text-zinc-100`}
    >
      <TextWheel
        rotation={rotation}
        onWordClick={handleWordClick}
        className="hidden lg:block"
      />

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
