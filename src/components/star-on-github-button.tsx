import { GitHubIcon } from "@/components/github-icon";
import { GITHUB_REPO_URL } from "@/lib/site-links";

export function StarOnGitHubButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-none border border-white/70 bg-black px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:border-white/85 hover:bg-zinc-900 hover:text-white/90 ${className}`}
    >
      <GitHubIcon className="h-4 w-4" />
      Star on GitHub
    </a>
  );
}
