const STEPS = [
  {
    step: "01",
    verb: "Capture",
    title: "The session travels with the diff.",
    detail:
      "GX attaches the prompt, tool calls, and test output to the code — not just the patch at the end.",
    visual: "capture",
  },
  {
    step: "02",
    verb: "Verify",
    title: "GPT 5.5 and Opus 4.8 on every review.",
    detail:
      "Both models review the same change against REVIEW.md and your repo context. When they agree, you ship with confidence. When they disagree, you know where to look.",
    visual: "verify",
  },
  {
    step: "03",
    verb: "Ship",
    title: "You get a Review Stack you can trust.",
    detail:
      "Session evidence, model signals, and repo rules in one place — ready to merge.",
    visual: "review",
  },
] as const;

function CaptureMockup() {
  const signals = [
    "Agent prompt",
    "Files read + commands run",
    "Test output",
    "Diff attached",
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Session captured
        </p>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {signals.map((signal) => (
          <li key={signal} className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300">
            {signal}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerifyMockup() {
  const models = [
    { name: "GPT 5.5", signal: "auth bypass risk", tone: "warn" },
    { name: "Opus 4.8", signal: "auth bypass risk", tone: "warn" },
    { name: "REVIEW.md", signal: "require session tests", tone: "rule" },
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Model verification
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
              className={`truncate text-right ${
                model.tone === "warn"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
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
    { title: "Auth middleware", status: "verified", tone: "ready" },
    { title: "Session cookies", status: "needs fix", tone: "active" },
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
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-lg">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            How it works
          </p>
          <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            Capture. Verify. Ship.
          </h2>
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
      </div>
    </section>
  );
}
