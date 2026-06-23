import type { ReactNode } from "react";
import { AppGithubContext } from "@/components/app-github-context";
import { cn } from "@/lib/utils";

export function AppPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("flex flex-1 flex-col px-6 py-10", className)}>
      <AppGithubContext />
      <div>{children}</div>
    </main>
  );
}
