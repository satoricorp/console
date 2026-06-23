import { GitHubIcon } from "@/components/github-icon";
import { githubSignInUrl, POST_SIGN_IN_URL } from "@/lib/site-links";

export function GetStartedButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={githubSignInUrl(POST_SIGN_IN_URL)}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${className}`}
    >
      <GitHubIcon className="h-3.5 w-3.5" />
      Get started free
      <ButtonArrow />
    </a>
  );
}

function ButtonArrow() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1.5 size-4 shrink-0 pointer-events-none"
      aria-hidden
    >
      <path d="M2.5 8h9M9.5 5l3 3-3 3" />
    </svg>
  );
}
