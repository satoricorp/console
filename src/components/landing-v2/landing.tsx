"use client";

import localFont from "next/font/local";
import { useEffect, useRef, useState } from "react";
import { GitHubIcon } from "@/components/github-icon";
import { GxLogo } from "@/components/gx-logo";
import { SignInLink } from "@/components/sign-in-link";
import {
  TextWheel,
  highlightedWordIndex,
} from "@/components/landing-v2/text-wheel";
import { POST_SIGN_IN_URL, githubSignInUrl } from "@/lib/site-links";

const berkeleyMono = localFont({
  src: "../../fonts/BerkeleyMonoVariable.otf",
  weight: "100 900",
  display: "swap",
});

/** Wheel degrees per pixel of wheel/trackpad delta — scroll down spins counterclockwise. */
const DEG_PER_PX = -0.04;

/**
 * Right-column screens, selected by the wheel's highlighted word. The first
 * is real copy; the rest are stubs until the wheel words become real entries
 * (libghostty, etc.).
 */
const SCREENS: readonly (readonly string[])[] = [
  [
    "We’re tired of reviewing slop.",
    "AI over-engineers basic features, misses common edge cases, & hallucinates.",
    "The worst part is it looks plausible.",
    "We need ways to produce better code.",
  ],
  ["(next screen placeholder — e.g. a libghostty review example)"],
  ["(another screen placeholder)"],
];

const STUB_LINKS = [
  { label: "[Documentation]", href: "#" },
  { label: "[Say hi]", href: "#" },
] as const;

export function LandingV2() {
  const [rotation, setRotation] = useState(0);
  const virtualScroll = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      frame.current = null;
      setRotation(virtualScroll.current * DEG_PER_PX);
    };
    const onWheel = (event: WheelEvent) => {
      // The page never scrolls — swallow the event so the browser's elastic
      // overscroll doesn't bump the viewport.
      event.preventDefault();
      virtualScroll.current += event.deltaY;
      if (frame.current === null) {
        frame.current = requestAnimationFrame(update);
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  const activeScreen = highlightedWordIndex(rotation) % SCREENS.length;

  return (
    <main
      className={`${berkeleyMono.className} relative h-dvh overflow-hidden bg-[#181716] text-zinc-100`}
    >
      <TextWheel rotation={rotation} className="hidden lg:block" />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-14 px-8 pt-24 sm:pt-36 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
        <div className="flex min-w-0 flex-col items-start">
          {/* The footer mark sits inset inside its canvas — pull it back so
              its left edge lines up with the text below. */}
          <div className="-ml-10">
            <GxLogo variant="footer" scale={2} />
          </div>

          <p className="mt-7 flex items-center gap-2.5 text-xs text-zinc-100">
            <span className="font-extralight">&copy; 2026</span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="text-[11px] leading-none">
                &#9679;
              </span>
              Rhythm Computer Co.
            </span>
          </p>

          <div className="mt-5 flex flex-col items-start gap-1.5 text-[13px]">
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
            className="mt-10 inline-flex cursor-pointer items-center justify-center gap-2.5 bg-zinc-100 px-10 py-3.5 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-white"
          >
            <GitHubIcon className="h-3.5 w-3.5 shrink-0" />
            Get Started Free
          </a>
          <p className="mt-3 text-[13px] leading-6 text-zinc-400">
            <span className="text-[#ff80ff]">One week free.</span> Already have
            an account?{" "}
            <SignInLink className="text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-100" />
          </p>
        </div>

        <div className="relative max-w-md text-[13px] leading-6 text-zinc-100 lg:mt-14">
          {SCREENS.map((screen, index) => (
            <div
              key={index}
              className={`space-y-6 transition-opacity duration-300 ${
                index === activeScreen
                  ? "opacity-100"
                  : "pointer-events-none absolute inset-x-0 top-0 opacity-0"
              }`}
            >
              {screen.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
