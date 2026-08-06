import { ScrollReveal } from "@/components/scroll-reveal";
import { HOW_IT_WORKS_DOCS_URL } from "@/lib/site-links";

const STEPS = [
  {
    step: "01",
    verb: "Surface",
    title: "Surface only critical code changes",
    detail:
      "Because gx has context on code changes, it can surface the most important changes that are in the critical path, saving you hours every day.",
    visual: "capture",
  },
  {
    step: "02",
    verb: "Review Loop",
    title: "Review Loop.",
    detail:
      "gx uses 92 independent resources to make sure we review your code correctly, reducing bugs. gx verifies its findings through Review Loop, where frontier models face-off to determine the best fixes for every issue.",
    visual: "verify",
  },
  {
    step: "03",
    verb: "Save",
    title: "Save your coding history.",
    detail:
      "Don't let any more of your data slip through your fingers. It's important to understand how your product is built, from ground zero. Start saving your data today.",
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
      className="overflow-hidden border border-zinc-200 bg-white"
    >
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-xs font-medium text-zinc-900">Review Context</p>
      </div>
      <div className="space-y-0 px-4 py-3 pl-6 font-mono text-xs leading-6">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const branch = isLast ? "└──" : "├──";

          return (
            <div
              key={item}
              className="flex min-w-0 items-center text-zinc-700"
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
    error: "text-red-600",
    warn: "text-amber-600",
    success: "text-emerald-600",
  } as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white"
    >
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-xs font-medium text-zinc-900">Review Loop</p>
      </div>
      <ul className="divide-y divide-zinc-200">
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
  const sessions = [
    { title: "auth-refactor session", status: "saved", tone: "ready" },
    { title: "47 tool calls indexed", status: "indexed", tone: "ready" },
    { title: "opus · 128k tokens", status: "$1.24", tone: "active" },
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white"
    >
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-xs font-medium text-zinc-900">Session history</p>
      </div>
      <ul className="divide-y divide-zinc-200">
        {sessions.map((item) => (
          <li
            key={item.title}
            className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
          >
            <span className="min-w-0 truncate text-zinc-700">{item.title}</span>
            <span
              className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                item.tone === "ready" ? "text-emerald-600" : "text-zinc-500"
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
      className="relative border-t border-zinc-200 px-6 py-16 sm:py-24"
    >
      {/* Marks the section top border for the landing bg white stop. */}
      <div
        id="how-it-works-rule"
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0"
      />
      <ScrollReveal className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-4xl space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            How it works
          </p>
          <h2 className="whitespace-nowrap text-xl font-medium tracking-tight text-zinc-950 sm:text-3xl">
            Use your coding sessions to improve code review.
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600">
            Traditional commits don&apos;t contain session context to provide
            the &apos;why&apos;, which helps developers understand how to review
            code generated by agents.
          </p>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600">
            gx saves your raw session data, tool calls, and edits to better
            understand how changes were made. gx also saves the metadata about
            what models you used along with token spend, so you can understand
            how each feature was built and how much it cost.
          </p>
          <a
            href={HOW_IT_WORKS_DOCS_URL}
            className="inline-block text-sm text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-950"
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
                  <h3 className="text-lg font-medium tracking-tight text-zinc-950 sm:text-xl">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-6 text-zinc-600">{item.detail}</p>
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
