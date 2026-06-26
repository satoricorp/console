import { ScrollReveal } from "@/components/scroll-reveal";

const FEATURES = [
  {
    title: "Context Attribution",
    detail:
      "GX provides attributes for every comment, so you know if the context came from your codebase, a previous review, or your session.",
  },
  {
    title: "Chat with GX",
    detail: "Use ",
    highlight: "@gx in GitHub",
    detailAfter: " to ask questions about the pull request.",
  },
  {
    title: "MCP, CLI, and SDK",
    detail: "GX is available through MCP and the CLI today. ",
    highlight: "SDK coming soon.",
  },
  {
    title: "Loop with GX",
    detail:
      "GX is made for loops, helping identify if the output is high enough quality to ship. If GX has findings, the loop can generate fixes.",
  },
  {
    title: "REVIEW.md",
    detail: "Add a ",
    highlight: "REVIEW.md",
    detailAfter:
      " to the root of your project, and include URLs to additional resources you want GX to use during review, specific instructions about your codebase, and even model IDs (any model ID from models.dev) to customize your review specifically for your codebase.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="border-t border-zinc-200 px-6 py-16 dark:border-zinc-800 sm:py-24"
    >
      <ScrollReveal className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-lg">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            Features
          </p>
          <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            Build Quality Software.
          </h2>
        </div>

        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="grid gap-3 py-8 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-12 sm:py-10"
            >
              <h3 className="text-base font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
                {feature.title}
              </h3>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {feature.detail}
                {"highlight" in feature && feature.highlight ? (
                  <span className="font-medium text-[var(--footer-link-hover)]">
                    {feature.highlight}
                  </span>
                ) : null}
                {"detailAfter" in feature && feature.detailAfter
                  ? feature.detailAfter
                  : null}
              </p>
            </li>
          ))}
        </ul>
      </ScrollReveal>
    </section>
  );
}
