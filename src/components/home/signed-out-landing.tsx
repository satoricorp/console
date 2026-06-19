import { GxLogo } from "@/components/gx-logo";
import { FaqAccordion } from "@/components/home/faq-accordion";
import { HowItWorksSection } from "@/components/home/how-it-works-section";
import { GetStartedButton } from "@/components/get-started-button";
import { SignInLink } from "@/components/sign-in-link";
import { StarOnGitHubButton } from "@/components/star-on-github-button";

const PROBLEM_CARDS = [
  {
    label: "Before",
    title: "Review became the bottleneck.",
    detail:
      "Agents ship faster than humans can review. Diffs pile up, context gets lost, and nobody knows what is actually ready to merge.",
  },
  {
    label: "The cost",
    title: "Speed without clarity creates merge risk.",
    detail:
      "When every change looks equally urgent, teams either review everything slowly or merge blindly. Neither scales.",
  },
  {
    label: "After",
    title: "Review only what matters, revision by revision.",
    detail:
      "GX organizes work into linear stacks with clear intent, so reviewers can walk changes in order and ship with confidence.",
  },
] as const;

const FAQ_ITEMS = [
  {
    question: "What is a stack?",
    answer:
      "A stack is a linear series of changes GX captures from your work — organized for review instead of one giant diff. You walk through each revision in order and decide what is ready to ship.",
  },
  {
    question: "Do I need to change how I code?",
    answer:
      "No. GX saves your work into stacks as you go. You keep your normal editor and agent workflow — GX handles the git organization in the background.",
  },
  {
    question: "What is a full-stack review?",
    answer:
      "A full-stack review walks your entire stack revision by revision in the GX desktop app — diffs, file tree, and comments in one place — so you review the whole change set, not just the latest commit.",
  },
  {
    question: "How many reviews are free?",
    answer:
      "You get three full-stack reviews free. Upgrade in the desktop app when you need more — no credit card required to start.",
  },
  {
    question: "Where do I review?",
    answer:
      "Reviews happen in the GX desktop app for macOS. Sign in on the web to get started, then download the app to run your first stack review.",
  },
  {
    question: "Do I still use GitHub?",
    answer:
      "Yes. You sign in with GitHub and GX fits into your existing workflow. GitHub stays your source of truth — GX adds structured stacks and a dedicated review surface.",
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
                Review what matters at shipping speed.
              </h1>
              <p className="text-pretty text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
                GX organizes your work into linear stacks — so you know exactly
                what you are shipping and review only the changes that count,
                revision by revision in the desktop app.
              </p>
            </div>

            <div className="flex w-full max-w-lg flex-col items-stretch gap-3">
              <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <GetStartedButton className="h-12 w-full px-12 text-base sm:flex-[1.2]" />
                <StarOnGitHubButton className="h-12 w-full px-8 text-sm sm:flex-[0.85]" />
              </div>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  3 full-stack reviews free.
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
          <div className="mb-14 max-w-lg">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              The problem
            </p>
            <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
              Faster agents need clearer review.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              When output accelerates, the review surface has to keep up — or
              shipping speed becomes an illusion.
            </p>
          </div>

          <ul className="grid gap-6 lg:grid-cols-3">
            {PROBLEM_CARDS.map((card) => (
              <li
                key={card.label}
                className="flex flex-col gap-3 border border-zinc-200 p-6 dark:border-zinc-800"
              >
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                  {card.label}
                </p>
                <h3 className="text-lg font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
                  {card.title}
                </h3>
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {card.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <HowItWorksSection />

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
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Everything you need to know before your first stack review.
            </p>
          </div>

          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </section>
    </main>
  );
}
