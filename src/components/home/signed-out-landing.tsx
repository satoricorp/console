import { FaqAccordion } from "@/components/home/faq-accordion";
import { FeaturesSection } from "@/components/home/features-section";
import { HeroSection } from "@/components/home/hero-section";
import { HowItWorksSection } from "@/components/home/how-it-works-section";
import { ScrollReveal } from "@/components/scroll-reveal";

const FAQ_ITEMS = [
  {
    question: "What models can I use to review?",
    answer:
      "GPT 5.5 and Opus 4.8 are two of many models you can use to review code changes. Add any valid model ID from models.dev to your REVIEW.md file to tell GX which models to use.",
  },
  {
    question: "What are the independent resources used for review?",
    answer:
      "These are 92 resources maintained independently that help ensure best coding practices and provide reference context to ensure architecture, security, testing, and more are applied to every review.",
  },
  {
    question: "Do I need to change how I code to use GX?",
    answer:
      "No. Keep using your favorite codegen tools just as you currently do. The recommended way to use GX is through the local MCP server (if you have the CLI installed, you have the MCP server installed), and you have the option to use the CLI. Both the MCP and CLI will generate organized commits and branches on your behalf, making review simpler for you to grok when you review.",
  },
  {
    question: "Do I still use GitHub?",
    answer:
      "Yes. GitHub will continue to be your git forge, and you can use GitHub independently of GX if needed. Sign in with GitHub, publish stacks as PRs, and @gx on any PR to ask questions about the change.",
  },
] as const;

export function SignedOutLanding() {
  return (
    <main className="flex flex-1 flex-col">
      <HeroSection />

      <section id="problem" className="px-6 py-16 sm:py-24">
        <ScrollReveal className="mx-auto w-full max-w-5xl">
          <div className="max-w-2xl space-y-4">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              The problem
            </p>
            <h2 className="text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
              Pull requests are slowing you down.
            </h2>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Agents generate code quickly, but the time it takes to review your
              agents&apos; pull requests is growing. This slows developers
              down, creating a costly bottleneck.
            </p>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              You don&apos;t have to slow down to read every change Claude
              makes, with GX you can just keep shipping fast.
            </p>
          </div>
        </ScrollReveal>
      </section>

      <HowItWorksSection />
      <FeaturesSection />

      <section
        id="faq"
        className="border-t border-zinc-200 px-6 py-16 dark:border-zinc-800 sm:py-24"
      >
        <ScrollReveal className="mx-auto w-full max-w-5xl">
          <div className="mb-14 max-w-lg">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              FAQ
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              Common questions.
            </h2>
          </div>

          <FaqAccordion items={FAQ_ITEMS} />
        </ScrollReveal>
      </section>
    </main>
  );
}
