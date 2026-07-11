"use client";

import { CopyCommand } from "@/components/copy-command";
import { ReviewDemoPreview } from "@/components/reviews/review-demo-preview";

export function ReviewsEmptyState() {
  return (
    <div className="space-y-8">
      <div className="space-y-4 text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
        <h2 className="text-[13px] font-medium text-zinc-950 dark:text-zinc-50">
          How GX works
        </h2>

        <p>
          You continue creating PRs as you normally would in GitHub. However,
          instead of using the command{" "}
          <code className="font-mono text-xs text-zinc-950 dark:text-zinc-100">
            git commit
          </code>
          , you would now want to use the command{" "}
          <code className="font-mono text-xs text-zinc-950 dark:text-zinc-100">
            gx commit
          </code>
          .
        </p>

        <p>
          GX Commit captures your session data and other information about your
          work to improve the review process.
        </p>

        <CopyCommand command="gx commit" />

        <p>
          Once you begin using GX commit instead of Git commit, you will notice
          you&apos;ll start to receive PR summaries in your GitHub PRs and be
          able to chat directly with GX inside of GitHub.
        </p>

        <p>
          In addition to the functionality inside of GitHub, you can revisit
          this page after you open a PR to see a simplified version of
          GitHub&apos;s PR which gives you only the most important changes and
          allows you to review your code changes more quickly.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-400">
          Below is an example of what you will see once you open a PR.
        </p>
        <ReviewDemoPreview />
      </div>
    </div>
  );
}
