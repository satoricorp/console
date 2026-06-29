"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GxLogo } from "@/components/gx-logo";
import { GetStartedButton } from "@/components/get-started-button";
import { SignInLink } from "@/components/sign-in-link";
import { cn } from "@/lib/utils";

export function HeroSection() {
  const [visible, setVisible] = useState(false);
  const revealed = useRef(false);

  const revealHero = useCallback(() => {
    if (revealed.current) {
      return;
    }

    revealed.current = true;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion) {
      setVisible(true);
      return;
    }

    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(revealHero, 8000);

    return () => window.clearTimeout(timeout);
  }, [revealHero]);

  return (
    <section
      id="hero"
      className={cn(
        "flex h-[calc(100dvh-var(--site-header-height))] flex-col px-6 transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-4 sm:py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 text-center sm:gap-8">
          <GxLogo variant="hero" className="mx-auto" onReady={revealHero} />

          <div className="flex w-full min-w-0 flex-col items-center gap-5 sm:gap-6">
            <div className="w-full max-w-2xl space-y-4">
              <h1 className="text-pretty text-3xl font-medium leading-[1.12] tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
                The Essential Quality Layer for Agents
              </h1>
              <p className="text-pretty text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
                Give every coding session the tools to generate robust and
                verified changes without reading pull requests line for line.
              </p>
            </div>

            <div className="flex w-full max-w-lg flex-col items-stretch gap-3">
              <GetStartedButton className="h-12 w-full px-12 text-base" />
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-[var(--footer-link-hover)]">
                  1 week free.
                </span>{" "}
                Already have an account?{" "}
                <SignInLink className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:text-zinc-100" />
              </p>
            </div>
          </div>
        </div>
      </div>

      <a
        href="#problem"
        aria-label="Scroll to the problem section"
        className="flex shrink-0 justify-center pb-5 pt-2"
      >
        <ChevronDown
          aria-hidden
          strokeWidth={2}
          className="scroll-arrow-bounce h-5 w-5 text-zinc-400 dark:text-white"
        />
      </a>
    </section>
  );
}
