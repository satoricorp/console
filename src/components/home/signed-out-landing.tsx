import { FaqAccordion } from "@/components/home/faq-accordion";
import { FeaturesSection } from "@/components/home/features-section";
import { GitToGxSection } from "@/components/home/git-to-gx-section";
import { HeroSection } from "@/components/home/hero-section";
import { HowItWorksSection } from "@/components/home/how-it-works-section";
import { LandingBgFade } from "@/components/home/landing-bg-fade";
import { LandingLenis } from "@/components/home/landing-lenis";
import { ScrollReveal } from "@/components/scroll-reveal";

const FAQ_ITEMS = [
  {
    question: "What models can I use to review?",
    answer:
      "GX uses the latest frontier models to review changes. It pits models against each other for the best outcomes, and is constantly updating to the best performing models.",
  },
  {
    question: "What are the independent resources used for review?",
    answer:
      "These are 92 resources maintained independently that help ensure best coding practices and provide reference context to ensure architecture, security, testing, and more are applied to every review.",
  },
  {
    question: "Do I need to change how I code to use GX?",
    answer:
      "No. Keep using your favorite coding tools just as you currently do. The easiest way to get started is with the GX MCP, with the option to use the CLI. Both will generate the same metadata, making review simpler.",
  },
  {
    question: "Do I still use GitHub?",
    answer:
      "Yes, and you can use GitHub independently of GX if needed. Once you install the GX Github App, you'll be able to interact with GX in your PRs. @gx on any PR to ask questions about the change.",
  },
] as const;

export function SignedOutLanding() {
  return (
    <LandingLenis>
      <LandingBgFade>
        <main className="flex flex-1 flex-col">
          <HeroSection />
          <GitToGxSection />

          {/*
            2× viewport: first vh = black→white wipe to the top of the screen,
            second vh = solid white hold, then How it works content.
          */}
          <div
            id="landing-fade-in"
            aria-hidden
            className="h-[200dvh] w-full shrink-0"
          />
          <HowItWorksSection />
          {/*
            2× viewport: first vh = white→black wipe through the full screen,
            second vh = solid black hold, then Features content.
          */}
          <div
            id="landing-fade-out"
            aria-hidden
            className="h-[200dvh] w-full shrink-0"
          />
          <FeaturesSection />

          <section
            id="faq"
            className="border-t border-zinc-800 px-6 py-16 sm:py-24"
          >
            <ScrollReveal className="mx-auto w-full max-w-5xl">
              <div className="mb-14 max-w-lg">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                  FAQ
                </p>
                <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-50 sm:text-2xl">
                  Common questions.
                </h2>
              </div>

              <FaqAccordion items={FAQ_ITEMS} />
            </ScrollReveal>
          </section>
        </main>
      </LandingBgFade>
    </LandingLenis>
  );
}
