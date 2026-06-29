import { ScrollReveal } from "@/components/scroll-reveal";
import { HOW_IT_WORKS_DOCS_URL } from "@/lib/site-links";

const STEPS = [
  {
    step: "01",
    verb: "Generate",
    title: "Generate Review Stacks based on sessions.",
    detail:
      "GX captures your coding sessions and creates organized branches and commits to improve review. We leverage your existing codebase and metadata from past pull requests to identify issues.",
    visual: "capture",
  },
  {
    step: "02",
    verb: "Review Loop",
    title: "Review Loop.",
    detail:
      "GX uses 92 independent resources to make sure we review your code correctly, reducing bugs. GX verifies its findings through Review Loop, where OpenAI and Anthropic face-off to determine the best fixes for every issue.",
    visual: "verify",
  },
  {
    step: "03",
    verb: "Focus",
    title: "Review the most important changes.",
    detail:
      "End up with the most important lines of code to review manually, reducing your review time drastically.",
    visual: "review",
  },
] as const;

function CaptureMockup() {
  const items = [
    "Coding Sessions",
    "Indexed Codebase",
    "Previous PR Changes & Comments",
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Review Stack
        </p>
      </div>
      <div className="space-y-0 px-4 py-3 pl-6 font-mono text-xs leading-6">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const branch = isLast ? "└──" : "├──";

          return (
            <div
              key={item}
              className="flex min-w-0 items-center text-zinc-700 dark:text-zinc-300"
            >
              <span aria-hidden className="mr-2 shrink-0 text-zinc-400">
                {branch}
              </span>
              <span className="truncate">{item}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerifyMockup() {
  const models = [
    { name: "OpenAI", signal: "5 issues found", tone: "error" },
    { name: "Anthropic", signal: "2 issues found", tone: "warn" },
    { name: "Review Loop", signal: "3 fixes surfaced", tone: "success" },
  ] as const;

  const signalToneClass = {
    error: "text-red-600 dark:text-red-400",
    warn: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
  } as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Review Loop
        </p>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {models.map((model) => (
          <li
            key={model.name}
            className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
          >
            <span className="font-mono text-zinc-500">{model.name}</span>
            <span
              className={`truncate text-right ${signalToneClass[model.tone]}`}
            >
              {model.signal}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewMockup() {
  const reviews = [
    { title: "api.ts:42 — missing validation", status: "flagged", tone: "active" },
    { title: "handler.ts:18 — untested path", status: "flagged", tone: "active" },
    { title: "+847 other lines", status: "skipped", tone: "ready" },
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Lines to review
        </p>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {reviews.map((item) => (
          <li
            key={item.title}
            className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
          >
            <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
              {item.title}
            </span>
            <span
              className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                item.tone === "ready"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {item.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepVisual({ type }: { type: (typeof STEPS)[number]["visual"] }) {
  if (type === "capture") return <CaptureMockup />;
  if (type === "verify") return <VerifyMockup />;
  return <ReviewMockup />;
}

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="border-t border-zinc-200 px-6 py-16 dark:border-zinc-800 sm:py-24"
    >
      <ScrollReveal className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-2xl space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            How it works
          </p>
          <h2 className="text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            Use your codebase and coding sessions to improve review.
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Commits were built for humans. They don&apos;t contain session
            context to provide the &apos;why&apos;, which helps review pull
            requests generated by agents.
          </p>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Just like using a linter, use GX to improve quality and verify
            changes without reading your pull requests line by line.
          </p>
          <a
            href={HOW_IT_WORKS_DOCS_URL}
            className="inline-block text-sm text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:text-zinc-100"
          >
            Read how it works in the docs
          </a>
        </div>

        <ol className="flex flex-col gap-20 sm:gap-24">
          {STEPS.map((item, index) => {
            const visualFirst = index % 2 === 1;

            return (
              <li
                key={item.step}
                className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12"
              >
                <div className={`space-y-4 ${visualFirst ? "lg:order-2" : ""}`}>
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-zinc-400">
                      {item.step}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                      {item.verb}
                    </span>
                  </div>
                  <h3 className="text-lg font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-xl">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                    {item.detail}
                  </p>
                </div>

                <div className={visualFirst ? "lg:order-1" : ""}>
                  <StepVisual type={item.visual} />
                </div>
              </li>
            );
          })}
        </ol>
      </ScrollReveal>
    </section>
  );
}
