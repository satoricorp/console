/** Xer0 "gx" rendered smaller than the surrounding phrase. */
const GX_SCALE = 0.76;
/**
 * Bottom-align visible gx ink with the suffix word's letter bottoms.
 * Positive = down. Viewport max-ink sample vs suffix: 0.04em → delta 0.
 */
const GX_BOTTOM_NUDGE = "0.04em";
/** Extra gap so Xer0 sidebearings don't crowd "init". */
const GX_GAP_COMPENSATION = "0.04em";

export function GitToTxSection() {
  return (
    <section
      id="git-to-gx"
      aria-label="From git init to gx init"
      // Tall bottom pad keeps the LandingBgFade white ramp below the copy.
      className="flex min-h-[70vh] flex-col justify-center px-6 pt-24 pb-[28rem]"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        <p className="text-[clamp(3rem,13.5vw,10.5rem)] font-medium leading-none tracking-tight text-zinc-950 dark:text-zinc-50">
          <span className="inline-flex items-end justify-center whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block font-[family-name:var(--font-xer0)] leading-none"
              style={{
                fontSize: `${GX_SCALE}em`,
                marginRight: GX_GAP_COMPENSATION,
                transform: `translateY(${GX_BOTTOM_NUDGE})`,
              }}
            >
              gx
            </span>
            <span aria-hidden className="ml-[0.28em] leading-none">
              init
            </span>
            <span className="sr-only">gx init</span>
          </span>
        </p>

        <div className="mt-14 flex w-full max-w-xl flex-col gap-6 sm:mt-16">
          <p className="text-center text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
            <span className="font-medium text-[var(--footer-link-hover)]">
              git was built for humans
            </span>
            . While it&apos;s an incredible tool for traditional development,
            AI coding tools generate new data that describes &apos;how&apos;
            and &apos;why&apos; changes were made, which is discarded when you
            commit.
          </p>
          <p className="text-center text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
            <span className="font-medium text-[var(--footer-link-hover)]">
              gx init
            </span>{" "}
            fixes this. Run it once per repository and Git hooks join your
            session and model data with every plain git commit and git push.
            One-time setup — then start building your company wide knowledge
            base.
          </p>
        </div>
      </div>
    </section>
  );
}
