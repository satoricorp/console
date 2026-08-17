"use client";

import { GitHubIcon } from "@/components/github-icon";
import { GxLogo } from "@/components/gx-logo";
import { SignInLink } from "@/components/sign-in-link";
import { berkeleyMono } from "@/components/landing-v2/fonts";
import { TerminalPanel } from "@/components/landing-v2/terminal-panel";
import { TextWheel } from "@/components/landing-v2/text-wheel";
import { useWheelDriver } from "@/components/landing-v2/use-wheel-driver";
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
  const { rotation, activeStep, moving, spinToIndex } = useWheelDriver();

  const activeScreen =
    ((activeStep % SCREENS.length) + SCREENS.length) % SCREENS.length;

  return (
    <main
      className={`${berkeleyMono.className} relative h-dvh overflow-hidden bg-[#181716] text-zinc-100`}
    >
      <TextWheel
        rotation={rotation}
        onWordClick={spinToIndex}
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
