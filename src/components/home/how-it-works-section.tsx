import { GetStartedButton } from "@/components/get-started-button";
import { GitHubIcon } from "@/components/github-icon";

const STEPS = [
  {
    step: "01",
    verb: "Connect",
    title: "One sign-in, your whole workflow.",
    detail:
      "Sign in with GitHub and install the GX desktop app. Your repo links in minutes — no manual branch gymnastics or stack setup.",
    visual: "connect",
  },
  {
    step: "02",
    verb: "Capture",
    title: "Work saves into stacks automatically.",
    detail:
      "Keep your normal editor and agent workflow. GX organizes your session into thoughtful stacks as you go — so you are not juggling messy git state before review.",
    visual: "capture",
  },
  {
    step: "03",
    verb: "Review",
    title: "Walk the stack. Ship what is ready.",
    detail:
      "Review revision by revision in the desktop app — diffs, file tree, and threaded comments in one view. Each stack is structured for review, so you understand what changed without untangling unrelated diffs. Three full-stack reviews are free.",
    visual: "review",
  },
] as const;

function ConnectMockup() {
  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-zinc-950 font-mono text-xs leading-relaxed text-zinc-300 dark:border-zinc-800"
    >
      <div className="border-b border-zinc-800 px-4 py-2 text-zinc-500">
        your-project
      </div>
      <div className="space-y-1 px-4 py-4">
        <p>
          <span className="text-zinc-500">$</span>{" "}
          <span className="text-zinc-100">brew install gx</span>
        </p>
        <p className="text-emerald-400">✓ signed in with GitHub</p>
        <p className="text-emerald-400">✓ gx desktop connected</p>
        <p className="text-zinc-500"># stacks save automatically as you code</p>
      </div>
    </div>
  );
}

function CaptureMockup() {
  const revisions = [
    { status: "saved", title: "Add auth middleware", files: "3f" },
    { status: "saved", title: "Wire session cookies", files: "2f" },
    { status: "active", title: "Fix redirect loop", files: "1f" },
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Stack · 3 revisions
        </p>
        <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          capturing
        </span>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {revisions.map((rev) => (
          <li
            key={rev.title}
            className="flex items-center gap-3 px-4 py-3 text-xs"
          >
            <span
              className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                rev.status === "active"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-400"
              }`}
            >
              {rev.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
              {rev.title}
            </span>
            <span className="shrink-0 font-mono text-zinc-400">{rev.files}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewMockup() {
  const reviews = [
    { title: "Auth middleware stack", status: "reviewed", tone: "muted" },
    { title: "Invite modal fix on tab switch", status: "ready", tone: "ready" },
    {
      title: "Timeline tooltip hover delay",
      status: "in progress",
      tone: "active",
    },
  ] as const;

  return (
    <div
      aria-hidden
      className="overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          Stack reviews
        </p>
        <span className="font-mono text-[10px] text-zinc-500">3 free</span>
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
                  : item.tone === "active"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-400"
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
  if (type === "connect") return <ConnectMockup />;
  if (type === "capture") return <CaptureMockup />;
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
            Three steps. No coordination glue.
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Stacks that save themselves, reviewed in one place.
          </p>
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
                  <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
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

        <div className="mt-16 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <GetStartedButton className="px-8 py-3" />
          <p className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-500">
            <GitHubIcon className="h-4 w-4" />
            Free to start · no credit card
          </p>
        </div>
      </div>
    </section>
  );
}
