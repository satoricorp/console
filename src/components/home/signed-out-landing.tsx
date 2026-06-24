import { GxLogo } from "@/components/gx-logo";
import { FaqAccordion } from "@/components/home/faq-accordion";
import { FeaturesSection } from "@/components/home/features-section";
import { HowItWorksSection } from "@/components/home/how-it-works-section";
import { GetStartedButton } from "@/components/get-started-button";
import { SignInLink } from "@/components/sign-in-link";

const STORY_POINTS = [
  "The agent prompt and what it was trying to do",
  "Files read, commands run, and tests that passed",
  "The final diff",
  "GPT 5.5 and Opus 4.8 review signals",
] as const;

const FAQ_ITEMS = [
  {
    question: "What models can I use to review code?",
    answer:
      "GPT 5.5 and Opus 4.8. GX runs both on every review and surfaces where they agree and where they do not.",
  },
  {
    question: "What are the 92 review resources?",
    answer:
      "Built-in checks and reference materials — architecture, security, testing, and more — applied automatically on each review.",
  },
  {
    question: "Do I need to change how I code?",
    answer:
      "No. Keep your editor and agent workflow. GX captures sessions and organizes stacks in the background.",
  },
  {
    question: "Do I still use GitHub?",
    answer:
      "Yes. GitHub stays your source of truth. Sign in with GitHub, publish stacks as PRs, and @gx on any PR to ask questions about the change.",
  },
] as const;

export function SignedOutLanding() {
  return (
    <main className="flex flex-1 flex-col">
      <section
        id="hero"
        className="flex flex-1 items-center justify-center px-6 py-16 sm:py-24"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-10 text-center">
          <GxLogo variant="hero" className="mx-auto" />

          <div className="flex w-full min-w-0 flex-col items-center gap-8">
            <div className="w-full max-w-2xl space-y-4">
              <h1 className="text-pretty text-3xl font-medium leading-[1.12] tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
                The Quality Layer for Agents
              </h1>
              <p className="text-pretty text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
                Turn every agent session into a small review stack with
                attributions so you can trust changes without reading the entire
                diff.
              </p>
            </div>

            <div className="flex w-full max-w-lg flex-col items-stretch gap-3">
              <GetStartedButton className="h-12 w-full px-12 text-base" />
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  2 weeks free.
                </span>{" "}
                Already have an account?{" "}
                <SignInLink className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:text-zinc-100" />
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="problem"
        className="border-t border-zinc-200 px-6 py-16 dark:border-zinc-800 sm:py-24"
      >
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-10 max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              The problem
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
              Agent code is fast. Trust is not.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Most tools review the diff. GX reviews the full story:
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {STORY_POINTS.map((point) => (
              <li
                key={point}
                className="flex gap-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400"
              >
                <span
                  aria-hidden
                  className="mt-2 size-1 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600"
                />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <HowItWorksSection />
      <FeaturesSection />

      <section
        id="faq"
        className="border-t border-zinc-200 px-6 py-16 dark:border-zinc-800 sm:py-24"
      >
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-14 max-w-lg">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              FAQ
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              Common questions.
            </h2>
          </div>

          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </section>
    </main>
  );
}
