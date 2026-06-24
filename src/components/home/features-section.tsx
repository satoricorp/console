const FEATURES = [
  {
    title: "92 review resources on every review",
    detail:
      "Distinct checks and reference materials built in to improve quality — applied automatically on each review.",
  },
  {
    title: "MCP in Cursor, Codex, and Claude",
    detail:
      "Agents call GX from the editor to sync, review, and fix — without switching tools.",
  },
  {
    title: "@gx on GitHub PRs",
    detail:
      "Ask why a file changed or what risk applies. GX answers from session evidence and repo context.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="border-t border-zinc-200 px-6 py-16 dark:border-zinc-800 sm:py-24"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-lg">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            Features
          </p>
          <h2 className="mt-3 text-xl font-medium tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            Where GX shows up.
          </h2>
        </div>

        <ul className="grid gap-6 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="flex flex-col gap-2 border border-zinc-200 p-6 dark:border-zinc-800"
            >
              <h3 className="text-base font-medium tracking-tight text-zinc-950 dark:text-zinc-50">
                {feature.title}
              </h3>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {feature.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
