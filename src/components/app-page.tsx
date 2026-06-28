import type { ReactNode } from "react";
import { AppGithubContext } from "@/components/app-github-context";
import { cn } from "@/lib/utils";

export function AppPage({
  children,
  className,
  githubContext,
}: {
  children: ReactNode;
  className?: string;
  githubContext?: {
    href: string;
    label: string;
  };
}) {
  return (
    <main className={cn("flex flex-1 flex-col px-6 py-10", className)}>
      {githubContext ? <AppGithubContext {...githubContext} /> : null}
      <div>{children}</div>
    </main>
  );
}
