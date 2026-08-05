"use client";

type Tool = {
  name: string;
  slug: string;
};

const TOOLS: Tool[] = [
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
];

function ToolLogo({ slug, name }: { slug: string; name: string }) {
  const blackSrc = `/marketing/works-with/${slug}-black.svg`;
  const whiteSrc = `/marketing/works-with/${slug}-white.svg`;

  return (
    <span className="relative flex h-5 shrink-0 items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={blackSrc}
        alt=""
        height={20}
        className="h-5 w-auto max-w-14 object-contain dark:hidden"
        draggable={false}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={whiteSrc}
        alt=""
        height={20}
        className="hidden h-5 w-auto max-w-14 object-contain dark:block"
        draggable={false}
      />
      <span className="sr-only">{name}</span>
    </span>
  );
}

function ToolList({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <ul
      aria-hidden={ariaHidden || undefined}
      className="flex shrink-0 items-center gap-10 pr-10 sm:gap-14 sm:pr-14"
    >
      {TOOLS.map((tool) => (
        <li
          key={tool.slug}
          className="flex shrink-0 items-center gap-2.5 text-sm font-medium tracking-tight text-zinc-600 dark:text-zinc-400"
        >
          <ToolLogo slug={tool.slug} name={tool.name} />
          <span>{tool.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Horizontal marquee of tools. Styles live in globals.css (.works-with-*).
 * Overflow-x auto + Lenis prevent() lets trackpad/wheel scrub the strip.
 */
export function WorksWithCarousel() {
  return (
    <div className="shrink-0 border-t border-zinc-200/80 dark:border-zinc-800/80">
      <div className="flex items-center gap-6 px-6 py-4 sm:gap-8 sm:px-10 lg:px-16">
        <p className="shrink-0 text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
          Works with
        </p>

        <div
          className="works-with-mask min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          role="region"
          aria-label="Coding agents and tools gx works with"
        >
          <div className="works-with-track flex w-max">
            <ToolList />
            <ToolList ariaHidden />
          </div>
        </div>
      </div>
    </div>
  );
}
