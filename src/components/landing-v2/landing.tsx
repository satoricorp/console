import { FaqAccordion } from "@/components/home/faq-accordion";
import { GitHubIcon } from "@/components/github-icon";
import { SignInLink } from "@/components/sign-in-link";
import {
  AgentPanel,
  ChatThread,
  PrSummaryCard,
  ReviewTerminal,
  SetupTerminal,
} from "@/components/landing-v2/artifacts";
import { InstallCommand } from "@/components/landing-v2/install-command";
import {
  HOW_IT_WORKS_DOCS_URL,
  POST_SIGN_IN_URL,
  githubSignInUrl,
} from "@/lib/site-links";

const INSTALL_COMMAND = "curl -fsSL https://download.gx.run/install.sh | sh";

const KICKER_CLASS =
  "font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500";

const SURFACES = [
  {
    kicker: "In your agent",
    title: "Review before you push",
    detail:
      "Run /gx in your coding agent — or gx review in the terminal — while the change is still in your working tree. Findings get fixed before the PR exists.",
    panel: AgentPanel,
  },
  {
    kicker: "In the description",
    title: "PRs arrive summarized",
    detail:
      "Open a PR like always. gx writes the verdict, the blast radius, and the changes worth reading first — each attributed to its source.",
    panel: PrSummaryCard,
  },
  {
    kicker: "In the thread",
    title: "@gx answers for the author",
    detail:
      "Ask @gx anything in a PR comment. It answers from the codebase and the captured session, and cites which.",
    panel: ChatThread,
  },
] as const;

const TOOLS = [
  { name: "Cursor", slug: "cursor" },
  { name: "Claude Code", slug: "claude-code" },
  { name: "Codex", slug: "codex" },
  { name: "GitHub Copilot", slug: "github-copilot" },
  { name: "Windsurf", slug: "windsurf" },
  { name: "Cline", slug: "cline" },
  { name: "Aider", slug: "aider" },
  { name: "Continue", slug: "continue" },
  { name: "Amp", slug: "amp" },
  { name: "Gemini CLI", slug: "gemini-cli" },
] as const;

const FAQ_ITEMS = [
  {
    question: "What models review my code?",
    answer:
      "The latest frontier models. gx runs two of them on every review and has a judge dedupe and rank what they find, so you only read findings that survive.",
  },
  {
    question: "Do I have to change how I code?",
    answer:
      "No. Keep your coding tools and plain Git. gx init installs Git hooks once; after that, commit and push as usual — capture and publishing ride along.",
  },
  {
    question: "Do I still use GitHub?",
    answer:
      "Yes. gx adds to your existing PRs: the summary lands in the description, and @gx answers questions in comments. Remove gx and plain Git keeps working.",
  },
] as const;

