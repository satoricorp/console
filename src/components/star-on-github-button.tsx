"use client";

import { GitHubIcon } from "@/components/github-icon";
import { POST_SIGN_IN_URL } from "@/lib/site-links";
import { signInWithGitHub } from "@/lib/sign-in-github";

export function StarOnGitHubButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-none border border-white/70 bg-black px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:border-white/85 hover:bg-zinc-900 hover:text-white/90 ${className}`}
      onClick={() => {
        void signInWithGitHub(POST_SIGN_IN_URL);
      }}
    >
      <GitHubIcon className="h-4 w-4" />
      Sign in with GitHub
    </button>
  );
}
