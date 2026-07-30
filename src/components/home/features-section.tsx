import { ScrollReveal } from "@/components/scroll-reveal";

const FEATURES = [
  {
    title: "Attribution",
    detail:
      "Know exactly where your review context comes from with attribution, whether it's from a coding session, your codebase, an independent resource (e.g. OWASP top ten), or previous PRs.",
  },
  {
    title: "Chat with TX",
    detail: "Use ",
    highlight: "@tx in GitHub",
    detailAfter: " to ask questions about the pull request.",
  },
  {
    title: "CLI & MCP",
    detail: "Start using TX through the TX MCP and the CLI today.",
  },
  {
    title: "/review",
    detail: "Use ",
    highlight: "tx review",
    detailAfter:
      " in your agents to find issues with your current session and fix them before they ever make it to a PR.",
  },
  {
    title: "REVIEW.md",
    detail: "Add a ",
    highlight: "REVIEW.md",
    detailAfter:
      " at the root of your project. Include URLs to additional resources you want TX to use during review, specific instructions about your codebase to customize your review.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="border-t border-zinc-800 px-6 py-16 sm:py-24"
    >
      <ScrollReveal className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-lg">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            Features
          </p>
          <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-50 sm:text-3xl">
            Build Better Software.
          </h2>
        </div>

        <ul className="divide-y divide-zinc-800">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="grid gap-3 py-8 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-12 sm:py-10"
            >
              <h3 className="text-base font-medium tracking-tight text-zinc-50">
                {feature.title}
              </h3>
              <p className="text-sm leading-6 text-zinc-400">
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
