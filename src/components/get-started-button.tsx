"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { GitHubIcon } from "@/components/github-icon";
import { POST_SIGN_IN_URL } from "@/lib/site-links";
import { signInWithGitHub } from "@/lib/sign-in-github";

export function GetStartedButton({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      className={className}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signInWithGitHub(POST_SIGN_IN_URL).catch(() => {
          setPending(false);
        });
      }}
    >
      <GitHubIcon className="h-3.5 w-3.5" />
      {pending ? "Redirecting…" : "Get started free"}
    </Button>
  );
}