function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <a
      href={githubSignInUrl(POST_SIGN_IN_URL)}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 bg-zinc-100 px-6 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-white ${className}`}
    >
      <GitHubIcon className="h-3.5 w-3.5" />
      Get started free
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ml-1.5 size-4 shrink-0"
        aria-hidden
      >
        <path d="M2.5 8h9M9.5 5l3 3-3 3" />
      </svg>
    </a>
  );
}

function FreeTrialLine() {
  return (
    <p className="text-sm leading-6 text-zinc-400">
      <span className="font-medium text-zinc-200">1 week free.</span> Already
      have an account?{" "}
      <SignInLink className="text-zinc-300 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-100" />
    </p>
  );
}

export function LandingV2() {
  return (
    <main className="flex flex-1 flex-col bg-[#0a0a0a] text-zinc-100">
      {/* Hero */}
      <section className="px-6 pb-16 pt-14 sm:pb-24 sm:pt-20">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="flex min-w-0 max-w-xl flex-col items-start gap-6">
            <h1 className="text-pretty text-3xl font-medium leading-[1.12] tracking-tight text-zinc-50 sm:text-5xl">
              Code review that knows how the code was written
            </h1>
            <p className="text-pretty text-sm leading-6 text-zinc-400 sm:text-base">
              gx records the agent session behind each commit — the prompts,
              the tool calls, the edits — and reviews your changes with that
              context. Findings before you push, summaries and answers in your
              PR.
            </p>
            <div className="flex w-full max-w-md flex-col gap-3">
              <PrimaryCta className="w-full" />
              <InstallCommand command={INSTALL_COMMAND} />
              <FreeTrialLine />
            </div>
          </div>

          <div className="min-w-0">
            <ReviewTerminal />
          </div>
        </div>
      </section>

      {/* Works with */}
      <section className="border-t border-zinc-800/80 px-6 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-3">
          <p className={KICKER_CLASS}>Works with</p>
          <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
            {TOOLS.map((tool) => (
              <li
                key={tool.slug}
                className="flex shrink-0 items-center gap-2 text-sm font-medium tracking-tight text-zinc-400"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/marketing/works-with/${tool.slug}-white.svg`}
                  alt=""
                  height={16}
                  className="h-4 w-auto max-w-12 object-contain"
                  draggable={false}
                />
                <span>{tool.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Three surfaces */}
      <section
        id="how-it-works"
        className="border-t border-zinc-800/80 px-6 py-16 sm:py-24"
      >
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-12 max-w-2xl space-y-4">
            <p className={KICKER_CLASS}>How it works</p>
            <h2 className="text-xl font-medium tracking-tight text-zinc-50 sm:text-3xl">
              One context, three surfaces.
            </h2>
            <p className="text-sm leading-6 text-zinc-400">
              gx init installs Git hooks that tie every commit to the session
              that produced it. That context follows the change everywhere it
              gets reviewed.
            </p>
          </div>

          <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
            {SURFACES.map((surface) => {
              const Panel = surface.panel;
              return (
                <div key={surface.title} className="flex min-w-0 flex-col gap-4">
                  <div className="space-y-2">
                    <p className={KICKER_CLASS}>{surface.kicker}</p>
                    <h3 className="text-lg font-medium tracking-tight text-zinc-50">
                      {surface.title}
                    </h3>
                    <p className="text-sm leading-6 text-zinc-400">
                      {surface.detail}
                    </p>
                  </div>
                  <Panel />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="border-t border-zinc-800/80 px-6 py-16 sm:py-24">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0 max-w-xl space-y-4">
            <p className={KICKER_CLASS}>Setup</p>
            <h2 className="text-xl font-medium tracking-tight text-zinc-50 sm:text-3xl">
              Two commands. The rest is plain Git.
            </h2>
            <p className="text-sm leading-6 text-zinc-400">
              The hooks record which session produced each commit and publish
              context when you push. Nothing new to remember day to day — and
              if you remove gx, plain Git keeps working.
            </p>
            <a
              href={HOW_IT_WORKS_DOCS_URL}
              className="inline-block text-sm text-zinc-300 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-100"
            >
              Read how it works in the docs
            </a>
          </div>

          <div className="min-w-0">
            <SetupTerminal />
          </div>
        </div>
      </section>

      {/* FAQ + closing CTA */}
      <section id="faq" className="border-t border-zinc-800/80 px-6 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-12 max-w-lg space-y-3">
            <p className={KICKER_CLASS}>FAQ</p>
            <h2 className="text-xl font-medium tracking-tight text-zinc-50 sm:text-2xl">
              Common questions.
            </h2>
          </div>

          <FaqAccordion items={FAQ_ITEMS} />

          <div className="mt-16 flex flex-col items-start gap-4 sm:mt-24">
            <h2 className="text-xl font-medium tracking-tight text-zinc-50 sm:text-3xl">
              Your next PR arrives reviewed.
            </h2>
            <PrimaryCta />
            <FreeTrialLine />
          </div>
        </div>
      </section>
    </main>
  );
}
