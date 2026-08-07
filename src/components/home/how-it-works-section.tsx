import { ScrollReveal } from "@/components/scroll-reveal";
import { HOW_IT_WORKS_DOCS_URL } from "@/lib/site-links";

const STEPS = [
  {
    step: "01",
    verb: "Before you push",
    title: "Skip a round of review comments.",
    detail:
      "Run /gx in your coding agent to review the change you just made. Fix what it finds while the code is still in your working tree, and the issues a reviewer would have flagged are gone before the PR exists.",
    visual: "session",
  },
  {
    step: "02",
    verb: "In the pull request",
    title: "Get answers without waiting on the author.",
    detail:
      "Mention @gx in any PR comment. It answers from your codebase and from the session that produced the change, so reviewers get the 'why' in seconds instead of a Slack thread and a day of lag.",
    visual: "chat",
  },
  {
    step: "03",
    verb: "Reviewing",
    title: "Read three files instead of forty.",
    detail:
      "gx ranks every change by how much it matters and who it affects, so you start on the critical path instead of scrolling the whole diff looking for the part that counts.",
    visual: "priority",
  },
] as const;

function SessionMockup() {
  const lines = [
    { text: "/gx", tone: "prompt" },
    { text: "Reviewing 12 changed files…", tone: "muted" },
    { text: "2 issues found before push", tone: "found" },
  ] as const;

  return (
    <div aria-hidden className="overflow-hidden border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-xs font-medium text-zinc-900">Coding agent</p>
      </div>
      <div className="space-y-0 px-4 py-3 font-mono text-xs leading-6">
        {lines.map((line) => (
          <div key={line.text} className="flex min-w-0 items-center">
            <span
              className={`mr-2 shrink-0 ${
                line.tone === "prompt" ? "text-zinc-400" : "text-transparent"
              }`}
            >
              ›
            </span>
            <span
              className={`truncate ${
                line.tone === "prompt"
                  ? "text-zinc-900"
                  : line.tone === "found"
                    ? "text-amber-600"
                    : "text-zinc-500"
              }`}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatMockup() {
  const thread = [
    {
      author: "you",
      body: "@gx what is the riskiest change here?",
      tone: "ask",
    },
    {
      author: "gx",
      body: "The token refresh rewrite in auth/session.ts — it changes who stays signed in.",
      tone: "answer",
    },
  ] as const;

  return (
    <div aria-hidden className="overflow-hidden border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-xs font-medium text-zinc-900">Pull request #482</p>
      </div>
      <ul className="divide-y divide-zinc-200">
        {thread.map((message) => (
          <li key={message.author} className="space-y-1 px-4 py-3">
            <p
              className={`font-mono text-[10px] uppercase tracking-wider ${
                message.tone === "answer" ? "text-emerald-600" : "text-zinc-500"
              }`}
            >
              {message.author}
            </p>
            <p className="text-xs leading-5 text-zinc-700">{message.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PriorityMockup() {
  const files = [
    { path: "auth/session.ts", label: "critical", tone: "high" },
    { path: "api/publish.ts", label: "review", tone: "mid" },
    { path: "ui/button.tsx", label: "skim", tone: "low" },
  ] as const;

  const labelToneClass = {
    high: "text-red-600",
    mid: "text-amber-600",
    low: "text-zinc-400",
  } as const;

  return (
    <div aria-hidden className="overflow-hidden border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <p className="text-xs font-medium text-zinc-900">Read this first</p>
      </div>
      <ul className="divide-y divide-zinc-200">
        {files.map((file) => (
          <li
            key={file.path}
            className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
          >
            <span className="min-w-0 truncate font-mono text-zinc-700">
              {file.path}
            </span>
            <span
              className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${labelToneClass[file.tone]}`}
            >
              {file.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepVisual({ type }: { type: (typeof STEPS)[number]["visual"] }) {
  if (type === "session") return <SessionMockup />;
  if (type === "chat") return <ChatMockup />;
  return <PriorityMockup />;
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
          <h2 className="text-xl font-medium tracking-tight text-zinc-950 sm:text-3xl">
            Better code, less time in review.
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600">
            gx saves the session that produced each change — the prompts, tool
            calls, and edits — and uses it everywhere you review.
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
