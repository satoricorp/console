"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { GxWordmark } from "@/components/gx-wordmark";
import { GetStartedButton } from "@/components/get-started-button";
import { WorksWithCarousel } from "@/components/home/works-with-carousel";
import { SignInLink } from "@/components/sign-in-link";
import { cn } from "@/lib/utils";

const PinBoard = dynamic(
  () => import("./pin-board").then((mod) => mod.PinBoard),
  { ssr: false },
);

function usePinBoardTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(media.matches ? "dark" : "light");
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return theme;
}

export function HeroSection() {
  const [visible, setVisible] = useState(false);
  const pinTheme = usePinBoardTheme();

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion) {
      setVisible(true);
      return;
    }

    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      id="hero"
      className={cn(
        "flex h-[calc(100dvh-var(--site-header-height))] flex-col transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        <PinBoard theme={pinTheme} className="z-0" />

        <div className="relative z-10 flex h-full min-h-0 flex-col items-start justify-center py-4 pl-10 pr-8 sm:py-6 sm:pl-16 sm:pr-12 lg:pl-24">
          <div className="flex w-full max-w-3xl flex-col items-start gap-5 text-left sm:gap-6">
            <div className="w-full max-w-2xl">
              <GxWordmark size="hero" className="mb-1 block sm:mb-1.5" />
              <h1 className="text-pretty text-3xl font-medium leading-[1.12] tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
                Version control for agents
              </h1>
              <p className="mt-4 text-pretty text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
                Join data from your coding sessions with your code to improve
                code review and capture your teams knowledge with a single
                command: gx commit.
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

      <WorksWithCarousel />

      <a
        href="#git-to-gx"
        aria-label="Scroll to the next section"
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
